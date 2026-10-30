import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { kaikkiExpansion } from "./data/kaikkiExpansion.ts";
import {
  isReliableExamplePair,
} from "./dataQuality.ts";
import {
  applyUpdate,
  normalizeTurkishKey,
  previewUpdate,
  writeUpdatePackage,
  type UpdateCardRecord,
} from "./updatePackage.ts";

type ImportOptions = {
  limit?: number;
  query?: string;
};

type ExistingRow = {
  turkish: string;
};

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultImportPackageDirectory = process.env.IMPORT_PACKAGE_DIRECTORY
  ?? resolve(moduleDirectory, "../update-packages/dictionary-import");

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

function clampImportLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 50;
  }

  return Math.min(parsed, 500);
}

function kaikkiPageUrl(word: string) {
  const lower = normalizeTurkishKey(word);
  const first = encodeURIComponent(lower.slice(0, 1));
  const firstTwo = encodeURIComponent(lower.slice(0, 2));
  const encodedWord = encodeURIComponent(lower);
  return `https://kaikki.org/trwiktionary/T%C3%BCrk%C3%A7e/meaning/${first}/${firstTwo}/${encodedWord}.html`;
}

function isUsefulCandidate(record: {
  exampleRussian: string;
  exampleTurkish: string;
  russian: string;
  turkish: string;
}) {
  const word = record.turkish.trim();
  const russian = record.russian.trim();

  return (
    word.length >= 4 &&
    word.length <= 28 &&
    russian.length >= 2 &&
    russian.length <= 90 &&
    !/\d/.test(word) &&
    isReliableExamplePair(record)
  );
}

function matchesQuery(record: { partOfSpeech: string; russian: string; turkish: string }, query: string) {
  if (!query) {
    return true;
  }

  const normalizedQuery = query.toLocaleLowerCase("ru-RU").trim();
  const haystack = [
    record.turkish.toLocaleLowerCase("tr-TR"),
    record.russian.toLocaleLowerCase("ru-RU"),
    posMap[record.partOfSpeech] ?? record.partOfSpeech,
  ].join(" ");

  return haystack.includes(normalizedQuery);
}

function getExistingKeys(database: DatabaseSync) {
  const rows = database.prepare("SELECT turkish FROM entries").all() as ExistingRow[];
  return new Set(rows.map((row) => normalizeTurkishKey(row.turkish)));
}

function buildCandidateRecords(database: DatabaseSync, options: ImportOptions = {}) {
  const limit = clampImportLimit(options.limit);
  const query = options.query?.trim() ?? "";
  const existingKeys = getExistingKeys(database);
  const selected: UpdateCardRecord[] = [];
  const seen = new Set(existingKeys);

  for (const entry of kaikkiExpansion) {
    const key = normalizeTurkishKey(entry.turkish);
    if (seen.has(key) || selected.length >= limit) {
      continue;
    }

    if (!isUsefulCandidate(entry) || !matchesQuery(entry, query)) {
      continue;
    }

    selected.push({
      category: "Kaikki/Wiktionary",
      exampleRussian: entry.exampleRussian,
      exampleSource: "Tatoeba",
      exampleSourceLicense: "CC BY 2.0 FR",
      exampleSourceUrl: entry.exampleSourceUrl,
      exampleTurkish: entry.exampleTurkish,
      exampleTranslationSourceUrl: entry.exampleTranslationSourceUrl,
      partOfSpeech: posMap[entry.partOfSpeech] ?? entry.partOfSpeech,
      russian: entry.russian,
      sourceLicense: "Wiktionary data via Kaikki/Wiktextract; examples from Tatoeba",
      sourceName: "Kaikki/trwiktionary",
      sourceUrl: kaikkiPageUrl(entry.turkish),
      turkish: entry.turkish,
    });
    seen.add(key);
  }

  return selected;
}

export function prepareDictionaryImportPackage(
  database: DatabaseSync,
  options: ImportOptions = {},
  packageDirectory = defaultImportPackageDirectory,
) {
  mkdirSync(packageDirectory, { recursive: true });

  const records = buildCandidateRecords(database, options);
  const version = `dictionary-import-${new Date().toISOString().slice(0, 10)}-${records.length}`;
  const manifest = writeUpdatePackage(records, version, packageDirectory, {
    source: {
      license: "Wiktionary data via Kaikki/Wiktextract; examples from Tatoeba CC BY 2.0 FR",
      name: "Kaikki/Wiktionary + Tatoeba",
      url: "https://kaikki.org/trwiktionary/rawdata.html",
    },
    updateMode: "append",
  });

  return {
    manifest,
    preview: previewUpdate(database, packageDirectory),
  };
}

export function applyDictionaryImportPackage(
  database: DatabaseSync,
  packageDirectory = defaultImportPackageDirectory,
) {
  return applyUpdate(database, packageDirectory);
}
