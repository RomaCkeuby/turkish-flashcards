import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type AuthRole = "owner" | "learner";
export type AuthUser = { id: number; username: string; displayName: string; role: AuthRole };
export type AuthSession = { user: AuthUser; expiresAt: string };
export type CreatedAuthSession = AuthSession & { token: string };
export type AuthRegistration = { username: string; password: string; displayName: string };
export type AuthErrorCode = "INVALID_INPUT" | "INVALID_CREDENTIALS" | "UNAUTHORIZED" | "FORBIDDEN"
  | "INVALID_INVITATION" | "USERNAME_TAKEN" | "OWNER_EXISTS" | "RATE_LIMITED";

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(code: AuthErrorCode, message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const scryptOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const passwordMaximumBytes = 1024;
const loginWindowMs = 15 * 60 * 1000;
const sessionLifetimeMs = 12 * 60 * 60 * 1000;
const invitationLifetimeMs = 24 * 60 * 60 * 1000;

type UserRow = {
  id: number;
  username: string;
  display_name: string;
  role: AuthRole;
  password_hash: string;
  disabled_at: number | null;
};
type SessionRow = UserRow & { expires_at: number; revoked_at: number | null };

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function publicUser(row: UserRow): AuthUser {
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role };
}

function transaction<T>(database: DatabaseSync, body: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = body();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

/** Explicit migration only. Importing this module or constructing AuthStore never changes a database. */
export function migrateAuth(database: DatabaseSync) {
  transaction(database, () => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'learner')),
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        disabled_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS users_single_owner ON users(role) WHERE role = 'owner';
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
      CREATE TABLE IF NOT EXISTS auth_invitations (
        token_hash TEXT PRIMARY KEY,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER,
        consumed_by INTEGER REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS auth_attempt_limits (
        bucket_hash TEXT PRIMARY KEY,
        attempts INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS auth_attempt_limits_expiry ON auth_attempt_limits(expires_at);
      CREATE TABLE IF NOT EXISTS auth_schema_migrations (
        version INTEGER PRIMARY KEY
      );
      INSERT OR IGNORE INTO auth_schema_migrations(version) VALUES (1);
    `);
  });
}

function validatePassword(password: string) {
  if (typeof password !== "string" || Buffer.byteLength(password, "utf8") > passwordMaximumBytes || [...password].length < 12) {
    throw new AuthError("INVALID_INPUT", "Пароль должен содержать от 12 символов и занимать не более 1024 байт UTF-8.", 400);
  }
}

function normalizeUsername(username: string) {
  if (typeof username !== "string" || username.length > 128) {
    throw new AuthError("INVALID_INPUT", "Некорректное имя пользователя.", 400);
  }
  const canonical = username.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(canonical)) {
    throw new AuthError("INVALID_INPUT", "Имя пользователя: 3–64 латинских буквы, цифры или символы . _ -.", 400);
  }
  return canonical;
}

function validateRegistration(input: AuthRegistration) {
  const username = normalizeUsername(input.username);
  validatePassword(input.password);
  if (typeof input.displayName !== "string" || input.displayName.length > 160) {
    throw new AuthError("INVALID_INPUT", "Некорректное отображаемое имя.", 400);
  }
  const displayName = input.displayName.trim();
  if (!displayName || [...displayName].length > 80 || /[\u0000-\u001f\u007f]/.test(displayName)) {
    throw new AuthError("INVALID_INPUT", "Отображаемое имя должно содержать 1–80 символов без управляющих символов.", 400);
  }
  return { username, displayName };
}

async function derivePassword(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, scryptOptions, (error, key) => error ? reject(error) : resolve(key));
  });
}

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derivePassword(password, salt);
  return `scrypt$32768$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function verifyPassword(password: string, storedHash: string | null) {
  // Unknown users incur the same KDF work; storage corruption remains an internal error.
  const encoded = storedHash ?? `scrypt$32768$8$1$${"0".repeat(32)}$${"0".repeat(128)}`;
  const match = /^scrypt\$32768\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded);
  if (!match) throw new Error("Invalid stored authentication hash.");
  const key = await derivePassword(password, Buffer.from(match[1]!, "hex"));
  return timingSafeEqual(key, Buffer.from(match[2]!, "hex")) && storedHash !== null;
}

/** All writes target the database explicitly supplied by the caller. No production paths or defaults. */
export class AuthStore {
  private readonly database: DatabaseSync;
  private readonly now: () => number;

  constructor(database: DatabaseSync, options: { now?: () => number } = {}) {
    this.database = database;
    this.now = options.now ?? Date.now;
  }

  /** Trusted local setup only; never expose as a public HTTP route. Does not return a session. */
  async bootstrapOwner(input: AuthRegistration): Promise<AuthUser> {
    const normalized = validateRegistration(input);
    const passwordHash = await hashPassword(input.password);
    return transaction(this.database, () => {
      const existing = this.database.prepare("SELECT id FROM users LIMIT 1").get();
      if (existing) throw new AuthError("OWNER_EXISTS", "Первоначальный владелец уже создан.", 409);
      return this.insertUser(normalized, passwordHash, "owner");
    });
  }

  private insertUser(input: { username: string; displayName: string }, passwordHash: string, role: AuthRole): AuthUser {
    if (this.database.prepare("SELECT id FROM users WHERE username = ?").get(input.username)) {
      throw new AuthError("USERNAME_TAKEN", "Имя пользователя уже занято.", 409);
    }
    const result = this.database.prepare(`INSERT INTO users
      (username, display_name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(input.username, input.displayName, role, passwordHash, this.now());
    return { id: Number(result.lastInsertRowid), username: input.username, displayName: input.displayName, role };
  }

  private issueSession(user: AuthUser): CreatedAuthSession {
    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    const expiresAt = now + sessionLifetimeMs;
    this.database.prepare(`INSERT INTO auth_sessions
      (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
      .run(digest(token), user.id, now, expiresAt);
    return { token, user, expiresAt: new Date(expiresAt).toISOString() };
  }

  getSession(token: string): AuthSession | null {
    if (typeof token !== "string" || !tokenPattern.test(token)) return null;
    const row = this.database.prepare(`SELECT u.*, s.expires_at, s.revoked_at
      FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`)
      .get(digest(token)) as SessionRow | undefined;
    if (!row || row.disabled_at !== null || row.revoked_at !== null || row.expires_at <= this.now()) return null;
    return { user: publicUser(row), expiresAt: new Date(row.expires_at).toISOString() };
  }

  requireSession(token: string): AuthSession {
    const session = this.getSession(token);
    if (!session) throw new AuthError("UNAUTHORIZED", "Войдите в аккаунт заново.", 401);
    return session;
  }

  requireOwner(token: string): AuthSession {
    const session = this.requireSession(token);
    if (session.user.role !== "owner") throw new AuthError("FORBIDDEN", "Недостаточно прав.", 403);
    return session;
  }

  revokeSession(token: string): { revoked: true } {
    if (typeof token === "string" && tokenPattern.test(token)) {
      this.database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
        .run(this.now(), digest(token));
    }
    return { revoked: true };
  }

  createInvitation(ownerToken: string): { invitation: string; expiresAt: string } {
    return transaction(this.database, () => {
      const { user } = this.requireOwner(ownerToken);
      const invitation = randomBytes(32).toString("base64url");
      const now = this.now();
      const expiresAt = now + invitationLifetimeMs;
      this.database.prepare(`INSERT INTO auth_invitations
        (token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)`)
        .run(digest(invitation), user.id, now, expiresAt);
      return { invitation, expiresAt: new Date(expiresAt).toISOString() };
    });
  }

  private reserveAttempts(buckets: { key: string; maximum: number }[]) {
    transaction(this.database, () => {
      const now = this.now();
      this.database.prepare("DELETE FROM auth_attempt_limits WHERE expires_at <= ?").run(now);
      for (const bucket of buckets) {
        const hash = digest(bucket.key);
        const state = this.database.prepare("SELECT attempts, expires_at FROM auth_attempt_limits WHERE bucket_hash = ?")
          .get(hash) as { attempts: number; expires_at: number } | undefined;
        if (state && state.attempts >= bucket.maximum) {
          throw new AuthError("RATE_LIMITED", "Слишком много попыток. Попробуйте позже.", 429,
            Math.max(1, Math.ceil((state.expires_at - now) / 1000)));
        }
        this.database.prepare(`INSERT INTO auth_attempt_limits (bucket_hash, attempts, expires_at) VALUES (?, 1, ?)
          ON CONFLICT(bucket_hash) DO UPDATE SET attempts = attempts + 1`)
          .run(hash, now + loginWindowMs);
      }
    });
  }

  private validateClientKey(clientKey: string) {
    if (typeof clientKey !== "string" || !clientKey || clientKey.length > 256) {
      throw new Error("Authentication requires a bounded trusted client key.");
    }
  }

  async login(input: { username: string; password: string }, clientKey: string): Promise<CreatedAuthSession> {
    this.validateClientKey(clientKey);
    // Input size is bounded before KDF; syntactically invalid names use the generic credential error.
    if (typeof input.username !== "string" || input.username.length > 128 || typeof input.password !== "string"
      || Buffer.byteLength(input.password, "utf8") > passwordMaximumBytes) {
      throw new AuthError("INVALID_INPUT", "Некорректные данные входа.", 400);
    }
    const username = input.username.trim().toLowerCase();
    const identityBucket = `login-user:${username}`;
    this.reserveAttempts([
      { key: identityBucket, maximum: 5 },
      { key: `login-client:${clientKey}`, maximum: 30 },
    ]);
    const user = this.database.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
    const valid = await verifyPassword(input.password, user?.password_hash ?? null);
    if (!user || !valid || user.disabled_at !== null) {
      throw new AuthError("INVALID_CREDENTIALS", "Неверное имя пользователя или пароль.", 401);
    }
    return transaction(this.database, () => {
      // Re-check after async KDF; concurrent credential changes must not issue a stale session.
      const current = this.database.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as UserRow | undefined;
      if (!current || current.disabled_at !== null || current.password_hash !== user.password_hash) {
        throw new AuthError("INVALID_CREDENTIALS", "Неверное имя пользователя или пароль.", 401);
      }
      this.database.prepare("DELETE FROM auth_attempt_limits WHERE bucket_hash = ?").run(digest(identityBucket));
      return this.issueSession(publicUser(current));
    });
  }

  async registerWithInvitation(input: AuthRegistration & { invitation: string }, clientKey: string): Promise<CreatedAuthSession> {
    this.validateClientKey(clientKey);
    this.reserveAttempts([{ key: `register-client:${clientKey}`, maximum: 10 }]);
    const normalized = validateRegistration(input);
    if (typeof input.invitation !== "string" || !tokenPattern.test(input.invitation)) {
      throw new AuthError("INVALID_INVITATION", "Приглашение недействительно или истекло.", 400);
    }
    const passwordHash = await hashPassword(input.password);
    return transaction(this.database, () => {
      const invitationHash = digest(input.invitation);
      const now = this.now();
      // Consumption and account/session creation are one synchronous transaction, after the KDF.
      const invitation = this.database.prepare(`SELECT i.token_hash FROM auth_invitations i
        JOIN users u ON u.id = i.created_by WHERE i.token_hash = ? AND i.consumed_at IS NULL
        AND i.expires_at > ? AND u.disabled_at IS NULL AND u.role = 'owner'`)
        .get(invitationHash, now);
      if (!invitation) throw new AuthError("INVALID_INVITATION", "Приглашение недействительно или истекло.", 400);
      const user = this.insertUser(normalized, passwordHash, "learner");
      this.database.prepare("UPDATE auth_invitations SET consumed_at = ?, consumed_by = ? WHERE token_hash = ?")
        .run(now, user.id, invitationHash);
      return this.issueSession(user);
    });
  }
}
