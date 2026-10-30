import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import {
  createUserEntry, getEntries, getEntryDetail, getEntryFilterOptions,
  getNextCard, getQueueStats, openDatabase, patchEntry, recordReview, undoReview, getStudyCard, EntryValidationError,
} from "./database.ts";
import {
  applyUpdate, getUpdateStatus, previewUpdate, rollbackLastUpdate,
  UpdateRollbackConflictError, writeUpdatePackage, type UpdateCardRecord,
} from "./updatePackage.ts";

function fixture(context: TestContext, persistent = false) {
  const directory = mkdtempSync(join(tmpdir(), "turkish-flashcards-test-"));
  const path = persistent ? join(directory, "test.db") : ":memory:";
  let database = openDatabase(path);
  context.after(() => {
    database.close();
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
    rmdirSync(directory);
  });
  return {
    directory,
    get database() { return database; },
    reopen() { database.close(); database = openDatabase(path); },
    package(records: UpdateCardRecord[], updateMode: "append" | "full" = "append") {
      writeUpdatePackage(records, "test-v1", directory, { updateMode });
      return directory;
    },
  };
}

function record(turkish: string, russian = "обновлённый перевод"): UpdateCardRecord {
  return {
    turkish, russian, category: "Тестовая коллекция", partOfSpeech: "слово",
    exampleTurkish: "Yeni örnek.", exampleRussian: "Новый пример.",
    exampleSource: "Test", exampleSourceLicense: "Test license",
    exampleSourceUrl: "https://example.com/example",
    exampleTranslationSourceUrl: "https://example.com/translation",
    sourceName: "Test", sourceLicense: "Test license", sourceUrl: "https://example.com/",
  };
}

function detail(database: ReturnType<typeof openDatabase>, id: number) {
  const result = getEntryDetail(database, id);
  assert.ok(result);
  return result;
}

test("full updates preserve personal words, including package word collisions", (context) => {
  const f = fixture(context);
  const personal = createUserEntry(f.database, { turkish: "kişisel-test", russian: "мой перевод" });
  const absent = createUserEntry(f.database, { turkish: "başka-test", russian: "другое слово" });
  assert.ok(personal && absent);
  const directory = f.package([record("merhaba"), record("kişisel-test", "чужой перевод")], "full");
  const preview = previewUpdate(f.database, directory);
  assert.equal(preview.added, 0);
  assert.equal(preview.disabled, 249);
  assert.deepEqual(applyUpdate(f.database, directory), preview);
  for (const created of [personal, absent]) {
    const current = detail(f.database, created.effective.id);
    assert.deepEqual(current.base, created.base);
    assert.equal(getEntries(f.database, current.effective.turkish, 10, 0).total, 1);
    assert.ok(current.cards.every((card) => card.enabled));
  }
});

test("rollback changes only its own rows and preserves subsequent personal additions", (context) => {
  const f = fixture(context);
  applyUpdate(f.database, f.package([record("imported-test")]));
  const imported = getEntries(f.database, "imported-test", 1, 0).entries[0]!;
  const personal = createUserEntry(f.database, { turkish: "later-test", russian: "позже", tags: ["личное"] });
  assert.ok(personal);
  const unrelated = getEntries(f.database, "merhaba", 1, 0).entries[0]!;
  f.database.prepare("UPDATE entries SET russian = ? WHERE id = ?").run("более поздняя правка", unrelated.id);
  rollbackLastUpdate(f.database);
  assert.deepEqual(detail(f.database, personal.effective.id), personal);
  assert.equal(detail(f.database, unrelated.id).base.russian, "более поздняя правка");
  assert.equal(getEntries(f.database, "imported-test", 10, 0).total, 0);
  assert.ok(detail(f.database, imported.id).cards.every((card) => !card.enabled));
  assert.equal(getUpdateStatus(f.database, f.directory).lastUpdate, null);
});

