import assert from "node:assert/strict";
import { test } from "node:test";
import { getEntries, getStats, openDatabase, patchEntry } from "./database.ts";
import { confirmOnlineWord, parseDictionaryPage, searchOnlineDictionary, searchAllOnlineSources } from "./onlineDictionary.ts";
import { searchTatoeba } from "./tatoebaSearch.ts";

const turkishPage = `= {{-en-}} =
==== Значение ====
# чужой язык
= {{-tr-}} =
{{сущ tr}}
==== Значение ====
# [[будущее]] {{пример|{{выдел|Gelecek}} güzel.|перевод=Будущее прекрасно.}}
==== Синонимы ====
# другое
{{гл tr}}
==== Значение ====
# [[прийти|придёт]] {{пример|Yarın gelecek.|перевод=Завтра придёт.}}
= {{-ru-}} =
==== Значение ====
# чужое значение`;

test("online parser isolates Turkish senses and their translated examples", () => {
  const words = parseDictionaryPage("gelecek", turkishPage);
  assert.equal(words.length, 2);
  assert.equal(words[0]?.russian, "будущее");
  assert.equal(words[0]?.exampleTurkish, "Gelecek güzel.");
  assert.equal(words[0]?.partOfSpeech, "существительное");
  assert.equal(words[1]?.russian, "придёт");
  assert.equal(words[1]?.partOfSpeech, "глагол");
});

test("Russian lookup reads only Turkish translations and preserves the sense", () => {
  const words = parseDictionaryPage("ключ", `= {{-ru-}} =
{{перев-блок|для двери
|en=[[key]]
|tr=[[anahtar]], {{t|tr|açkı}}
}}
{{перев-блок|источник
|tr=[[pınar]]
}}`);
  assert.deepEqual(words.map(word => word.turkish), ["anahtar", "açkı", "pınar"]);
  assert.equal(words[2]?.russian, "ключ (источник)");
  assert.ok(words.every(word => !word.exampleTurkish));
});

test("search is read-only, confirmation saves provenance and two cards without overwriting an existing card", async () => {
  const database = openDatabase(":memory:");
  try {
    const before = getStats(database);
    const fetcher = (async () => new Response(JSON.stringify({ query: { pages: [{ title: "gelecek", revisions: [{ slots: { main: { content: turkishPage } } }] }] } }))) as typeof fetch;
    const words = await searchOnlineDictionary("gelecek", fetcher);
    assert.equal(getStats(database).entries, before.entries);
    assert.equal(confirmOnlineWord(database, "unknown"), null);
    const first = confirmOnlineWord(database, words[0]!.id)!;
    assert.equal(getStats(database).cards, before.cards + 2);
    assert.equal(first.effective.sourceName, "Викисловарь");
    assert.match(first.effective.sourceUrl ?? "", /wiktionary/);
    assert.equal(first.examples[0]?.sourceName, "Викисловарь");
    patchEntry(database, first.effective.id, { russian: "Мой перевод" });
    const repeated = confirmOnlineWord(database, words[0]!.id)!;
    assert.equal(repeated.effective.russian, "Мой перевод");
    assert.equal(getEntries(database, "gelecek", 20, 0).total, 1);
  } finally { database.close(); }
});

test("network failure is distinct from no dictionary entry", async () => {
  const empty = (async () => new Response(JSON.stringify({ query: { pages: [{ title: "missing", missing: true }] } }))) as typeof fetch;
  assert.deepEqual(await searchOnlineDictionary("missing", empty), []);
  const unavailable = (async () => new Response("", { status: 503 })) as typeof fetch;
  await assert.rejects(searchOnlineDictionary("missing", unavailable), /недоступен/);
});

const sentencePair = {
  id: 101, lang: "tur", text: "Gelecek güzel.", owner: "TurkishAuthor", license: "CC BY 2.0 FR", is_unapproved: false,
  translations: [
    { id: 102, lang: "rus", text: "Будущее прекрасно.", owner: "RussianAuthor", license: "CC BY 2.0 FR", is_direct: true },
    { id: 103, lang: "rus", text: "Косвенный перевод.", license: "CC BY 2.0 FR", is_direct: false },
  ],
};

test("second source uses direct pairs and persists selected example provenance", async () => {
  const fetcher = (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    return new Response(JSON.stringify(url.includes("tatoeba") ? { data: [sentencePair] }
      : { query: { pages: [{ title: "gelecek", revisions: [{ slots: { main: { content: turkishPage } } }] }] } }));
  }) as typeof fetch;
  const { candidates, warnings } = await searchAllOnlineSources("gelecek", fetcher);
  assert.deepEqual(warnings, []);
  assert.equal(candidates.length, 3);
  const word = candidates[0]!;
  assert.equal(word.examples?.length, 1);
  assert.equal(candidates[2]?.sourceName, "Tatoeba");
  const database = openDatabase(":memory:");
  try {
    assert.equal(confirmOnlineWord(database, word.id, "forged-id"), null);
    const detail = confirmOnlineWord(database, word.id, word.examples![0]!.id)!;
    assert.equal(detail.effective.sourceName, "Викисловарь");
    assert.equal(detail.effective.exampleSource, "Tatoeba (TurkishAuthor, RussianAuthor)");
    assert.equal(detail.effective.exampleSourceUrl, "https://tatoeba.org/en/sentences/show/101");
    assert.equal(detail.effective.exampleTranslationSourceUrl, "https://tatoeba.org/en/sentences/show/102");
    assert.equal(detail.examples[0]?.sourceLicense, "CC BY 2.0 FR");
  } finally { database.close(); }
});

test("Tatoeba searches Russian input in reverse and ignores indirect translations", async () => {
  const fetcher = (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("lang"), "rus");
    assert.equal(url.searchParams.get("trans:lang"), "tur");
    return new Response(JSON.stringify({ data: [{
      ...sentencePair, id: 102, lang: "rus", text: "Будущее прекрасно.",
      translations: [{ ...sentencePair, is_direct: true }],
    }] }));
  }) as typeof fetch;
  const pairs = await searchTatoeba("будущее", fetcher);
  assert.equal(pairs[0]?.turkish, "Gelecek güzel.");
  assert.equal(pairs[0]?.russian, "Будущее прекрасно.");
});

test("one online source can fail while the other still supplies results", async () => {
  const fetcher = (async (input: Parameters<typeof fetch>[0]) => String(input).includes("tatoeba")
    ? new Response(JSON.stringify({ data: [sentencePair] })) : new Response("", { status: 503 })) as typeof fetch;
  const result = await searchAllOnlineSources("gelecek", fetcher);
  assert.equal(result.candidates.length, 1);
  assert.match(result.warnings[0] ?? "", /Викисловарь недоступен/);
});
