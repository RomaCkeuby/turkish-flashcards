import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUserEntry, deleteEntry, getEntries, getEntryDetail, getNextCard, getQueueStats, getStats,
  getStudyCard, mergeEntries, openDatabase, patchEntry, recordReview, restoreEntry, undoReview } from "./database.ts";
import { auditDictionary, checkLocalEntry, meaningKeys, verifyEntry } from "./entryQuality.ts";
import { correctKnownSense } from "./knownCorrections.ts";
import { repairKnownDataQualityIssues } from "./dataQuality.ts";
import { applyUpdate, readUpdatePackage, rollbackLastUpdate, writeUpdatePackage } from "./updatePackage.ts";

test("meaning comparison handles case, ё, punctuation and multiple meanings without substring collisions", () => {
  assert.deepEqual(meaningKeys(" Ёлка (дерево); ЕЛКА, яблоко! "), ["елка", "яблоко"]);
  const db = openDatabase(":memory:");
  try {
    const match = checkLocalEntry(db, { turkish: "alma", russian: "ЯБЛОКО", exampleTurkish: "Karar alma zamanı.", exampleRussian: "Пора принимать решение!" });
    assert.ok(match.matches.some(item => item.turkish === "elma"));
    assert.ok(match.warnings.some(item => item.includes("Пример")));
    assert.equal(checkLocalEntry(db, { turkish: "xxx", russian: "ябл", exampleRussian: "", exampleTurkish: "" }).matches.length, 0);
    const elma = getEntries(db, "elma", 1, 0).entries[0]!;
    patchEntry(db, elma.id, { russian: "мой фрукт" });
    assert.equal(checkLocalEntry(db, { turkish: "xxx", russian: "яблоко", exampleRussian: "", exampleTurkish: "" }).matches.length, 0);
    createUserEntry(db, { turkish: "тест", russian: "МОЙ ФРУКТ" });
    assert.ok(auditDictionary(db).groups.some(group => group.key === "мой фрукт"));
  } finally { db.close(); }
});

test("alma correction fixes only the mismatched sense and preserves overrides and review state", () => {
  const db = openDatabase(":memory:");
  try {
    const entry = getEntries(db, "elma", 1, 0).entries[0]!;
    db.prepare("UPDATE entries SET turkish = 'alma', russian = 'яблоко', example_turkish = 'Karar alma zamanı.' WHERE id = ?").run(entry.id);
    patchEntry(db, entry.id, { russian: "моя правка" });
    const card = getEntryDetail(db, entry.id)!.cards[0]!;
    recordReview(db, card.id, "correct");
    const state = db.prepare("SELECT * FROM review_state WHERE card_id = ?").get(card.id);
    repairKnownDataQualityIssues(db);
    const fixed = getEntryDetail(db, entry.id)!;
    assert.equal(fixed.effective.russian, "моя правка");
    assert.match(fixed.base.russian, /принятие/);
    assert.match(fixed.translations.find(item => item.layer === "base")!.text, /принятие/);
    assert.deepEqual(db.prepare("SELECT * FROM review_state WHERE card_id = ?").get(card.id), state);
    const historyCount = fixed.history.length;
    repairKnownDataQualityIssues(db);
    assert.equal(getEntryDetail(db, entry.id)!.history.length, historyCount);
    const unrelated = { turkish: "alma", russian: "яблоко", partOfSpeech: "noun", exampleTurkish: "Alma ağacı." };
    assert.equal(correctKnownSense(unrelated), unrelated);
  } finally { db.close(); }
});

test("deletion hides both directions, rejects edits/reviews, survives updates and is recoverable", (context) => {
  const db = openDatabase(":memory:");
  try {
    const word = getEntries(db, "elma", 1, 0).entries[0]!;
    const detail = getEntryDetail(db, word.id)!;
    const review = recordReview(db, detail.cards[0]!.id, "correct")!;
    const queue = getQueueStats(db);
    deleteEntry(db, word.id);
    assert.equal(getEntries(db, "elma", 10, 0).total, 0);
    assert.equal(getQueueStats(db).newTotal, queue.newTotal - 1);
    for (const card of detail.cards) {
      assert.equal(getStudyCard(db, card.id, card.direction), undefined);
      assert.equal(recordReview(db, card.id, "incorrect"), null);
    }
    assert.equal(undoReview(db, review.undoToken), null);
    assert.throws(() => patchEntry(db, word.id, { russian: "плохая правка" }));
    const directory = mkdtempSync(join(tmpdir(), "quality-package-"));
    context.after(() => { for (const file of readdirSync(directory)) unlinkSync(join(directory, file)); rmdirSync(directory); });
    writeUpdatePackage([{ ...word, sourceUrl: "https://example.com" }], "test", directory, { updateMode: "append" });
    applyUpdate(db, directory);
    assert.equal(getEntries(db, "elma", 10, 0).total, 0);
    assert.equal(getStudyCard(db, detail.cards[1]!.id, detail.cards[1]!.direction), undefined);
    rollbackLastUpdate(db);
    assert.equal(getEntries(db, "elma", 10, 0).total, 0);
    restoreEntry(db, word.id);
    assert.equal(getEntries(db, "elma", 10, 0).total, 1);
    assert.equal(getEntryDetail(db, word.id)!.review.repetitions, 1);
  } finally { db.close(); }
});