test("apply, rollback, apply restores all imported cards and retains review progress", (context) => {
  const f = fixture(context);
  const initialPreview = previewUpdate(f.database);
  applyUpdate(f.database);
  const imported = f.database.prepare(`
    SELECT cards.id, cards.entry_id AS entryId FROM cards
    JOIN entries ON entries.id = cards.entry_id
    JOIN sources ON sources.id = entries.source_id WHERE sources.source_key = 'kaikki-wiktionary' LIMIT 1
  `).get() as { id: number; entryId: number };
  assert.ok(imported);
  recordReview(f.database, imported.id, "correct");
  patchEntry(f.database, imported.entryId, { status: "ARCHIVED", tags: [], exampleTurkish: "", exampleRussian: "" });
  const state = f.database.prepare("SELECT * FROM review_state WHERE card_id = ?").get(imported.id);
  rollbackLastUpdate(f.database);
  const preview = previewUpdate(f.database);
  assert.equal(preview.added, 0);
  assert.equal(preview.changed, initialPreview.added + initialPreview.changed);
  applyUpdate(f.database);
  assert.equal(f.database.prepare("SELECT COUNT(*) AS count FROM entries WHERE active = 1").get()!.count, 600);
  assert.equal(f.database.prepare("SELECT COUNT(*) AS count FROM cards WHERE enabled = 1").get()!.count, 1200);
  assert.deepEqual(f.database.prepare("SELECT * FROM review_state WHERE card_id = ?").get(imported.id), state);
  assert.equal(f.database.prepare("SELECT COUNT(*) AS count FROM review_log WHERE card_id = ?").get(imported.id)!.count, 1);
  const current = detail(f.database, imported.entryId);
  assert.equal(current.effective.status, "ARCHIVED");
  assert.deepEqual(current.effective.tags, []);
  assert.equal(current.effective.exampleTurkish, "");
});

test("reopening preserves updated seed content, metadata and disabled seed entries", (context) => {
  const f = fixture(context, true);
  applyUpdate(f.database, f.package([record("merhaba")], "full"));
  const entry = getEntries(f.database, "merhaba", 1, 0).entries[0]!;
  const before = detail(f.database, entry.id);
  const counts = f.database.prepare("SELECT COUNT(*) AS count FROM entries WHERE active = 1").get();
  f.reopen();
  assert.deepEqual(detail(f.database, entry.id), before);
  assert.deepEqual(f.database.prepare("SELECT COUNT(*) AS count FROM entries WHERE active = 1").get(), counts);
  assert.equal(detail(f.database, entry.id).base.russian, "обновлённый перевод");
});

test("tag replacement and clearing agree across details, dictionary, filters and study queue", (context) => {
  const f = fixture(context, true);
  const created = createUserEntry(f.database, {
    turkish: "tag-test", russian: "теги", tags: ["старый-тег"], category: "Личная тестовая",
  });
  assert.ok(created);
  const id = created.effective.id;
  patchEntry(f.database, id, { tags: ["новый-тег", "новый-тег"] });
  assert.deepEqual(detail(f.database, id).effective.tags, ["новый-тег"]);
  assert.deepEqual(detail(f.database, id).base.tags, ["старый-тег"]);
  assert.equal(getEntries(f.database, "tag-test", 10, 0, { tag: "старый-тег" }).total, 0);
  assert.equal(getQueueStats(f.database, new Date(), { tag: "новый-тег" }).newTotal, 2);
  patchEntry(f.database, id, { tags: [] });
  patchEntry(f.database, id, { category: "Другая тестовая" });
  f.reopen();
  assert.deepEqual(detail(f.database, id).effective.tags, []);
  assert.deepEqual(getEntries(f.database, "tag-test", 1, 0).entries[0]!.tags, []);
  const options = getEntryFilterOptions(f.database).tags;
  assert.ok(!options.includes("старый-тег") && !options.includes("новый-тег"));
  assert.equal(getQueueStats(f.database, new Date(), { tag: "старый-тег" }).newTotal, 0);
  assert.equal(getNextCard(f.database, "tr-ru", new Date(), { tag: "новый-тег" }), undefined);
  const seeded = getEntries(f.database, "merhaba", 1, 0).entries[0]!;
  patchEntry(f.database, seeded.id, { tags: ["A1"] });
  assert.deepEqual(detail(f.database, seeded.id).effective.tags, ["A1"]);
  patchEntry(f.database, seeded.id, { tags: [] });
  assert.deepEqual(detail(f.database, seeded.id).effective.tags, []);
});

