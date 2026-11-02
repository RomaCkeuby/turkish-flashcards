import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { AuthError, AuthStore, migrateAuth, type AuthErrorCode } from "./auth.ts";

const ownerInput = { username: "owner", password: "owner-test-password-123", displayName: "Владелец" };
const learnerInput = { username: "student", password: "student-test-password-123", displayName: "Ученик" };

function fixture(context: TestContext) {
  const database = new DatabaseSync(":memory:");
  let now = Date.UTC(2026, 10, 2);
  context.after(() => database.close());
  migrateAuth(database);
  const auth = new AuthStore(database, { now: () => now });
  return { database, auth, advance: (ms: number) => { now += ms; } };
}

function authError(code: AuthErrorCode) {
  return (error: unknown) => error instanceof AuthError && error.code === code;
}

async function ownerSession(auth: AuthStore) {
  await auth.bootstrapOwner(ownerInput);
  return auth.login(ownerInput, "trusted-test-client");
}

test("auth migration is explicit, repeatable and creates no default account", context => {
  const database = new DatabaseSync(":memory:");
  context.after(() => database.close());
  new AuthStore(database);
  assert.equal(database.prepare("SELECT count(*) AS total FROM sqlite_master WHERE type = 'table'").get()?.total, 0);
  migrateAuth(database);
  migrateAuth(database);
  assert.equal(database.prepare("SELECT count(*) AS total FROM users").get()?.total, 0);
  assert.deepEqual(database.prepare("SELECT version FROM auth_schema_migrations").all().map(row => row.version), [1]);
});

