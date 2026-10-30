import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createSiteHandler } from "./hosting.ts";

const password = "test-only-long-password";
const auth = `Basic ${Buffer.from(`roman:${password}`).toString("base64")}`;

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "flashcards-hosting-"));
  await mkdir(join(root, "web", "assets"), { recursive: true });
  await writeFile(join(root, "private.db"), "private progress");
  await writeFile(join(root, "web", "index.html"), "<html>Flashcards</html>");
  await writeFile(join(root, "web", "assets", "app.js"), "console.log('app')");
  const handle = createSiteHandler(async (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ entries: 250 }));
  }, { production: true, webRoot: join(root, "web"), username: "roman", password });
  const server = createServer((req, res) => { void handle(req, res).catch(error => res.destroy(error)); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  context.after(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  });
  return (path: string, method = "GET", headers: Record<string, string> = {}) =>
    new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port: address.port, path, method, headers }, res => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", chunk => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      });
      req.on("error", reject);
      req.end();
    });
}

test("production refuses absent, incomplete or short credentials", () => {
  const handler = async () => {};
  const base = { production: true, webRoot: "." };
  assert.throws(() => createSiteHandler(handler, base), /APP_USERNAME/);
  assert.throws(() => createSiteHandler(handler, { ...base, username: "roman" }), /вместе/);
  assert.throws(() => createSiteHandler(handler, { ...base, username: "roman", password: "short" }), /16/);
});

test("both UI and API require credentials; only liveness is public", async context => {
  const send = await fixture(context);
  for (const path of ["/", "/dictionary", "/api/stats", "/assets/app.js"]) {
    const result = await send(path);
    assert.equal(result.status, 401);
    assert.match(String(result.headers["www-authenticate"]), /^Basic/);
    assert.doesNotMatch(result.body, /entries|console/);
  }
  assert.equal((await send("/", "GET", { authorization: "Basic invalid" })).status, 401);
  assert.equal((await send("/api/stats", "GET", { authorization: auth })).status, 200);
  assert.deepEqual(JSON.parse((await send("/api/stats", "GET", { authorization: auth })).body), { entries: 250 });
  assert.equal((await send("/healthz")).body, "ok");
  assert.equal((await send("/healthz", "POST")).status, 401);
});

test("nested routes, static assets and HEAD work; private files cannot be served", async context => {
  const send = await fixture(context);
  const headers = { authorization: auth };
  assert.match((await send("/card/123", "GET", headers)).body, /Flashcards/);
  const asset = await send("/assets/app.js", "GET", headers);
  assert.equal(asset.status, 200);
  assert.match(String(asset.headers["content-type"]), /javascript/);
  assert.equal(asset.headers["cache-control"], "no-store");
  assert.equal((await send("/card/123", "HEAD", headers)).body, "");
  for (const path of ["/assets/missing.js", "/private.db", "/.env", "/%2e%2e%2fprivate.db", "/%5c..%5cprivate.db", "/%ZZ"]) {
    const response = await send(path, "GET", headers);
    assert.ok([400, 404].includes(response.status), path);
    assert.doesNotMatch(response.body, /private progress/);
  }
});

test("cross-site writes and permissive production CORS are blocked", async context => {
  const send = await fixture(context);
  assert.equal((await send("/api/entries", "POST", { authorization: auth, origin: "https://other.example" })).status, 403);
  assert.equal((await send("/api/entries", "POST", { authorization: auth, "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await send("/api/entries", "POST", { authorization: auth, origin: "null" })).status, 403);
  const valid = await send("/api/entries", "POST", { authorization: auth });
  assert.equal(valid.status, 200);
  assert.equal(valid.headers["access-control-allow-origin"], undefined);
});
