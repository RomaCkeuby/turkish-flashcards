import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve } from "node:path";

type ApiHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;
type SiteOptions = {
  production: boolean;
  webRoot: string;
  username?: string;
  password?: string;
};

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};
const developmentOrigins = new Set(["http://127.0.0.1:5173", "http://localhost:5173"]);

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function inside(root: string, path: string) {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith("../") && !part.startsWith("..\\") && !isAbsolute(part);
}

export function createSiteHandler(apiHandler: ApiHandler, options: SiteOptions): ApiHandler {
  if (Boolean(options.username) !== Boolean(options.password)) {
    throw new Error("APP_USERNAME и APP_PASSWORD нужно задать вместе.");
  }
  if (options.production && (!options.username || !options.password || options.password.length < 16)) {
    throw new Error("Для онлайн-запуска задайте APP_USERNAME и APP_PASSWORD длиной от 16 символов.");
  }
  if (options.username?.includes(":")) throw new Error("APP_USERNAME не должен содержать двоеточие.");
  const credentials = options.username && options.password
    ? digest(`${options.username}:${options.password}`) : null;
  const webRoot = resolve(options.webRoot);

  return async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    if (options.production) {
      response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    }
    const url = new URL(request.url ?? "/", "http://localhost");
    // Hosting checks expose only liveness, without collection or progress data.
    if (url.pathname === "/healthz" && (request.method === "GET" || request.method === "HEAD")) {
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : "ok");
      return;
    }

    const origin = request.headers.origin;
    const developmentRequest = !options.production && Boolean(origin && developmentOrigins.has(origin));
    if (developmentRequest) {
      response.setHeader("Access-Control-Allow-Origin", origin!);
      response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      response.setHeader("Access-Control-Allow-Methods", "GET, PATCH, POST, OPTIONS");
      response.setHeader("Vary", "Origin");
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }
    }

    if (credentials) {
      const authorization = request.headers.authorization;
      const token = authorization?.match(/^Basic ([A-Za-z0-9+/]+=*)$/i)?.[1];
      const supplied = token ? Buffer.from(token, "base64").toString("utf8") : "";
      if (!token || !timingSafeEqual(digest(supplied), credentials)) {
        response.writeHead(401, {
          "WWW-Authenticate": 'Basic realm="Turkish Flashcards", charset="UTF-8"',
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end("Для доступа введите логин и пароль.");
        return;
      }
    }

    if (!["GET", "HEAD", "OPTIONS"].includes(request.method ?? "")) {
      let sameOrigin = !origin;
      if (origin) {
        try {
          const parsed = new URL(origin);
          sameOrigin = ["http:", "https:"].includes(parsed.protocol) && parsed.host === request.headers.host;
        } catch { /* A malformed Origin is rejected below. */ }
      }
      if (!developmentRequest && (!sameOrigin || request.headers["sec-fetch-site"] === "cross-site")) {
        response.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Запрос с другого сайта запрещён." }));
        return;
      }
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      await apiHandler(request, response);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }

    let pathname: string;
    try { pathname = decodeURIComponent(url.pathname); } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    if (/[\\\0:]/.test(pathname) || pathname.split("/").some(part => part.startsWith("."))) {
      response.writeHead(404);
      response.end();
      return;
    }
    const extension = extname(pathname);
    // Client-side routes return the app; missing assets must remain 404s.
    const path = extension ? resolve(webRoot, `.${pathname}`) : resolve(webRoot, "index.html");
    const mime = mimeTypes[extname(path)];
    if (!mime || !inside(webRoot, path)) {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      const [actualRoot, actualPath] = await Promise.all([realpath(webRoot), realpath(path)]);
      if (!inside(actualRoot, actualPath)) {
        response.writeHead(404);
        response.end();
        return;
      }
      const body = await readFile(actualPath);
      response.writeHead(200, { "Content-Type": mime, "Content-Length": body.length });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && ["ENOENT", "ENOTDIR", "EISDIR"].includes(String(error.code))) {
        response.writeHead(404);
        response.end();
        return;
      }
      throw error;
    }
  };
}