test("owner bootstrap validates input, is single-use and stores a salted hash", async context => {
  const { database, auth } = fixture(context);
  await assert.rejects(auth.bootstrapOwner({ ...ownerInput, password: "short" }), authError("INVALID_INPUT"));
  await assert.rejects(auth.bootstrapOwner({ ...ownerInput, username: "x" }), authError("INVALID_INPUT"));
  const owner = await auth.bootstrapOwner({ ...ownerInput, username: " Owner " });
  assert.equal(owner.role, "owner");
  assert.equal(owner.username, "owner");
  const stored = String(database.prepare("SELECT password_hash FROM users WHERE id = ?").get(owner.id)?.password_hash);
  assert.match(stored, /^scrypt\$32768\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.ok(!stored.includes(ownerInput.password));
  await assert.rejects(auth.bootstrapOwner({ ...ownerInput, username: "second-owner" }), authError("OWNER_EXISTS"));
  assert.equal(database.prepare("SELECT count(*) AS total FROM users").get()?.total, 1);
});

test("login uses canonical usernames, generic wrong-credential errors and hash-only sessions", async context => {
  const { database, auth } = fixture(context);
  await auth.bootstrapOwner(ownerInput);
  let knownError: unknown;
  let unknownError: unknown;
  try { await auth.login({ ...ownerInput, password: "wrong" }, "client"); } catch (error) { knownError = error; }
  try { await auth.login({ username: "unknown", password: "wrong" }, "client"); } catch (error) { unknownError = error; }
  assert.ok(knownError instanceof AuthError && unknownError instanceof AuthError);
  assert.equal(knownError.message, unknownError.message);
  assert.equal(knownError.code, "INVALID_CREDENTIALS");
  assert.equal(unknownError.code, "INVALID_CREDENTIALS");
  const session = await auth.login({ ...ownerInput, username: " OWNER " }, "client");
  assert.match(session.token, /^[A-Za-z0-9_-]{43}$/);
  const stored = database.prepare("SELECT token_hash FROM auth_sessions").get();
  assert.equal(stored?.token_hash, createHash("sha256").update(session.token).digest("hex"));
  assert.notEqual(stored?.token_hash, session.token);
  assert.deepEqual(auth.getSession(session.token)?.user, session.user);
  assert.ok(!("password_hash" in session.user));
});

test("sessions expire at boundary, can be revoked and reject disabled users", async context => {
  const { database, auth, advance } = fixture(context);
  const first = await ownerSession(auth);
  const second = await auth.login(ownerInput, "client");
  assert.deepEqual(auth.revokeSession(first.token), { revoked: true });
  assert.equal(auth.getSession(first.token), null);
  assert.ok(auth.getSession(second.token));
  assert.deepEqual(auth.revokeSession(first.token), { revoked: true });
  database.prepare("UPDATE users SET disabled_at = 1 WHERE id = ?").run(second.user.id);
  assert.equal(auth.getSession(second.token), null);
  database.prepare("UPDATE users SET disabled_at = NULL WHERE id = ?").run(second.user.id);
  advance(12 * 60 * 60 * 1000);
  assert.equal(auth.getSession(second.token), null);
  assert.throws(() => auth.requireSession(second.token), authError("UNAUTHORIZED"));
  assert.equal(auth.getSession("invalid"), null);
});

test("only live owner sessions issue invitations; registration cannot choose owner role", async context => {
  const { database, auth } = fixture(context);
  const owner = await ownerSession(auth);
  const invitation = auth.createInvitation(owner.token);
  assert.match(invitation.invitation, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(database.prepare("SELECT token_hash FROM auth_invitations").get()?.token_hash, invitation.invitation);
  const extraRole = { ...learnerInput, password: ownerInput.password, invitation: invitation.invitation, role: "owner" };
  const learner = await auth.registerWithInvitation(extraRole, "client");
  assert.equal(learner.user.role, "learner");
  assert.notEqual(owner.user.id, learner.user.id);
  assert.throws(() => auth.createInvitation(learner.token), authError("FORBIDDEN"));
  assert.throws(() => auth.createInvitation("not-a-session"), authError("UNAUTHORIZED"));
  await assert.rejects(auth.registerWithInvitation({ ...learnerInput, username: "another", invitation: invitation.invitation }, "client"),
    authError("INVALID_INVITATION"));
  const rows = database.prepare("SELECT password_hash FROM users").all();
  assert.notEqual(rows[0]?.password_hash, rows[1]?.password_hash);
});

test("invitations expire and an unavailable owner cannot authorize registration", async context => {
  const { database, auth, advance } = fixture(context);
  const owner = await ownerSession(auth);
  const invitation = auth.createInvitation(owner.token);
  database.prepare("UPDATE users SET disabled_at = 1 WHERE id = ?").run(owner.user.id);
  await assert.rejects(auth.registerWithInvitation({ ...learnerInput, invitation: invitation.invitation }, "client"), authError("INVALID_INVITATION"));
  database.prepare("UPDATE users SET disabled_at = NULL WHERE id = ?").run(owner.user.id);
  advance(24 * 60 * 60 * 1000);
  await assert.rejects(auth.registerWithInvitation({ ...learnerInput, invitation: invitation.invitation }, "client"), authError("INVALID_INVITATION"));
});

test("failed registration rolls back invitation consumption, account and session together", async context => {
  const { database, auth } = fixture(context);
  const owner = await ownerSession(auth);
  const invitation = auth.createInvitation(owner.token);
  await assert.rejects(auth.registerWithInvitation({ ...learnerInput, username: "OWNER", invitation: invitation.invitation }, "client"), authError("USERNAME_TAKEN"));
  database.exec(`CREATE TRIGGER fail_student_session BEFORE INSERT ON auth_sessions
    WHEN NEW.user_id <> ${owner.user.id} BEGIN SELECT RAISE(ABORT, 'test session failure'); END;`);
  await assert.rejects(auth.registerWithInvitation({ ...learnerInput, invitation: invitation.invitation }, "client"), /test session failure/);
  assert.equal(database.prepare("SELECT count(*) AS total FROM users").get()?.total, 1);
  assert.equal(database.prepare("SELECT consumed_at FROM auth_invitations").get()?.consumed_at, null);
  database.exec("DROP TRIGGER fail_student_session");
  const learner = await auth.registerWithInvitation({ ...learnerInput, invitation: invitation.invitation }, "client");
  assert.ok(auth.getSession(learner.token));
});

test("concurrent registration consumes an invitation exactly once", async context => {
  const { database, auth } = fixture(context);
  const owner = await ownerSession(auth);
  const invitation = auth.createInvitation(owner.token);
  const results = await Promise.allSettled([
    auth.registerWithInvitation({ ...learnerInput, invitation: invitation.invitation }, "client-a"),
    auth.registerWithInvitation({ ...learnerInput, username: "student-two", invitation: invitation.invitation }, "client-b"),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const failure = results.find(result => result.status === "rejected");
  assert.ok(failure?.status === "rejected" && authError("INVALID_INVITATION")(failure.reason));
  assert.equal(database.prepare("SELECT count(*) AS total FROM users WHERE role = 'learner'").get()?.total, 1);
});

test("login attempts are persisted and limited by identity before expensive hashing", async context => {
  const { database, auth, advance } = fixture(context);
  await auth.bootstrapOwner(ownerInput);
  for (let index = 0; index < 5; index += 1) {
    await assert.rejects(auth.login({ ...ownerInput, password: "wrong" }, `client-${index}`), authError("INVALID_CREDENTIALS"));
  }
  const restartedStore = new AuthStore(database, { now: () => Date.UTC(2026, 10, 2) });
  await assert.rejects(restartedStore.login(ownerInput, "new-client"), (error: unknown) =>
    error instanceof AuthError && error.code === "RATE_LIMITED" && error.retryAfterSeconds === 900);
  advance(15 * 60 * 1000);
  assert.ok((await auth.login(ownerInput, "client")).token);
});

test("client attempt limit also applies across different login identities", async context => {
  const { database, auth } = fixture(context);
  const hash = createHash("sha256").update("login-client:client").digest("hex");
  database.prepare("INSERT INTO auth_attempt_limits VALUES (?, 30, ?)").run(hash, Date.UTC(2026, 10, 2) + 900_000);
  await assert.rejects(auth.login({ username: "unknown", password: "wrong" }, "client"), authError("RATE_LIMITED"));
  // Reservation is atomic: failure of the client bucket does not consume an identity attempt.
  assert.equal(database.prepare("SELECT count(*) AS total FROM auth_attempt_limits").get()?.total, 1);
});

test("registration limits invalid invitations, bounds inputs and rejects malformed stored hashes as internal errors", async context => {
  const { database, auth } = fixture(context);
  await auth.bootstrapOwner(ownerInput);
  for (let index = 0; index < 10; index += 1) {
    await assert.rejects(auth.registerWithInvitation({ ...learnerInput, invitation: "invalid" }, "client"), authError("INVALID_INVITATION"));
  }
  await assert.rejects(auth.registerWithInvitation({ ...learnerInput, invitation: "invalid" }, "client"), authError("RATE_LIMITED"));
  await assert.rejects(auth.login({ ...ownerInput, password: "a".repeat(1025) }, "client"), authError("INVALID_INPUT"));
  database.prepare("UPDATE users SET password_hash = 'corrupt' WHERE username = 'owner'").run();
  await assert.rejects(auth.login(ownerInput, "client"), (error: unknown) => error instanceof Error && !(error instanceof AuthError));
});

test("a user disabled during asynchronous password verification receives no session", async context => {
  const { database, auth } = fixture(context);
  await auth.bootstrapOwner(ownerInput);
  const pending = auth.login(ownerInput, "client");
  database.prepare("UPDATE users SET disabled_at = 1 WHERE username = 'owner'").run();
  await assert.rejects(pending, authError("INVALID_CREDENTIALS"));
  assert.equal(database.prepare("SELECT count(*) AS total FROM auth_sessions").get()?.total, 0);
});
