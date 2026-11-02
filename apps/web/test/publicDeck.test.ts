import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { initialAppMode } from "../src/appMode.ts";
import { serverSiteUrl } from "../src/serverSite.ts";
import { loadPublicDeck, parsePublicEntries, parsePublicManifest } from "../src/publicDeckData.ts";

const entry = { key: "source:merhaba", turkish: "merhaba", russian: "привет", category: "Основы", partOfSpeech: "междометие", tags: [], exampleTurkish: "Merhaba!", exampleRussian: "Привет!", sources: [{ name: "Source", url: "https://example.org/word", license: "CC BY", purpose: "entry" }] };
const body = JSON.stringify([entry]);
const sha256 = createHash("sha256").update(body).digest("hex");
const manifest = { schemaVersion: 1, version: "test-v1", recordCount: 1, file: `cards.${sha256.slice(0, 16)}.json`, sha256 };

test("static site starts as guest and existing local build retains server mode", () => {
  assert.equal(initialAppMode(true), "guest");
  assert.equal(initialAppMode(false), "server");
});

test("server transition opens its own origin and preserves the study direction", () => {
  assert.equal(serverSiteUrl(" https://my-server.example/ ", "/study?direction=ru-tr&category=Еда"), "https://my-server.example/study?direction=ru-tr&category=%D0%95%D0%B4%D0%B0");
  assert.equal(serverSiteUrl("http://localhost:3002"), "http://localhost:3002/");
  for (const route of ["//other.example", "/\\other.example", "https://other.example"]) {
    assert.equal(serverSiteUrl("https://my-server.example", route), "https://my-server.example/");
  }
});

test("server transition rejects Pages, credentials, paths and unsupported protocols", () => {
  for (const address of ["https://romackeuby.github.io", "https://server.example/path", "https://server.example/#/", "https://user:pass@server.example", "javascript:alert(1)", "http://server.example", "invalid"]) {
    assert.throws(() => serverSiteUrl(address));
  }
});

test("public loader respects repository base path and only requests public resources", async () => {
  const requests: string[] = [];
  const fetcher = (async (url: string | URL | Request) => {
    requests.push(String(url));
    return new Response(String(url).endsWith("manifest.json") ? JSON.stringify(manifest) : body);
  }) as typeof fetch;
  const result = await loadPublicDeck("/repo/", fetcher);
  assert.equal(result.entries[0]?.key, entry.key);
  assert.deepEqual(requests, ["/repo/decks/manifest.json", `/repo/decks/${manifest.file}`]);
});

test("public loader rejects corrupted bytes and failed resource fetches", async () => {
  const fetcher = (async (url: string | URL | Request) => new Response(String(url).endsWith("manifest.json") ? JSON.stringify(manifest) : "[]")) as typeof fetch;
  await assert.rejects(loadPublicDeck("/", fetcher), /Проверка подборки/);
  await assert.rejects(loadPublicDeck("/", (async () => new Response("missing", { status: 404 })) as typeof fetch), /Не удалось загрузить/);
});

test("manifest rejects incompatible schemas and arbitrary resource paths", () => {
  assert.deepEqual(parsePublicManifest(manifest), manifest);
  assert.throws(() => parsePublicManifest({ ...manifest, schemaVersion: 2 }), /несовместим/);
  assert.throws(() => parsePublicManifest({ ...manifest, file: "../../api/stats" }), /несовместим/);
});

test("entries reject duplicate identities, wrong counts and unsafe source links", () => {
  assert.deepEqual(parsePublicEntries([entry], 1), [entry]);
  assert.throws(() => parsePublicEntries([entry, entry], 2), /некорректные/);
  assert.throws(() => parsePublicEntries([entry], 2), /не полностью/);
  assert.throws(() => parsePublicEntries([{ ...entry, sources: [{ ...entry.sources[0], url: "javascript:alert(1)" }] }], 1), /некорректные/);
  assert.throws(() => parsePublicEntries([{ ...entry, sources: [{ ...entry.sources[0], url: "local://unknown" }] }], 1), /некорректные/);
  assert.throws(() => parsePublicEntries([{ ...entry, sources: [{ ...entry.sources[0], url: "file:///tmp/example" }] }], 1), /некорректные/);
});

test("known local provenance remains attribution without accepting arbitrary schemes", () => {
  const local = { ...entry, sources: [{ ...entry.sources[0], url: "local://curated-basic-v1" }] };
  assert.deepEqual(parsePublicEntries([local], 1), [local]);
});

test("the complete generated public deck passes the actual browser loader", async () => {
  const directory = new URL("../public/decks/", import.meta.url);
  const manifestBytes = await readFile(new URL("manifest.json", directory), "utf8");
  const actualManifest = parsePublicManifest(JSON.parse(manifestBytes));
  const cardsBytes = await readFile(new URL(actualManifest.file, directory));
  const fetcher = (async (url: string | URL | Request) => new Response(String(url).endsWith("manifest.json") ? manifestBytes : cardsBytes)) as typeof fetch;
  const result = await loadPublicDeck("/repo/", fetcher);
  assert.equal(result.entries.length, actualManifest.recordCount);
  assert.equal(result.manifest.sha256, createHash("sha256").update(cardsBytes).digest("hex"));
  assert.ok(result.entries.some(item => item.sources.some(source => source.url === "local://curated-basic-v1")));
});
