import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { createSiteHandler } from "./hosting.ts";

const password = "test-only-long-password";
const auth = `Basic ${Buffer.from(`roman:${password}`).toString("base64")}`;

async function fixture(context: TestContext, production = true) {
  const root = await mkdtemp(join(tmpdir(), "flashcards-hosting-"));
  await mkdir(join(root, "web", "assets"), { recursive: true });
  await writeFile(join(root, "private.db"), "private progress");
  await writeFile(join(root, "web", "index.html"), "<html>Flashcards</html>");
  await writeFile(join(root, "web", "assets", "app.js"), "console.log('app')");
  await mkdir(join(root, "web", "decks"));
  const deck = '[{"turkish":"merhaba","russian":"привет"}]\n';
  const sha256 = createHash("sha256").update(deck).digest("hex");
  await writeFile(join(root, "web", "decks", `cards.${sha256.slice(0, 16)}.json`), deck);
  await writeFile(join(root, "web", "decks", "manifest.json"), JSON.stringify({
    schemaVersion: 1, version: "test", recordCount: 1, file: `cards.${sha256.slice(0, 16)}.json`, sha256,
  }));
  await writeFile(join(root, "web", "config.json"), '{"private":"not a public deck"}');
  await writeFile(join(root, "web", "decks", "private.json"), '{"private":"not a public deck"}');
  const handle = createSiteHandler(async (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ entries: 250 }));
  }, { production, webRoot: join(root, "web"), username: "roman", password });
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

test("Codespaces allows only its configured development origin and production still rejects it", async context => {
  const environment = {
    CODESPACES: "true",
    CODESPACE_NAME: "test-workspace",
    GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
  };
  for (const [name, value] of Object.entries(environment)) {
    const previous = process.env[name];
    process.env[name] = value;
    context.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  const origin = "https://test-workspace-5173.app.github.dev";
  const send = await fixture(context, false);
  const response = await send("/api/reviews", "POST", { authorization: auth, origin });
  assert.equal(response.status, 200);
  assert.equal(response.headers["access-control-allow-origin"], origin);
  assert.equal((await send("/api/reviews", "OPTIONS", { origin })).status, 204);
  for (const otherOrigin of ["https://other-workspace-5173.app.github.dev", "https://test-workspace-3001.app.github.dev", "http://test-workspace-5173.app.github.dev"]) {
    assert.equal((await send("/api/reviews", "POST", { authorization: auth, origin: otherOrigin })).status, 403);
  }
  const production = await fixture(context);
  assert.equal((await production("/api/reviews", "POST", { authorization: auth, origin })).status, 403);
});

test("published deck JSON is served intact with auth while other JSON remains blocked", async context => {
  const send = await fixture(context);
  const headers = { authorization: auth };
  assert.equal((await send("/decks/manifest.json")).status, 401);
  const response = await send("/decks/manifest.json", "GET", headers);
  assert.equal(response.status, 200);
  assert.match(String(response.headers["content-type"]), /^application\/json/);
  const manifest = JSON.parse(response.body);
  const path = `/decks/${manifest.file}`;
  assert.equal((await send(path)).status, 401);
  const deck = await send(path, "GET", headers);
  assert.equal(deck.status, 200);
  assert.match(String(deck.headers["content-type"]), /^application\/json/);
  assert.equal(createHash("sha256").update(deck.body).digest("hex"), manifest.sha256);
  assert.equal(JSON.parse(deck.body)[0].russian, "привет");
  const head = await send(path, "HEAD", headers);
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  for (const privatePath of ["/config.json", "/decks/private.json", "/decks/missing.json", "/decks/cards.0000000000000000.json"]) {
    const result = await send(privatePath, "GET", headers);
    assert.equal(result.status, 404);
    assert.doesNotMatch(result.body, /private/);
  }
});
