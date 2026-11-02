import assert from "node:assert/strict";
import { test } from "node:test";
import { createGuestDeck, filterGuestEntries, getGuestFilterOptions } from "../src/guestDeck.ts";
import type { PublicCardEntry } from "../src/publicDeckTypes.ts";

const entries: PublicCardEntry[] = [
  { key: "hello", turkish: "merhaba", russian: "привет", partOfSpeech: "междометие", category: "Общение", tags: ["A1"], exampleTurkish: "", exampleRussian: "", sources: [] },
  { key: "apple", turkish: "elma", russian: "яблоко", partOfSpeech: "существительное", category: "Еда", tags: ["A1", "еда"], exampleTurkish: "", exampleRussian: "", sources: [] },
  { key: "river", turkish: "ırmak", russian: "река", partOfSpeech: "существительное", category: "Природа", tags: [], exampleTurkish: "", exampleRussian: "", sources: [] },
  { key: "work", turkish: "iş", russian: "работа", partOfSpeech: "существительное", category: "Общее", tags: [], exampleTurkish: "", exampleRussian: "", sources: [] },
];

test("a pass contains every matching key exactly once in either direction and preserves input", () => {
  const before = structuredClone(entries);
  for (const direction of ["tr-ru", "ru-tr"] as const) {
    const deck = createGuestDeck(entries, { direction }, () => 0);
    assert.equal(deck.length, entries.length);
    assert.equal(new Set(deck.map(card => card.entry.key)).size, entries.length);
    assert.deepEqual(deck.map(card => card.entry.key).sort(), entries.map(entry => entry.key).sort());
    assert.ok(deck.every(card => card.direction === direction));
    assert.notDeepEqual(deck.map(card => card.entry.key), entries.map(entry => entry.key));
  }
  assert.deepEqual(entries, before);
});

test("combined filters, Turkish case and empty selections work without altering the catalogue", () => {
  assert.deepEqual(filterGuestEntries(entries, { category: "Еда", partOfSpeech: "существительное", tag: "A1", search: "ЯБЛО" }).map(entry => entry.key), ["apple"]);
  assert.deepEqual(filterGuestEntries(entries, { search: "IRMAK" }).map(entry => entry.key), ["river"]);
  assert.deepEqual(filterGuestEntries(entries, { search: "İŞ" }).map(entry => entry.key), ["work"]);
  assert.deepEqual(createGuestDeck(entries, { direction: "tr-ru", tag: "нет" }), []);
  assert.deepEqual(new Set(getGuestFilterOptions(entries).tags), new Set(["A1", "еда"]));
});

test("each new pass is independently shuffled and a single card needs no random number", () => {
  assert.notDeepEqual(createGuestDeck(entries, { direction: "tr-ru" }, () => 0), createGuestDeck(entries, { direction: "tr-ru" }, () => 0.999));
  assert.equal(createGuestDeck(entries.slice(0, 1), { direction: "tr-ru" }, () => { throw new Error("not needed"); }).length, 1);
  assert.deepEqual(createGuestDeck([], { direction: "ru-tr" }), []);
});

test("invalid duplicate keys and invalid random values are rejected", () => {
  assert.throws(() => createGuestDeck([entries[0]!, entries[0]!], { direction: "tr-ru" }), /ключ/);
  for (const random of [1, -0.1, NaN, Infinity]) {
    assert.throws(() => createGuestDeck(entries, { direction: "tr-ru" }, () => random), /Генератор/);
  }
});
