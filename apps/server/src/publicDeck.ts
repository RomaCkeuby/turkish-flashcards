import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { correctKnownSense } from "./knownCorrections.ts";

// Structural copy of the browser contract: server rootDir must not include web source files.
export type PublicCardSource = {
  name: string;
  url: string;
  license: string;
  purpose: "entry" | "example" | "exampleTranslation";
};
export type PublicCardEntry = {
  key: string;
  turkish: string;
  russian: string;
  partOfSpeech: string;
  category: string;
  tags: string[];
  exampleTurkish: string;
  exampleRussian: string;
  sources: PublicCardSource[];
};
export type PublicDeckManifest = {
  schemaVersion: 1;
  version: string;
  recordCount: number;
  file: string;
  sha256: string;
};

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: ожидается объект.`);
  return value as Record<string, unknown>;
}

function string(record: Record<string, unknown>, field: string, required = false): string {
  const value = record[field];
  if (typeof value !== "string" || (required && !value.trim())) {
    throw new Error(`Некорректное поле ${field}.`);
  }
  return value.trim();
}

function hash(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Source identity v1: source URL/name + NFC Turkish lemma + part of speech.
 * Translation/example/category edits and package order do not change identity.
 * The source package has no persistent sense ID: changing lemma, source or part of
 * speech creates a NEW key; identical identities are rejected instead of merged.
 */
export function toPublicCard(value: unknown): PublicCardEntry {
  const record = object(value, "Карточка");
  const corrected = correctKnownSense({
    turkish: string(record, "turkish", true).normalize("NFC"),
    russian: string(record, "russian", true),
    partOfSpeech: string(record, "partOfSpeech"),
    exampleTurkish: string(record, "exampleTurkish"),
  });
  const sourceName = string(record, "sourceName", true);
  const sourceUrl = string(record, "sourceUrl", true);
  const sourceLicense = string(record, "sourceLicense", true);
  const exampleRussian = string(record, "exampleRussian");
  const exampleSource = string(record, "exampleSource");
  const exampleLicense = string(record, "exampleSourceLicense");
  const exampleUrl = string(record, "exampleSourceUrl");
  const translationUrl = string(record, "exampleTranslationSourceUrl");
  const sources: PublicCardSource[] = [{ name: sourceName, url: sourceUrl, license: sourceLicense, purpose: "entry" }];
  if (corrected.exampleTurkish || exampleRussian) {
    if (!exampleSource || !exampleLicense || !exampleUrl || (exampleRussian && !translationUrl)) {
      throw new Error("Для примера и его перевода необходимо сохранить атрибуцию источника.");
    }
    sources.push({ name: exampleSource, url: exampleUrl, license: exampleLicense, purpose: "example" });
    if (exampleRussian) sources.push({ name: exampleSource, url: translationUrl, license: exampleLicense, purpose: "exampleTranslation" });
  }
  // Explicit allowlist: never spread source objects into the public bundle.
  return {
    key: `source-v1-${hash(JSON.stringify([sourceName, sourceUrl, corrected.turkish, corrected.partOfSpeech]))}`,
    turkish: corrected.turkish,
    russian: corrected.russian,
    partOfSpeech: corrected.partOfSpeech,
    category: string(record, "category"),
    tags: [], // The curated update format currently has no public tags.
    exampleTurkish: corrected.exampleTurkish,
    exampleRussian,
    sources,
  };
}

/** Reads only the checked source package, never SQLite or its personal overrides. */
export function buildPublicDeck(packageDirectory: string) {
  const manifest = object(JSON.parse(readFileSync(resolve(packageDirectory, "manifest.json"), "utf8")), "Manifest");
  if (manifest.schemaVersion !== 1) throw new Error("Неподдерживаемая версия источникового пакета.");
  const version = string(manifest, "version", true);
  const packageFile = string(manifest, "packageFile", true);
  if (basename(packageFile) !== packageFile || !/^[a-zA-Z0-9._-]+\.gz$/.test(packageFile)) {
    throw new Error("Недопустимое имя источникового файла.");
  }
  if (!Number.isSafeInteger(manifest.recordCount) || Number(manifest.recordCount) < 1) throw new Error("Некорректное количество записей.");
  const compressed = readFileSync(resolve(packageDirectory, packageFile));
  if (hash(compressed) !== string(manifest, "sha256", true)) throw new Error("Контрольная сумма источникового пакета не совпадает.");
  const entries = gunzipSync(compressed).toString("utf8").split(/\r?\n/).filter(line => line.trim()).map(line => toPublicCard(JSON.parse(line)));
  if (entries.length !== manifest.recordCount) throw new Error("Количество записей не совпадает с manifest.json.");
  entries.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  if (new Set(entries.map(entry => entry.key)).size !== entries.length) throw new Error("В источниковом пакете повторяется идентичность карточки.");
  const body = `${JSON.stringify(entries)}\n`;
  const sha256 = hash(body);
  const publicManifest: PublicDeckManifest = {
    schemaVersion: 1,
    version,
    recordCount: entries.length,
    file: `cards.${sha256.slice(0, 16)}.json`,
    sha256,
  };
  return { entries, body, manifest: publicManifest };
}

/** Publish data first, then replace the manifest so it never points at a partial file. */
export function writePublicDeck(packageDirectory: string, outputDirectory: string) {
  const deck = buildPublicDeck(packageDirectory);
  mkdirSync(outputDirectory, { recursive: true });
  const dataPath = resolve(outputDirectory, deck.manifest.file);
  if (basename(deck.manifest.file) !== deck.manifest.file) throw new Error("Недопустимое имя публичного файла.");
  const tempSuffix = `.${process.pid}.tmp`;
  writeFileSync(dataPath + tempSuffix, deck.body, "utf8");
  renameSync(dataPath + tempSuffix, dataPath);
  const manifestPath = resolve(outputDirectory, "manifest.json");
  writeFileSync(manifestPath + tempSuffix, `${JSON.stringify(deck.manifest, null, 2)}\n`, "utf8");
  renameSync(manifestPath + tempSuffix, manifestPath);
  return deck.manifest;
}
