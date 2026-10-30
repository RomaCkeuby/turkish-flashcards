import { DatabaseSync } from "node:sqlite";

import {
  getEntryDetail,
  patchEntry,
  type EntryDetail,
} from "./database.ts";
import { kaikkiExpansion } from "./data/kaikkiExpansion.ts";
import { seedEntries } from "./data/seed.ts";
import { tatoebaExamples } from "./data/tatoebaExamples.ts";
import { normalizeTurkishKey } from "./updatePackage.ts";

type RefreshCandidate = {
  category?: string;
  exampleRussian?: string;
  exampleSource?: string;
  exampleTurkish?: string;
  partOfSpeech?: string;
  russian?: string;
  sourceName: string;
  sourceUrl?: string;
  turkish: string;
};

export type EntryRefreshSuggestion = {
  changes: {
    field: string;
    from: string;
    to: string;
  }[];
  patch: {
    category?: string;
    exampleRussian?: string;
    exampleTurkish?: string;
    partOfSpeech?: string;
    russian?: string;
    turkish?: string;
  };
  sourceName: string;
  sourceUrl?: string;
};

const posMap: Record<string, string> = {
  adj: "прилагательное",
  adv: "наречие",
  interj: "междометие",
  noun: "существительное",
  num: "числительное",
  phrase: "фраза",
  pron: "местоимение",
  verb: "глагол",
};

function kaikkiPageUrl(word: string) {
  const lower = normalizeTurkishKey(word);
  const first = encodeURIComponent(lower.slice(0, 1));
  const firstTwo = encodeURIComponent(lower.slice(0, 2));
  const encodedWord = encodeURIComponent(lower);
  return `https://kaikki.org/trwiktionary/T%C3%BCrk%C3%A7e/meaning/${first}/${firstTwo}/${encodedWord}.html`;
}

function normalizeText(value: string | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function findTatoebaExample(word: string) {
  const key = normalizeTurkishKey(word);
  const match = Object.entries(tatoebaExamples).find(
    ([turkish]) => normalizeTurkishKey(turkish) === key,
  );

  return match?.[1];
}

function findCandidate(detail: EntryDetail): RefreshCandidate | null {
  const word = detail.effective.turkish;
  const key = normalizeTurkishKey(word);
  const expansion = kaikkiExpansion.find((entry) => normalizeTurkishKey(entry.turkish) === key);
  const seed = seedEntries.find((entry) => normalizeTurkishKey(entry.turkish) === key);
  const example = findTatoebaExample(word);

  if (expansion) {
    return {
      category: detail.effective.category,
      exampleRussian: expansion.exampleRussian,
      exampleSource: "Tatoeba",
      exampleTurkish: expansion.exampleTurkish,
      partOfSpeech: posMap[expansion.partOfSpeech] ?? expansion.partOfSpeech,
      russian: expansion.russian,
      sourceName: "Kaikki/Wiktionary + Tatoeba",
      sourceUrl: kaikkiPageUrl(expansion.turkish),
      turkish: expansion.turkish,
    };
  }

  if (seed || example) {
    return {
      category: seed?.category ?? detail.effective.category,
      exampleRussian: example?.exampleRussian ?? seed?.exampleRussian,
      exampleSource: example?.source ?? seed?.exampleSource,
      exampleTurkish: example?.exampleTurkish ?? seed?.exampleTurkish,
      partOfSpeech: seed?.partOfSpeech ?? detail.effective.partOfSpeech,
      russian: seed?.russian ?? detail.effective.russian,
      sourceName: example ? "Tatoeba" : "Базовая коллекция Turkish Flashcards",
      sourceUrl: example?.sourceUrl,
      turkish: seed?.turkish ?? detail.effective.turkish,
    };
  }

  return null;
}

export function suggestEntryRefresh(
  database: DatabaseSync,
  entryId: number,
): EntryRefreshSuggestion | null {
  const detail = getEntryDetail(database, entryId);
  if (!detail) {
    return null;
  }

  const candidate = findCandidate(detail);
  if (!candidate) {
    return null;
  }

  const patch = {
    category: normalizeText(candidate.category),
    exampleRussian: normalizeText(candidate.exampleRussian),
    exampleTurkish: normalizeText(candidate.exampleTurkish),
    partOfSpeech: normalizeText(candidate.partOfSpeech),
    russian: normalizeText(candidate.russian),
    turkish: normalizeText(candidate.turkish),
  };
  const current = detail.effective;
  const changes = ([
    ["turkish", current.turkish, patch.turkish],
    ["russian", current.russian, patch.russian],
    ["partOfSpeech", current.partOfSpeech, patch.partOfSpeech],
    ["category", current.category, patch.category],
    ["exampleTurkish", current.exampleTurkish, patch.exampleTurkish],
    ["exampleRussian", current.exampleRussian, patch.exampleRussian],
  ] as [string, string, string][])
    .filter(([, , to]) => typeof to === "string" && to.length > 0)
    .filter(([, from, to]) => normalizeText(from) !== normalizeText(to))
    .map(([field, from, to]) => ({ field, from, to }));

  const effectivePatch = Object.fromEntries(
    changes.map((change) => [change.field, change.to]),
  ) as EntryRefreshSuggestion["patch"];

  return {
    changes,
    patch: effectivePatch,
    sourceName: candidate.sourceName,
    sourceUrl: candidate.sourceUrl,
  };
}

export function applyEntryRefresh(database: DatabaseSync, entryId: number) {
  const suggestion = suggestEntryRefresh(database, entryId);
  if (!suggestion || suggestion.changes.length === 0) {
    return null;
  }

  const updated = patchEntry(database, entryId, suggestion.patch);
  return updated ? { detail: updated, suggestion } : null;
}