test("empty examples persist across reopen and updates in dictionary and both study queues", (context) => {
  const f = fixture(context, true);
  const entry = getEntries(f.database, "merhaba", 1, 0).entries[0]!;
  patchEntry(f.database, entry.id, { tags: ["example-test"], exampleTurkish: "", exampleRussian: "" });
  applyUpdate(f.database, f.package([record("merhaba")]));
  rollbackLastUpdate(f.database);
  f.reopen();
  assert.equal(detail(f.database, entry.id).effective.exampleTurkish, "");
  assert.equal(detail(f.database, entry.id).effective.exampleRussian, "");
  assert.equal(getEntries(f.database, "merhaba", 1, 0).entries[0]!.exampleTurkish, "");
  const now = new Date();
  for (const direction of ["tr-ru", "ru-tr"] as const) {
    const card = getNextCard(f.database, direction, now, { tag: "example-test" }) as {
      id: number; exampleTurkish: string; exampleRussian: string;
    };
    assert.equal(card.exampleTurkish, "");
    assert.equal(card.exampleRussian, "");
    recordReview(f.database, card.id, "incorrect", now);
    const due = getNextCard(f.database, direction, new Date(now.getTime() + 360_000), { tag: "example-test" }) as typeof card;
    assert.equal(due.id, card.id);
    assert.equal(due.exampleTurkish, "");
  }
});

test("migration preserves existing tag overrides, including previously saved empty lists", (context) => {
  const f = fixture(context, true);
  const cleared = createUserEntry(f.database, { turkish: "clear-test", russian: "очистка", tags: ["base"] })!;
  const replaced = createUserEntry(f.database, { turkish: "replace-test", russian: "замена", tags: ["base"] })!;
  const inherited = createUserEntry(f.database, { turkish: "inherit-test", russian: "наследование", tags: ["base"] })!;
  patchEntry(f.database, cleared.effective.id, { tags: [] });
  patchEntry(f.database, replaced.effective.id, { tags: ["override"] });
  patchEntry(f.database, inherited.effective.id, { category: "изменена" });
  // Reproduce the schema before tags_overridden existed.
  f.database.exec("DROP VIEW effective_entry_tags; ALTER TABLE entry_overrides DROP COLUMN tags_overridden;");
  f.reopen();
  assert.deepEqual(detail(f.database, cleared.effective.id).effective.tags, []);
  assert.deepEqual(detail(f.database, replaced.effective.id).effective.tags, ["override"]);
  assert.deepEqual(detail(f.database, inherited.effective.id).effective.tags, ["base"]);
});

test("rollback rejects later base edits atomically", (context) => {
  const f = fixture(context);
  applyUpdate(f.database, f.package([record("merhaba"), record("conflict-test")]));
  const entry = getEntries(f.database, "merhaba", 1, 0).entries[0]!;
  f.database.prepare("UPDATE entries SET russian = ? WHERE id = ?").run("последующая правка", entry.id);
  const sources = f.database.prepare("SELECT * FROM sources").all();
  assert.throws(() => rollbackLastUpdate(f.database), UpdateRollbackConflictError);
  assert.deepEqual(f.database.prepare("SELECT * FROM sources").all(), sources);
  assert.equal(detail(f.database, entry.id).base.russian, "последующая правка");
  assert.equal(getEntries(f.database, "conflict-test", 1, 0).total, 1);
  assert.equal(f.database.prepare("SELECT COUNT(*) AS count FROM update_snapshots").get()!.count, 1);
});

test("overrides and reviews made after an update survive rollback without a conflict", (context) => {
  const f = fixture(context);
  const entry = getEntries(f.database, "merhaba", 1, 0).entries[0]!;
  applyUpdate(f.database, f.package([record("merhaba")]));
  patchEntry(f.database, entry.id, { russian: "личный перевод", status: "DISABLED", tags: [], exampleTurkish: "", exampleRussian: "" });
  const cardId = detail(f.database, entry.id).cards[0]!.id;
  recordReview(f.database, cardId, "correct");
  const state = f.database.prepare("SELECT * FROM review_state WHERE card_id = ?").get(cardId);
  rollbackLastUpdate(f.database);
  const current = detail(f.database, entry.id);
  assert.equal(current.base.russian, entry.russian);
  assert.equal(current.effective.russian, "личный перевод");
  assert.equal(current.effective.status, "DISABLED");
  assert.deepEqual(current.effective.tags, []);
  assert.equal(current.effective.exampleTurkish, "");
  assert.deepEqual(f.database.prepare("SELECT * FROM review_state WHERE card_id = ?").get(cardId), state);
});

test("consecutive rollbacks preserve personal entries created between updates", (context) => {
  const f = fixture(context);
  applyUpdate(f.database, f.package([record("first-test")]));
  const personal = createUserEntry(f.database, { turkish: "between-test", russian: "между" })!;
  applyUpdate(f.database, f.package([record("second-test")]));
  rollbackLastUpdate(f.database);
  assert.equal(getEntries(f.database, "first-test", 1, 0).total, 1);
  assert.equal(getEntries(f.database, "second-test", 1, 0).total, 0);
  rollbackLastUpdate(f.database);
  assert.equal(getEntries(f.database, "first-test", 1, 0).total, 0);
  assert.deepEqual(detail(f.database, personal.effective.id), personal);
});