test("merge preserves target fields, combines tags, provenance and review logs, and hides source", () => {
  const db = openDatabase(":memory:");
  try {
    const source = createUserEntry(db, { turkish: "source-test", russian: "общий смысл", tags: ["источник"], exampleTurkish: "Source.", exampleRussian: "Пример." })!;
    const target = createUserEntry(db, { turkish: "target-test", russian: "другой смысл", tags: ["приёмник"] })!;
    patchEntry(db, source.effective.id, { russian: "исправленный смысл", exampleRussian: "Правка." });
    const sourceReview = recordReview(db, source.cards[0]!.id, "correct")!;
    recordReview(db, target.cards[0]!.id, "incorrect");
    const stats = getStats(db);
    const merged = mergeEntries(db, source.effective.id, target.effective.id)!;
    assert.equal(merged.effective.russian, "другой смысл");
    assert.equal(merged.effective.exampleTurkish, "");
    assert.deepEqual(merged.effective.tags.sort(), ["источник", "приёмник"]);
    assert.ok(merged.translations.some(item => item.text === "исправленный смысл" && !item.isPrimary));
    assert.ok(merged.examples.some(item => item.russian === "Правка."));
    assert.equal(getEntryDetail(db, source.effective.id)!.removal?.targetId, target.effective.id);
    assert.equal(getEntries(db, "source-test", 10, 0).total, 0);
    assert.equal(getStats(db).queue.reviewedToday, stats.queue.reviewedToday);
    assert.equal(merged.review.repetitions, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM review_log WHERE card_id = ?").get(target.cards[0]!.id)?.n, 2);
    assert.equal(undoReview(db, sourceReview.undoToken), null);
    assert.throws(() => mergeEntries(db, source.effective.id, target.effective.id));
    assert.throws(() => restoreEntry(db, source.effective.id));
    patchEntry(db, target.effective.id, { russian: "новый основной", exampleTurkish: "Target.", exampleRussian: "Новый пример." });
    const edited = getEntryDetail(db, target.effective.id)!;
    assert.equal(edited.translations.find(item => item.layer === "override" && item.isPrimary)?.text, "новый основной");
    assert.equal(edited.effective.exampleTurkish, "Target.");
    assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
    assert.throws(() => mergeEntries(db, target.effective.id, target.effective.id));
    assert.ok(getNextCard(db, "tr-ru"));
  } finally { db.close(); }
});

test("online verification distinguishes matching, different, absent and unavailable evidence and never edits", async () => {
  const db = openDatabase(":memory:");
  try {
    const word = getEntries(db, "elma", 1, 0).entries[0]!;
    const before = getEntryDetail(db, word.id);
    const fetcher = (async (input: Parameters<typeof fetch>[0]) => {
      if (String(input).includes("sozluk.gov.tr")) return new Response(JSON.stringify([{ madde: "elma", anlamlarListe: [{ anlam: "Elma ağacının meyvesi." }] }]));
      const title = new URL(String(input)).searchParams.get("titles");
      const text = title === "elma" ? "= {{-tr-}} =\n{{сущ tr}}\n==== Значение ====\n# [[яблоко]]" : "= {{-ru-}} =\n{{перев-блок|плод\n|tr=[[elma]]\n}}";
      return new Response(JSON.stringify({ query: { pages: [{ title, revisions: [{ slots: { main: { content: text } } }] }] } }));
    }) as typeof fetch;
    const confirmed = (await verifyEntry(db, word.id, fetcher))!;
    assert.ok(confirmed.online.every(result => result.status === "matched"));
    assert.equal(confirmed.turkishDictionary.status, "found");
    assert.deepEqual(confirmed.turkishDictionary.definitions, ["Elma ağacının meyvesi."]);
    const missing = (async () => new Response(JSON.stringify({ query: { pages: [{ title: "x", missing: true }] } }))) as typeof fetch;
    assert.ok((await verifyEntry(db, word.id, missing))!.online.every(result => result.status === "not_found"));
    const down = (async () => { throw new Error("offline"); }) as typeof fetch;
    const unavailable = (await verifyEntry(db, word.id, down))!;
    assert.ok(unavailable.online.every(result => result.status === "unavailable"));
    assert.equal(unavailable.turkishDictionary.status, "unavailable");
    assert.deepEqual(getEntryDetail(db, word.id), before);
    patchEntry(db, word.id, { russian: "неверный перевод" });
    assert.ok((await verifyEntry(db, word.id, fetcher))!.online.some(result => result.status === "differences"));
  } finally { db.close(); }
});

test("old update packages cannot reintroduce the known alma mismatch", (context) => {
  const db = openDatabase(":memory:");
  const directory = mkdtempSync(join(tmpdir(), "alma-package-"));
  context.after(() => { db.close(); for (const file of readdirSync(directory)) unlinkSync(join(directory, file)); rmdirSync(directory); });
  const example = getEntries(db, "elma", 1, 0).entries[0]!;
  writeUpdatePackage([{ ...example, turkish: "alma", russian: "яблоко", exampleTurkish: "Karar alma zamanı.", sourceUrl: "https://example.com" }], "old", directory, { updateMode: "append" });
  assert.match(readUpdatePackage(directory).records[0]!.russian, /принятие/);
  applyUpdate(db, directory);
  assert.deepEqual(getEntries(db, "ЯБЛОКО", 20, 0).entries.map(entry => entry.turkish), ["elma"]);
  assert.match(getEntries(db, "alma", 20, 0).entries.find(entry => entry.turkish === "alma")!.russian, /принятие/);
});
