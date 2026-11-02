import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { buildPublicDeck, toPublicCard, writePublicDeck, type PublicCardEntry, type PublicDeckManifest } from "./publicDeck.ts";

const record = {
  turkish: "merhaba", russian: "привет", partOfSpeech: "междометие", category: "Общение",
  exampleTurkish: "Merhaba!", exampleRussian: "Привет!", sourceName: "Wiktionary", sourceUrl: "https://example.test/merhaba", sourceLicense: "CC BY-SA",
  exampleSource: "Tatoeba", exampleSourceUrl: "https://example.test/tr/1", exampleTranslationSourceUrl: "https://example.test/ru/2", exampleSourceLicense: "CC BY",
};

function source(directory: string, records: unknown[], override: Record<string, unknown> = {}) {
  const data = gzipSync(records.map(value => JSON.stringify(value)).join("\n") + "\n");
  writeFileSync(resolve(directory, "cards.jsonl.gz"), data);
  writeFileSync(resolve(directory, "manifest.json"), JSON.stringify({ schemaVersion: 1, version: "test-v1", packageFile: "cards.jsonl.gz", recordCount: records.length, sha256: createHash("sha256").update(data).digest("hex"), ...override }));
}

function temporary(run: (directory: string) => void) {
  const directory = mkdtempSync(resolve(tmpdir(), "public-deck-"));
  try { run(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("public allowlist retains all source attribution and excludes private fields", () => {
  const entry: PublicCardEntry = toPublicCard({ ...record, userId: 9, password: "private", reviewLog: [1], tags: ["private-tag"] });
  assert.deepEqual(entry.sources.map(source => source.purpose), ["entry", "example", "exampleTranslation"]);
  assert.deepEqual(entry.sources.map(source => source.url), [record.sourceUrl, record.exampleSourceUrl, record.exampleTranslationSourceUrl]);
  assert.ok(entry.sources.every(source => source.license));
  assert.deepEqual(entry.tags, []);
  assert.ok(!JSON.stringify(entry).includes("private"));
  assert.throws(() => toPublicCard({ ...record, exampleTranslationSourceUrl: "" }), /атрибуцию/);
  assert.throws(() => toPublicCard({ ...record, russian: "" }), /russian/);
});

test("identity survives translation/example changes and order changes; meaning identity changes create a new key", () => {
  const entry = toPublicCard(record);
  assert.equal(entry.key, toPublicCard({ ...record, russian: "здравствуй", exampleTurkish: "Merhaba arkadaş!", category: "Другое" }).key);
  assert.notEqual(entry.key, toPublicCard({ ...record, turkish: "merhabalar" }).key);
  assert.notEqual(entry.key, toPublicCard({ ...record, partOfSpeech: "фраза" }).key);
  temporary(directory => {
    const other = { ...record, turkish: "elma", russian: "яблоко" };
    source(directory, [record, other]);
    const before = buildPublicDeck(directory);
    source(directory, [other, record]);
    const after = buildPublicDeck(directory);
    assert.equal(before.body, after.body);
    assert.deepEqual(before.manifest, after.manifest);
  });
});

test("source checksum, row count, duplicate identities and unsafe package path are checked", () => {
  temporary(directory => {
    source(directory, [record], { sha256: "0".repeat(64) });
    assert.throws(() => buildPublicDeck(directory), /сумма/);
    source(directory, [record], { recordCount: 2 });
    assert.throws(() => buildPublicDeck(directory), /Количество/);
    source(directory, [record, { ...record, russian: "другое" }]);
    assert.throws(() => buildPublicDeck(directory), /идентичность/);
    source(directory, [record], { packageFile: "../cards.jsonl.gz" });
    assert.throws(() => buildPublicDeck(directory), /имя/);
    source(directory, [record], { schemaVersion: 2 });
    assert.throws(() => buildPublicDeck(directory), /версия/);
  });
});

test("publication writes a reproducible complete file before a manifest with correct checksum", () => {
  temporary(directory => {
    source(directory, [record]);
    const output = resolve(directory, "public");
    const manifest: PublicDeckManifest = writePublicDeck(directory, output);
    const data = readFileSync(resolve(output, manifest.file));
    assert.equal(manifest.sha256, createHash("sha256").update(data).digest("hex"));
    assert.deepEqual(JSON.parse(readFileSync(resolve(output, "manifest.json"), "utf8")), manifest);
    assert.equal(JSON.parse(data.toString()).length, manifest.recordCount);
    assert.deepEqual(writePublicDeck(directory, output), manifest);
  });
});

test("known sense correction is also applied when exporting a historical package", () => {
  assert.equal(toPublicCard({ ...record, turkish: "alma", russian: "яблоко", exampleTurkish: "Karar alma zamanı." }).russian, "взятие; получение; покупка; принятие (от almak)");
});