test("legacy snapshots roll back package rows while retaining later personal additions", (context) => {
  const f = fixture(context);
  const before = {
    sources: f.database.prepare("SELECT * FROM sources").all(),
    entries: f.database.prepare("SELECT * FROM entries").all(),
    cards: f.database.prepare("SELECT * FROM cards").all(),
    translations: f.database.prepare("SELECT * FROM entry_translation_items WHERE layer = 'base'").all(),
    examples: f.database.prepare("SELECT * FROM entry_example_items WHERE layer = 'base'").all(),
  };
  applyUpdate(f.database, f.package([record("merhaba"), record("legacy-test")]));
  f.database.prepare("UPDATE update_snapshots SET snapshot_json = ?").run(JSON.stringify(before));
  const personal = createUserEntry(f.database, { turkish: "legacy-personal-test", russian: "позже" })!;
  f.database.prepare("UPDATE entries SET updated_at = ? WHERE id = ?").run("2099-01-01T00:00:00.000Z", personal.effective.id);
  const expectedPersonal = detail(f.database, personal.effective.id);
  rollbackLastUpdate(f.database);
  assert.equal(getEntries(f.database, "merhaba", 1, 0).entries[0]!.russian, "привет");
  assert.equal(getEntries(f.database, "legacy-test", 1, 0).total, 0);
  assert.deepEqual(detail(f.database, personal.effective.id), expectedPersonal);
});

test("a failing package leaves dictionary, history and snapshots unchanged", (context) => {
  const f = fixture(context);
  const entries = f.database.prepare("SELECT * FROM entries").all();
  const sources = f.database.prepare("SELECT * FROM sources").all();
  const directory = f.package([record("duplicate-test"), record("duplicate-test")]);
  assert.throws(() => applyUpdate(f.database, directory));
  assert.deepEqual(f.database.prepare("SELECT * FROM entries").all(), entries);
  assert.deepEqual(f.database.prepare("SELECT * FROM sources").all(), sources);
  assert.equal(f.database.prepare("SELECT COUNT(*) AS count FROM update_snapshots").get()!.count, 0);
  assert.equal(f.database.prepare("SELECT COUNT(*) AS count FROM update_history").get()!.count, 0);
});

test("undoing the first answer restores a new card and daily statistics", (context) => {
  const f = fixture(context);
  const time = new Date("2026-10-29T10:00:00.000Z");
  const before = getQueueStats(f.database, time);
  const card = getNextCard(f.database, "tr-ru", time) as { id: number };
  const review = recordReview(f.database, card.id, "incorrect", time)!;
  assert.equal(getQueueStats(f.database, time).reviewedToday, 1);
  assert.deepEqual(undoReview(f.database, review.undoToken), { cardId: card.id, restored: true });
  assert.deepEqual(getQueueStats(f.database, time), before);
  assert.equal(f.database.prepare("SELECT * FROM review_state WHERE card_id = ?").get(card.id), undefined);
  assert.equal(undoReview(f.database, review.undoToken), null);
});

test("undoing a repeat restores all previous scheduling fields across reopen", (context) => {
  const f = fixture(context, true);
  const card = getNextCard(f.database, "tr-ru") as { id: number };
  recordReview(f.database, card.id, "correct", new Date("2026-10-28T10:00:00.000Z"));
  const before = f.database.prepare("SELECT * FROM review_state WHERE card_id = ?").get(card.id);
  const answer = recordReview(f.database, card.id, "incorrect", new Date("2026-10-29T10:00:00.000Z"))!;
  f.reopen();
  assert.ok(undoReview(f.database, answer.undoToken));
  assert.deepEqual(f.database.prepare("SELECT * FROM review_state WHERE card_id = ?").get(card.id), before);
  assert.equal(f.database.prepare("SELECT COUNT(*) AS count FROM review_log").get()!.count, 1);
});

