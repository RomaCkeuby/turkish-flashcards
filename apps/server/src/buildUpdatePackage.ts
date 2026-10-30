import { createReadStream } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";

import { kaikkiExpansion } from "./data/kaikkiExpansion.ts";
import { seedEntries } from "./data/seed.ts";
import { isReliableExamplePair } from "./dataQuality.ts";
import {
  normalizeTurkishKey,
  writeUpdatePackage,
  type UpdateCardRecord,
} from "./updatePackage.ts";

type KaikkiTranslation = {
  lang?: string;
  lang_code?: string;
  roman?: string;
  word?: string;
};

type KaikkiRecord = {
  lang?: string;
  lang_code?: string;
  pos?: string;
  pos_title?: string;
  translations?: KaikkiTranslation[];
  word?: string;
};

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const serverDirectory = resolve(moduleDirectory, "..");
const defaultExtractPath = resolve(serverDirectory, "import-cache/tr-extract.jsonl.gz");
const extractPath = process.env.KAIKKI_TR_EXTRACT_PATH ?? defaultExtractPath;
const packageDirectory =
  process.env.UPDATE_PACKAGE_DIR ?? resolve(serverDirectory, "update-packages/current");

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

function isRussianTranslation(translation: KaikkiTranslation) {
  return translation.lang_code === "ru" || translation.lang === "Rusça";
}

function cleanRussianTranslation(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/[;,]\s*$/, "")
    .trim();
}

function getRussianTranslations(record: KaikkiRecord) {
  const translations = record.translations ?? [];
  const words = translations
    .filter(isRussianTranslation)
    .map((translation) => cleanRussianTranslation(translation.word ?? ""))
    .filter(Boolean);

  return [...new Set(words)].slice(0, 3).join("; ");
}

function kaikkiPageUrl(word: string) {
  const lower = normalizeTurkishKey(word);
  const first = encodeURIComponent(lower.slice(0, 1));
  const firstTwo = encodeURIComponent(lower.slice(0, 2));
  const encodedWord = encodeURIComponent(lower);
  return `https://kaikki.org/trwiktionary/T%C3%BCrk%C3%A7e/meaning/${first}/${firstTwo}/${encodedWord}.html`;
}

async function readKaikkiRecords() {
  const records = new Map<string, KaikkiRecord>();
  const stream = createReadStream(extractPath).pipe(createGunzip());
  const reader = createInterface({ crlfDelay: Infinity, input: stream });

  for await (const line of reader) {
    if (!line.trim()) {
      continue;
    }

    const record = JSON.parse(line) as KaikkiRecord;
    if (record.lang_code !== "tr" || !record.word) {
      continue;
    }

    const russian = getRussianTranslations(record);
    if (!russian) {
      continue;
    }

    const key = normalizeTurkishKey(record.word);
    if (!records.has(key)) {
      records.set(key, record);
    }
  }

  return records;
}

async function main() {
  mkdirSync(packageDirectory, { recursive: true });

  const kaikkiRecords = await readKaikkiRecords();
  const records: UpdateCardRecord[] = [];

  for (const entry of seedEntries) {
    const key = normalizeTurkishKey(entry.turkish);
    const kaikki = kaikkiRecords.get(key);
    const russian = kaikki ? getRussianTranslations(kaikki) : entry.russian;

    records.push({
      category: entry.category,
      exampleRussian: entry.exampleRussian,
      exampleSource: entry.exampleSource,
      exampleSourceLicense: entry.exampleSourceLicense,
      exampleSourceUrl: entry.exampleSourceUrl,
      exampleTurkish: entry.exampleTurkish,
      exampleTranslationSourceUrl: entry.exampleTranslationSourceUrl,
      partOfSpeech: (kaikki?.pos && posMap[kaikki.pos]) || entry.partOfSpeech,
      russian,
      sourceLicense: "Wiktionary data via Kaikki/Wiktextract",
      sourceName: kaikki ? "Kaikki/trwiktionary" : "Curated fallback",
      sourceUrl: kaikki ? kaikkiPageUrl(entry.turkish) : "local://curated-basic-v1",
      turkish: entry.turkish,
    });
  }

  const existingKeys = new Set(records.map((record) => normalizeTurkishKey(record.turkish)));
  const expansionLimit = Number(process.env.UPDATE_EXPANSION_LIMIT ?? 350);
  let expanded = 0;

  for (const entry of kaikkiExpansion) {
    const key = normalizeTurkishKey(entry.turkish);
    if (existingKeys.has(key) || expanded >= expansionLimit) {
      continue;
    }

    if (!isReliableExamplePair(entry)) {
      continue;
    }

    records.push({
      category: "Kaikki/Wiktionary",
      exampleRussian: entry.exampleRussian,
      exampleSource: "Tatoeba",
      exampleSourceLicense: "CC BY 2.0 FR",
      exampleSourceUrl: entry.exampleSourceUrl,
      exampleTurkish: entry.exampleTurkish,
      exampleTranslationSourceUrl: entry.exampleTranslationSourceUrl,
      partOfSpeech: posMap[entry.partOfSpeech] ?? entry.partOfSpeech,
      russian: entry.russian,
      sourceLicense: "Wiktionary data via Kaikki/Wiktextract",
      sourceName: "Kaikki/trwiktionary",
      sourceUrl: kaikkiPageUrl(entry.turkish),
      turkish: entry.turkish,
    });
    existingKeys.add(key);
    expanded += 1;
  }

  const version = `kaikki-trwiktionary-${new Date().toISOString().slice(0, 10)}`;
  const manifest = writeUpdatePackage(records, version, packageDirectory);
  const imported = records.filter((record) => record.sourceName === "Kaikki/trwiktionary").length;

  console.log(
    JSON.stringify(
      {
        imported,
        expanded,
        manifest,
        records: records.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