test("undo refuses outdated tokens and later changes to review state", (context) => {
  const f = fixture(context);
  const cards = f.database.prepare("SELECT id FROM cards LIMIT 2").all() as { id: number }[];
  const first = recordReview(f.database, cards[0]!.id, "correct")!;
  const second = recordReview(f.database, cards[1]!.id, "correct")!;
  assert.equal(undoReview(f.database, first.undoToken), null);
  f.database.prepare("UPDATE review_state SET repetitions = repetitions + 1 WHERE card_id = ?").run(cards[1]!.id);
  assert.equal(undoReview(f.database, second.undoToken), null);
  assert.equal(f.database.prepare("SELECT COUNT(*) AS count FROM review_log").get()!.count, 2);
});

test("review and new modes select their own queue and resume the same eligible card", (context) => {
  const f = fixture(context);
  const now = new Date("2026-10-29T10:00:00.000Z");
  const old = getNextCard(f.database, "tr-ru", now) as { id: number; entryId: number };
  recordReview(f.database, old.id, "incorrect", new Date(now.getTime() - 360_000));
  assert.equal((getNextCard(f.database, "tr-ru", now, {}, "review") as { id: number }).id, old.id);
  const fresh = getNextCard(f.database, "tr-ru", now, {}, "new") as { id: number };
  assert.notEqual(fresh.id, old.id);
  patchEntry(f.database, old.entryId, { russian: "исправлено в редакторе" });
  assert.equal(getStudyCard(f.database, old.id, "tr-ru", now)?.russian, "исправлено в редакторе");
  assert.equal((getNextCard(f.database, "tr-ru", now, {}, "all", old.id) as { id: number }).id, old.id);
  assert.equal(getStudyCard(f.database, old.id, "tr-ru", now, {}, "new"), undefined);
  assert.equal(getStudyCard(f.database, old.id, "ru-tr", now), undefined);
  assert.equal(getStudyCard(f.database, old.id, "tr-ru", now, { tag: "missing" }), undefined);
  patchEntry(f.database, old.entryId, { status: "DISABLED" });
  assert.equal(getStudyCard(f.database, old.id, "tr-ru", now), undefined);
  assert.equal(getNextCard(f.database, "tr-ru", now, {}, "review"), undefined);
});

test("full updates preserve internet-confirmed words and their attribution", (context) => {
  const f = fixture(context);
  const personal = createUserEntry(f.database, { turkish: "web-test", russian: "выбрано в интернете" },
    { name: "Викисловарь", url: "https://ru.wiktionary.org/wiki/web-test", license: "CC BY-SA 4.0" })!;
  const directory = f.package([record("merhaba"), record("web-test", "не менять")], "full");
  applyUpdate(f.database, directory);
  assert.deepEqual(detail(f.database, personal.effective.id), personal);
  assert.equal(getEntries(f.database, "web-test", 10, 0).total, 1);
});

test("required fields reject blank and non-string patches without changing the entry", (context) => {
  const f = fixture(context);
  const word = getEntries(f.database, "merhaba", 1, 0).entries[0]!;
  const before = detail(f.database, word.id);
  for (const patch of [{ turkish: " " }, { russian: "" }, { russian: 42 }, { tags: [1] }, { status: "unknown" }]) {
    assert.throws(() => patchEntry(f.database, word.id, patch as Parameters<typeof patchEntry>[2]), EntryValidationError);
    assert.deepEqual(detail(f.database, word.id), before);
  }
});

test("manual examples show user provenance consistently in details, dictionary and study", (context) => {
  const f = fixture(context);
  const word = getEntries(f.database, "merhaba", 1, 0).entries[0]!;
  patchEntry(f.database, word.id, { exampleTurkish: "Yeni örnek.", exampleRussian: "Мой пример.", tags: ["provenance-test"] });
  const entries = [detail(f.database, word.id).effective, getEntries(f.database, "merhaba", 1, 0).entries[0]!,
    getNextCard(f.database, "tr-ru", new Date(), { tag: "provenance-test" }) as { exampleSource: string; exampleSourceUrl: string }];
  for (const entry of entries) { assert.equal(entry.exampleSource, "Пользователь"); assert.equal(entry.exampleSourceUrl, ""); }
});

test("next repetition uses the earlier direction", (context) => {
  const f = fixture(context);
  const word = getEntries(f.database, "merhaba", 1, 0).entries[0]!;
  const [first, second] = detail(f.database, word.id).cards;
  const time = new Date("2026-10-29T10:00:00.000Z");
  const due = recordReview(f.database, first!.id, "incorrect", time)!;
  recordReview(f.database, second!.id, "correct", time);
  assert.equal(detail(f.database, word.id).review.dueAt, due.dueAt);
});
