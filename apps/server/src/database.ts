import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { repairKnownDataQualityIssues } from "./dataQuality.ts";
import { seedEntries } from "./data/seed.ts";

export type CardDirection = "ru-tr" | "tr-ru";
export type ReviewResult = "correct" | "incorrect";
export type EntryStatus = "ACTIVE" | "ARCHIVED" | "DISABLED";
export type StudyMode = "all" | "review" | "new";
export class EntryValidationError extends Error {}

export type DictionaryEntry = {
  category: string;
  createdAt: string;
  exampleRussian: string;
  exampleSource: string;
  exampleSourceLicense: string;
  exampleSourceUrl: string;
  exampleTurkish: string;
  exampleTranslationSourceUrl: string;
  id: number;
  partOfSpeech: string;
  russian: string;
  sourceLicense: string;
  sourceName: string;
  sourceUrl: string | null;
  status: EntryStatus;
  tags: string[];
  turkish: string;
  updatedAt: string;
};

export type EntryDetail = {
  base: DictionaryEntry;
  cards: {
    direction: CardDirection;
    enabled: boolean;
    id: number;
  }[];
  effective: DictionaryEntry;
  examples: {
    id: number;
    isPrimary: boolean;
    layer: "base" | "override";
    russian: string;
    sourceLicense: string;
    sourceName: string;
    sourceUrl: string;
    turkish: string;
  }[];
  history: {
    changedAt: string;
    field: string;
    id: number;
    newValueJson: string;
    oldValueJson: string;
  }[];
  override: Partial<DictionaryEntry> | null;
  review: {
    dueAt: string | null;
    easeFactor: number | null;
    intervalDays: number | null;
    lastReviewedAt: string | null;
    repetitions: number;
  };
  translations: {
    id: number;
    isPrimary: boolean;
    layer: "base" | "override";
    sourceLicense: string;
    sourceName: string;
    sourceUrl: string;
    text: string;
  }[];
};

type CountRow = { count: number };
type IdRow = { id: number };
type OverrideRow = {
  category: string | null;
  partOfSpeech: string | null;
  russian: string | null;
  status: EntryStatus | null;
  tagsOverridden: number;
  turkish: string | null;
  updatedAt: string | null;
};
type ReviewStateRow = {
  easeFactor: number;
  firstReviewedAt: string | null;
  intervalDays: number;
  lapses: number;
  repetitions: number;
};
type EntryPatch = {
  category?: string;
  exampleRussian?: string;
  exampleTurkish?: string;
  partOfSpeech?: string;
  russian?: string;
  status?: EntryStatus;
  tags?: string[];
  turkish?: string;
};
type EntryCreate = EntryPatch & {
  russian: string;
  turkish: string;
};
export type EntryFilters = {
  category?: string;
  partOfSpeech?: string;
  status?: EntryStatus;
  tag?: string;
};

const dayInMilliseconds = 24 * 60 * 60 * 1000;
const incorrectIntervalDays = 5 / (24 * 60);
const categoryFilterExclusions = new Set(["Глаголы"]);

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultDatabasePath = resolve(moduleDirectory, "../storage/turkish-flashcards.db");

export function openDatabase(databasePath = defaultDatabasePath) {
  mkdirSync(dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA synchronous = NORMAL;");
  migrate(database);
  seed(database);
  repairKnownDataQualityIssues(database);

  return database;
}

function migrate(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY,
      source_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      license TEXT NOT NULL,
      url TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY,
      source_id INTEGER NOT NULL REFERENCES sources(id),
      source_key TEXT NOT NULL,
      turkish TEXT NOT NULL,
      russian TEXT NOT NULL,
      example_turkish TEXT NOT NULL DEFAULT '',
      example_russian TEXT NOT NULL DEFAULT '',
      example_source TEXT NOT NULL DEFAULT '',
      example_source_license TEXT NOT NULL DEFAULT '',
      example_source_url TEXT NOT NULL DEFAULT '',
      example_translation_source_url TEXT NOT NULL DEFAULT '',
      part_of_speech TEXT NOT NULL,
      category TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (source_id, source_key)
    );

    CREATE INDEX IF NOT EXISTS entries_turkish_index ON entries(turkish);
    CREATE INDEX IF NOT EXISTS entries_russian_index ON entries(russian);
    CREATE INDEX IF NOT EXISTS entries_category_index ON entries(category);

    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      direction TEXT NOT NULL CHECK (direction IN ('tr-ru', 'ru-tr')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      UNIQUE (entry_id, direction)
    );

    CREATE TABLE IF NOT EXISTS review_state (
      card_id INTEGER PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
      due_at TEXT NOT NULL,
      interval_days REAL NOT NULL DEFAULT 0,
      ease_factor REAL NOT NULL DEFAULT 2.5,
      repetitions INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      first_reviewed_at TEXT,
      last_reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS review_log (
      id INTEGER PRIMARY KEY,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      rating TEXT NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
      reviewed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_undo (
      token TEXT PRIMARY KEY,
      review_log_id INTEGER NOT NULL UNIQUE REFERENCES review_log(id) ON DELETE CASCADE,
      previous_state_json TEXT NOT NULL,
      result_state_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS update_history (
      id INTEGER PRIMARY KEY,
      package_version TEXT NOT NULL,
      manifest_sha256 TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      added_count INTEGER NOT NULL,
      changed_count INTEGER NOT NULL,
      disabled_count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS update_snapshots (
      id INTEGER PRIMARY KEY,
      package_version TEXT NOT NULL,
      manifest_sha256 TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entry_overrides (
      entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
      turkish TEXT,
      russian TEXT,
      part_of_speech TEXT,
      category TEXT,
      status TEXT CHECK (status IN ('ACTIVE', 'DISABLED', 'ARCHIVED')),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entry_translation_items (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      layer TEXT NOT NULL CHECK (layer IN ('base', 'override')),
      text TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
      position INTEGER NOT NULL DEFAULT 0,
      source_name TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      source_license TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (entry_id, layer, position)
    );

    CREATE TABLE IF NOT EXISTS entry_example_items (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      layer TEXT NOT NULL CHECK (layer IN ('base', 'override')),
      turkish TEXT NOT NULL,
      russian TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
      position INTEGER NOT NULL DEFAULT 0,
      source_name TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      source_license TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (entry_id, layer, position)
    );

    CREATE TABLE IF NOT EXISTS entry_tags (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      layer TEXT NOT NULL CHECK (layer IN ('base', 'override')),
      tag TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (entry_id, layer, tag)
    );

    CREATE TABLE IF NOT EXISTS entry_change_log (
      id INTEGER PRIMARY KEY,
      entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      field TEXT NOT NULL,
      old_value_json TEXT NOT NULL,
      new_value_json TEXT NOT NULL,
      change_source TEXT NOT NULL CHECK (change_source IN ('user', 'update', 'rollback')),
      changed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS entry_change_log_entry_index ON entry_change_log(entry_id, changed_at);
  `);

  const columns = database.prepare("PRAGMA table_info(review_state)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "first_reviewed_at")) {
    database.exec("ALTER TABLE review_state ADD COLUMN first_reviewed_at TEXT;");
  }

  const entryColumns = database.prepare("PRAGMA table_info(entries)").all() as { name: string }[];
  if (!entryColumns.some((column) => column.name === "example_turkish")) {
    database.exec("ALTER TABLE entries ADD COLUMN example_turkish TEXT NOT NULL DEFAULT '';");
  }
  if (!entryColumns.some((column) => column.name === "example_russian")) {
    database.exec("ALTER TABLE entries ADD COLUMN example_russian TEXT NOT NULL DEFAULT '';");
  }
  if (!entryColumns.some((column) => column.name === "example_source")) {
    database.exec("ALTER TABLE entries ADD COLUMN example_source TEXT NOT NULL DEFAULT '';");
  }
  if (!entryColumns.some((column) => column.name === "example_source_license")) {
    database.exec("ALTER TABLE entries ADD COLUMN example_source_license TEXT NOT NULL DEFAULT '';");
  }
  if (!entryColumns.some((column) => column.name === "example_source_url")) {
    database.exec("ALTER TABLE entries ADD COLUMN example_source_url TEXT NOT NULL DEFAULT '';");
  }
  if (!entryColumns.some((column) => column.name === "example_translation_source_url")) {
    database.exec("ALTER TABLE entries ADD COLUMN example_translation_source_url TEXT NOT NULL DEFAULT '';");
  }

  const overrideColumns = database.prepare("PRAGMA table_info(entry_overrides)").all() as { name: string }[];
  if (!overrideColumns.some((column) => column.name === "tags_overridden")) {
    database.exec(`
      ALTER TABLE entry_overrides ADD COLUMN tags_overridden INTEGER NOT NULL DEFAULT 0
        CHECK (tags_overridden IN (0, 1));
      UPDATE entry_overrides SET tags_overridden = 1
      WHERE EXISTS (
        SELECT 1 FROM entry_tags
        WHERE entry_tags.entry_id = entry_overrides.entry_id AND layer = 'override'
      ) OR EXISTS (
        SELECT 1 FROM entry_change_log
        WHERE entry_change_log.entry_id = entry_overrides.entry_id AND field = 'tags'
      );
    `);
  }
  database.exec(`
    CREATE VIEW IF NOT EXISTS effective_entry_tags AS
    SELECT entry_tags.*
    FROM entry_tags
    LEFT JOIN entry_overrides ON entry_overrides.entry_id = entry_tags.entry_id
    WHERE entry_tags.layer = CASE
      WHEN COALESCE(entry_overrides.tags_overridden, 0) = 1 THEN 'override'
      ELSE 'base'
    END;
  `);
}

function seed(database: DatabaseSync) {
  if (seedEntries.length !== 250) {
    throw new Error(`Начальная коллекция должна содержать 250 записей, получено ${seedEntries.length}.`);
  }

  const now = new Date().toISOString();
  const upsertSource = database.prepare(`
    INSERT INTO sources (source_key, name, version, license, url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO NOTHING
  `);
  const upsertEntry = database.prepare(`
    INSERT INTO entries (
      source_id, source_key, turkish, russian, example_turkish, example_russian,
      example_source, example_source_license, example_source_url, example_translation_source_url,
      part_of_speech, category,
      active, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(source_id, source_key) DO NOTHING
    RETURNING id
  `);
  const insertCard = database.prepare(`
    INSERT OR IGNORE INTO cards (entry_id, direction) VALUES (?, ?)
  `);
  const upsertBaseTranslation = database.prepare(`
    INSERT INTO entry_translation_items (
      entry_id, layer, text, is_primary, position, source_name, source_url, source_license,
      created_at, updated_at
    )
    VALUES (?, 'base', ?, 1, 0, ?, ?, ?, ?, ?)
    ON CONFLICT(entry_id, layer, position) DO UPDATE SET
      text = excluded.text,
      source_name = excluded.source_name,
      source_url = excluded.source_url,
      source_license = excluded.source_license,
      updated_at = excluded.updated_at
  `);
  const upsertBaseExample = database.prepare(`
    INSERT INTO entry_example_items (
      entry_id, layer, turkish, russian, is_primary, position, source_name, source_url, source_license,
      created_at, updated_at
    )
    VALUES (?, 'base', ?, ?, 1, 0, ?, ?, ?, ?, ?)
    ON CONFLICT(entry_id, layer, position) DO UPDATE SET
      turkish = excluded.turkish,
      russian = excluded.russian,
      source_name = excluded.source_name,
      source_url = excluded.source_url,
      source_license = excluded.source_license,
      updated_at = excluded.updated_at
  `);
  const insertBaseTag = database.prepare(`
    INSERT OR IGNORE INTO entry_tags (entry_id, layer, tag, created_at) VALUES (?, 'base', ?, ?)
  `);

  database.exec("BEGIN IMMEDIATE;");
  try {
    upsertSource.run(
      "curated-basic-v1",
      "Базовая коллекция Turkish Flashcards",
      "1.0.0",
      "Персональная учебная подборка",
      null,
      now,
    );
    const source = database.prepare("SELECT id FROM sources WHERE source_key = ?")
      .get("curated-basic-v1") as IdRow;

    for (const [index, entry] of seedEntries.entries()) {
      const savedEntry = upsertEntry.get(
        source.id,
        entry.turkish.toLocaleLowerCase("tr-TR"),
        entry.turkish,
        entry.russian,
        entry.exampleTurkish,
        entry.exampleRussian,
        entry.exampleSource,
        entry.exampleSourceLicense,
        entry.exampleSourceUrl,
        entry.exampleTranslationSourceUrl,
        entry.partOfSpeech,
        entry.category,
        now,
        now,
      ) as IdRow | undefined;

      // Seed data initializes missing entries; opening a database must not undo updates.
      if (!savedEntry) {
        continue;
      }

      insertCard.run(savedEntry.id, "tr-ru");
      insertCard.run(savedEntry.id, "ru-tr");
      insertBaseTag.run(savedEntry.id, index < 150 ? "A1" : "A2", now);
      upsertBaseTranslation.run(
        savedEntry.id,
        entry.russian,
        "Curated basic collection",
        "",
        "Personal learning collection",
        now,
        now,
      );
      if (entry.exampleTurkish && entry.exampleRussian) {
        upsertBaseExample.run(
          savedEntry.id,
          entry.exampleTurkish,
          entry.exampleRussian,
          entry.exampleSource,
          entry.exampleSourceUrl,
          entry.exampleSourceLicense,
          now,
          now,
        );
      }
    }

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export function getStats(database: DatabaseSync) {
  const entries = database.prepare(
    `
      SELECT COUNT(*) AS count
      FROM entries
      LEFT JOIN entry_overrides ON entry_overrides.entry_id = entries.id
      WHERE entries.active = 1
        AND COALESCE(entry_overrides.status, 'ACTIVE') = 'ACTIVE'
    `,
  ).get() as CountRow;
  const cards = database.prepare(
    "SELECT COUNT(*) AS count FROM cards WHERE enabled = 1",
  ).get() as CountRow;
  const reviewed = database.prepare("SELECT COUNT(*) AS count FROM review_state").get() as CountRow;

  const queue = getQueueStats(database);

  return {
    cards: cards.count,
    entries: entries.count,
    queue,
    reviewed: reviewed.count,
    directions: {
      "tr-ru": getQueueStats(database, new Date(), {}, "tr-ru"),
      "ru-tr": getQueueStats(database, new Date(), {}, "ru-tr"),
    },
  };
}

function getLocalDayRange(currentTime: Date) {
  const start = new Date(currentTime);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    endIso: end.toISOString(),
    startIso: start.toISOString(),
  };
}

function buildStudyFilterClause(filters: EntryFilters) {
  const clauses: string[] = [];
  const parameters: SQLInputValue[] = [];

  if (filters.category) {
    clauses.push("COALESCE(entry_overrides.category, entries.category) = ?");
    parameters.push(filters.category);
  }

  if (filters.partOfSpeech) {
    clauses.push("COALESCE(entry_overrides.part_of_speech, entries.part_of_speech) = ?");
    parameters.push(filters.partOfSpeech);
  }

  if (filters.tag) {
    clauses.push(`
      EXISTS (
        SELECT 1
        FROM effective_entry_tags AS entry_tags
        WHERE entry_tags.entry_id = entries.id
          AND entry_tags.tag = ?
      )
    `);
    parameters.push(filters.tag);
  }

  return {
    clause: clauses.length ? `AND ${clauses.join(" AND ")}` : "",
    parameters,
  };
}

export function getQueueStats(
  database: DatabaseSync,
  currentTime = new Date(),
  filters: EntryFilters = {},
  direction?: CardDirection,
) {
  const nowIso = currentTime.toISOString();
  const { endIso, startIso } = getLocalDayRange(currentTime);
  const { clause, parameters } = buildStudyFilterClause(filters);
  const directionClause = direction ? "AND cards.direction = ?" : "";
  const directionParameters = direction ? [direction] : [];
  const due = database.prepare(`
    SELECT COUNT(*) AS count
    FROM cards
    JOIN entries ON entries.id = cards.entry_id
    JOIN review_state ON review_state.card_id = cards.id
    LEFT JOIN entry_overrides ON entry_overrides.entry_id = entries.id
    WHERE cards.enabled = 1
      AND entries.active = 1
      AND COALESCE(entry_overrides.status, 'ACTIVE') = 'ACTIVE'
      AND review_state.due_at <= ?
      ${directionClause}
      ${clause}
  `).get(nowIso, ...directionParameters, ...parameters) as CountRow;
  const newTotal = database.prepare(`
    SELECT COUNT(*) AS count
    FROM cards
    JOIN entries ON entries.id = cards.entry_id
    LEFT JOIN review_state ON review_state.card_id = cards.id
    LEFT JOIN entry_overrides ON entry_overrides.entry_id = entries.id
    WHERE cards.enabled = 1
      AND entries.active = 1
      AND COALESCE(entry_overrides.status, 'ACTIVE') = 'ACTIVE'
      AND review_state.card_id IS NULL
      ${directionClause}
      ${clause}
  `).get(...directionParameters, ...parameters) as CountRow;
  const newUsedToday = database.prepare(`
    SELECT COUNT(*) AS count
    FROM review_state
    WHERE first_reviewed_at >= ?
      AND first_reviewed_at < ?
  `).get(startIso, endIso) as CountRow;
  const reviewedToday = database.prepare(`
    SELECT COUNT(*) AS count
    FROM review_log
    WHERE reviewed_at >= ?
      AND reviewed_at < ?
  `).get(startIso, endIso) as CountRow;
  const correctToday = database.prepare(`
    SELECT COUNT(*) AS count
    FROM review_log
    WHERE rating = 'good'
      AND reviewed_at >= ?
      AND reviewed_at < ?
  `).get(startIso, endIso) as CountRow;
  return {
    accuracyToday:
      reviewedToday.count === 0 ? null : Math.round((correctToday.count / reviewedToday.count) * 100),
    correctToday: correctToday.count,
    due: due.count,
    isDoneToday: due.count === 0 && newTotal.count === 0,
    newAvailable: newTotal.count,
    newTotal: newTotal.count,
    newUsedToday: newUsedToday.count,
    reviewedToday: reviewedToday.count,
  };
}

const dictionaryEntrySelect = `
  SELECT
    entries.id,
    COALESCE(entry_overrides.turkish, entries.turkish) AS turkish,
    COALESCE(entry_overrides.russian, entries.russian) AS russian,
    COALESCE(override_example.turkish, entries.example_turkish) AS exampleTurkish,
    COALESCE(override_example.russian, entries.example_russian) AS exampleRussian,
    COALESCE(override_example.source_name, entries.example_source) AS exampleSource,
    COALESCE(override_example.source_license, entries.example_source_license) AS exampleSourceLicense,
    COALESCE(override_example.source_url, entries.example_source_url) AS exampleSourceUrl,
    CASE WHEN override_example.id IS NULL THEN entries.example_translation_source_url ELSE '' END AS exampleTranslationSourceUrl,
    COALESCE(entry_overrides.part_of_speech, entries.part_of_speech) AS partOfSpeech,
    COALESCE(entry_overrides.category, entries.category) AS category,
    sources.name AS sourceName,
    sources.license AS sourceLicense,
    sources.url AS sourceUrl,
    CASE
      WHEN entry_overrides.status IS NOT NULL THEN entry_overrides.status
      WHEN entries.active = 1 THEN 'ACTIVE'
      ELSE 'DISABLED'
    END AS status,
    entries.created_at AS createdAt,
    COALESCE(entry_overrides.updated_at, entries.updated_at) AS updatedAt
  FROM entries
  JOIN sources ON sources.id = entries.source_id
  LEFT JOIN entry_overrides ON entry_overrides.entry_id = entries.id
  LEFT JOIN entry_example_items AS override_example
    ON override_example.entry_id = entries.id
    AND override_example.layer = 'override'
    AND override_example.is_primary = 1
  WHERE entries.active = 1
`;

function buildEntryFilterClause(search: string, filters: EntryFilters) {
  const clauses: string[] = [];
  const parameters: SQLInputValue[] = [];
  void search;

  if (filters.status) {
    clauses.push("status = ?");
    parameters.push(filters.status);
  }

  if (filters.category) {
    clauses.push("category = ?");
    parameters.push(filters.category);
  }

  if (filters.partOfSpeech) {
    clauses.push("partOfSpeech = ?");
    parameters.push(filters.partOfSpeech);
  }

  if (filters.tag) {
    clauses.push(`
      EXISTS (
        SELECT 1
        FROM effective_entry_tags AS entry_tags
        WHERE entry_tags.entry_id = effective_entries.id
          AND entry_tags.tag = ?
      )
    `);
    parameters.push(filters.tag);
  }

  return {
    clause: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    parameters,
  };
}

export function getEntries(
  database: DatabaseSync,
  search: string,
  limit: number,
  offset: number,
  filters: EntryFilters = {},
) {
  const { clause, parameters } = buildEntryFilterClause(search, filters);
  const allEntries = database.prepare(`
    SELECT *
    FROM (${dictionaryEntrySelect}) AS effective_entries
    ${clause}
    ORDER BY turkish COLLATE NOCASE
  `).all(...parameters) as unknown as DictionaryEntry[];
  const normalizedSearch = search.trim().toLocaleLowerCase("tr-TR");
  const filteredEntries = normalizedSearch
    ? allEntries.filter((entry) => {
        const turkish = entry.turkish.toLocaleLowerCase("tr-TR");
        const russian = entry.russian.toLocaleLowerCase("tr-TR");
        return turkish.includes(normalizedSearch) || russian.includes(normalizedSearch);
      })
    : allEntries;
  const entries = filteredEntries.slice(offset, offset + limit);

  attachTags(database, entries);

  return {
    entries,
    total: filteredEntries.length,
  };
}

export function getEntryFilterOptions(database: DatabaseSync) {
  const categories = database.prepare(`
    SELECT DISTINCT category
    FROM (${dictionaryEntrySelect}) AS effective_entries
    WHERE category <> ''
    ORDER BY category COLLATE NOCASE
  `).all() as { category: string }[];
  const partsOfSpeech = database.prepare(`
    SELECT DISTINCT partOfSpeech
    FROM (${dictionaryEntrySelect}) AS effective_entries
    WHERE partOfSpeech <> ''
    ORDER BY partOfSpeech COLLATE NOCASE
  `).all() as { partOfSpeech: string }[];
  const tags = database.prepare(`
    SELECT DISTINCT tag
    FROM effective_entry_tags AS entry_tags
    JOIN entries ON entries.id = entry_tags.entry_id
    WHERE entries.active = 1
    ORDER BY tag COLLATE NOCASE
  `).all() as { tag: string }[];

  return {
    categories: categories
      .map((row) => row.category)
      .filter((category) => !categoryFilterExclusions.has(category)),
    partsOfSpeech: partsOfSpeech.map((row) => row.partOfSpeech),
    tags: tags.map((row) => row.tag),
  };
}

function attachTags(database: DatabaseSync, entries: DictionaryEntry[]) {
  if (entries.length === 0) {
    return;
  }

  const ids = entries.map((entry) => entry.id);
  const placeholders = ids.map(() => "?").join(", ");
  const rows = database.prepare(`
    SELECT entry_id AS entryId, tag
    FROM effective_entry_tags
    WHERE entry_id IN (${placeholders})
    ORDER BY tag COLLATE NOCASE
  `).all(...ids) as { entryId: number; tag: string }[];
  const tagsByEntry = new Map<number, string[]>();

  for (const row of rows) {
    tagsByEntry.set(row.entryId, [...(tagsByEntry.get(row.entryId) ?? []), row.tag]);
  }

  for (const entry of entries) {
    entry.tags = tagsByEntry.get(entry.id) ?? [];
  }
}

export function getNextCard(
  database: DatabaseSync,
  direction: CardDirection,
  currentTime = new Date(),
  filters: EntryFilters = {},
  mode: StudyMode = "all",
  preferredCardId?: number,
) {
  if (preferredCardId !== undefined) {
    const preferred = getStudyCard(database, preferredCardId, direction, currentTime, filters, mode);
    if (preferred) return preferred;
  }
  const { clause, parameters } = buildStudyFilterClause(filters);
  const dueCard = database.prepare(`
    SELECT
      cards.id,
      entries.id AS entryId,
      cards.direction,
      COALESCE(entry_overrides.turkish, entries.turkish) AS turkish,
      COALESCE(entry_overrides.russian, entries.russian) AS russian,
      COALESCE(override_example.turkish, entries.example_turkish) AS exampleTurkish,
      COALESCE(override_example.russian, entries.example_russian) AS exampleRussian,
      COALESCE(override_example.source_name, entries.example_source) AS exampleSource,
      COALESCE(override_example.source_license, entries.example_source_license) AS exampleSourceLicense,
      COALESCE(override_example.source_url, entries.example_source_url) AS exampleSourceUrl,
      CASE WHEN override_example.id IS NULL THEN entries.example_translation_source_url ELSE '' END AS exampleTranslationSourceUrl,
      COALESCE(entry_overrides.category, entries.category) AS category,
      COALESCE(entry_overrides.part_of_speech, entries.part_of_speech) AS partOfSpeech
    FROM cards
    JOIN entries ON entries.id = cards.entry_id
    JOIN review_state ON review_state.card_id = cards.id
    LEFT JOIN entry_overrides ON entry_overrides.entry_id = entries.id
    LEFT JOIN entry_example_items AS override_example
      ON override_example.entry_id = entries.id
      AND override_example.layer = 'override'
      AND override_example.is_primary = 1
    WHERE cards.enabled = 1
      AND entries.active = 1
      AND COALESCE(entry_overrides.status, 'ACTIVE') = 'ACTIVE'
      AND cards.direction = ?
      AND review_state.due_at <= ?
      ${clause}
    ORDER BY
      review_state.due_at,
      RANDOM()
    LIMIT 1
  `).get(direction, currentTime.toISOString(), ...parameters);

  if (dueCard && mode !== "new") {
    return dueCard;
  }

  if (mode === "review") return undefined;

  return database.prepare(`
    SELECT
      cards.id,
      entries.id AS entryId,
      cards.direction,
      COALESCE(entry_overrides.turkish, entries.turkish) AS turkish,
      COALESCE(entry_overrides.russian, entries.russian) AS russian,
      COALESCE(override_example.turkish, entries.example_turkish) AS exampleTurkish,
      COALESCE(override_example.russian, entries.example_russian) AS exampleRussian,
      COALESCE(override_example.source_name, entries.example_source) AS exampleSource,
      COALESCE(override_example.source_license, entries.example_source_license) AS exampleSourceLicense,
      COALESCE(override_example.source_url, entries.example_source_url) AS exampleSourceUrl,
      CASE WHEN override_example.id IS NULL THEN entries.example_translation_source_url ELSE '' END AS exampleTranslationSourceUrl,
      COALESCE(entry_overrides.category, entries.category) AS category,
      COALESCE(entry_overrides.part_of_speech, entries.part_of_speech) AS partOfSpeech
    FROM cards
    JOIN entries ON entries.id = cards.entry_id
    LEFT JOIN review_state ON review_state.card_id = cards.id
    LEFT JOIN entry_overrides ON entry_overrides.entry_id = entries.id
    LEFT JOIN entry_example_items AS override_example
      ON override_example.entry_id = entries.id
      AND override_example.layer = 'override'
      AND override_example.is_primary = 1
    WHERE cards.enabled = 1
      AND entries.active = 1
      AND COALESCE(entry_overrides.status, 'ACTIVE') = 'ACTIVE'
      AND cards.direction = ?
      AND review_state.card_id IS NULL
      ${clause}
    ORDER BY RANDOM()
    LIMIT 1
  `).get(direction, ...parameters);
}

export function getStudyCard(
  database: DatabaseSync, cardId: number, direction: CardDirection,
  now = new Date(), filters: EntryFilters = {}, mode: StudyMode = "all",
) {
  const { clause, parameters } = buildStudyFilterClause(filters);
  const card = database.prepare(`
    SELECT cards.id, cards.entry_id AS entryId, cards.direction
    FROM cards JOIN entries ON entries.id = cards.entry_id
    LEFT JOIN entry_overrides ON entry_overrides.entry_id = entries.id
    LEFT JOIN review_state ON review_state.card_id = cards.id
    WHERE cards.id = ? AND cards.direction = ? AND cards.enabled = 1 AND entries.active = 1
      AND COALESCE(entry_overrides.status, 'ACTIVE') = 'ACTIVE'
      AND (review_state.card_id IS NULL OR review_state.due_at <= ?)
      ${mode === "new" ? "AND review_state.card_id IS NULL" : ""}
      ${mode === "review" ? "AND review_state.card_id IS NOT NULL" : ""}
      ${clause}
  `).get(cardId, direction, now.toISOString(), ...parameters) as
    { id: number; entryId: number; direction: CardDirection } | undefined;
  if (!card) return undefined;
  const detail = getEntryDetail(database, card.entryId);
  return detail ? { ...detail.effective, ...card } : undefined;
}

export function recordReview(
  database: DatabaseSync,
  cardId: number,
  result: ReviewResult,
  reviewedAt = new Date(),
) {
  const card = database.prepare("SELECT id FROM cards WHERE id = ? AND enabled = 1").get(
    cardId,
  ) as IdRow | undefined;

  if (!card) {
    return null;
  }

  const previous = database.prepare(`
    SELECT
      interval_days AS intervalDays,
      ease_factor AS easeFactor,
      first_reviewed_at AS firstReviewedAt,
      repetitions,
      lapses
    FROM review_state
    WHERE card_id = ?
  `).get(cardId) as ReviewStateRow | undefined;
  const current = previous ?? {
    easeFactor: 2.5,
    firstReviewedAt: null,
    intervalDays: 0,
    lapses: 0,
    repetitions: 0,
  };

  let easeFactor: number;
  let intervalDays: number;
  let lapses: number;
  let repetitions: number;

  if (result === "correct") {
    repetitions = current.repetitions + 1;
    intervalDays =
      current.repetitions === 0
        ? 1
        : current.repetitions === 1
          ? 3
          : Math.max(1, Math.round(current.intervalDays * current.easeFactor));
    easeFactor = Math.min(3, current.easeFactor + 0.05);
    lapses = current.lapses;
  } else {
    repetitions = 0;
    intervalDays = incorrectIntervalDays;
    easeFactor = Math.max(1.3, current.easeFactor - 0.2);
    lapses = current.lapses + 1;
  }

  const dueAt = new Date(reviewedAt.getTime() + intervalDays * dayInMilliseconds).toISOString();
  const reviewedAtIso = reviewedAt.toISOString();
  const upsertState = database.prepare(`
    INSERT INTO review_state (
      card_id, due_at, interval_days, ease_factor, repetitions, lapses, first_reviewed_at, last_reviewed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(card_id) DO UPDATE SET
      due_at = excluded.due_at,
      interval_days = excluded.interval_days,
      ease_factor = excluded.ease_factor,
      repetitions = excluded.repetitions,
      lapses = excluded.lapses,
      last_reviewed_at = excluded.last_reviewed_at
  `);
  const insertLog = database.prepare(`
    INSERT INTO review_log (card_id, rating, reviewed_at) VALUES (?, ?, ?)
  `);

  database.exec("BEGIN IMMEDIATE;");
  const undoToken = randomUUID();
  try {
    const previousState = database.prepare("SELECT * FROM review_state WHERE card_id = ?").get(cardId) ?? null;
    upsertState.run(
      cardId,
      dueAt,
      intervalDays,
      easeFactor,
      repetitions,
      lapses,
      current.firstReviewedAt ?? reviewedAtIso,
      reviewedAtIso,
    );
    const log = insertLog.run(cardId, result === "correct" ? "good" : "again", reviewedAtIso);
    const resultState = database.prepare("SELECT * FROM review_state WHERE card_id = ?").get(cardId);
    // Only the latest answer can be undone, including across tabs. Keep one snapshot.
    database.exec("DELETE FROM review_undo;");
    database.prepare(`INSERT INTO review_undo (token, review_log_id, previous_state_json, result_state_json)
      VALUES (?, ?, ?, ?)`).run(undoToken, log.lastInsertRowid, JSON.stringify(previousState), JSON.stringify(resultState));
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }

  return {
    cardId,
    dueAt,
    easeFactor,
    intervalDays,
    lapses,
    repetitions,
    result,
    undoToken,
  };
}

export function undoReview(database: DatabaseSync, token: string) {
  database.exec("BEGIN IMMEDIATE;");
  try {
    const undo = database.prepare(`
      SELECT review_undo.*, review_log.card_id AS cardId
      FROM review_undo JOIN review_log ON review_log.id = review_undo.review_log_id
      WHERE token = ?
    `).get(token) as {
      review_log_id: number; cardId: number; previous_state_json: string; result_state_json: string;
    } | undefined;
    if (!undo) { database.exec("ROLLBACK;"); return null; }
    const latest = database.prepare("SELECT MAX(id) AS id FROM review_log WHERE card_id = ?").get(undo.cardId) as IdRow;
    const current = database.prepare("SELECT * FROM review_state WHERE card_id = ?").get(undo.cardId);
    const expected = JSON.parse(undo.result_state_json) as Record<string, unknown>;
    if (latest.id !== undo.review_log_id || !current ||
      Object.keys(expected).some(key => current[key] !== expected[key])) {
      database.exec("ROLLBACK;"); return null;
    }
    const previous = JSON.parse(undo.previous_state_json) as Record<string, SQLInputValue> | null;
    if (previous) {
      database.prepare(`UPDATE review_state SET due_at = ?, interval_days = ?, ease_factor = ?,
        repetitions = ?, lapses = ?, first_reviewed_at = ?, last_reviewed_at = ? WHERE card_id = ?`)
        .run(previous.due_at!, previous.interval_days!, previous.ease_factor!, previous.repetitions!,
          previous.lapses!, previous.first_reviewed_at!, previous.last_reviewed_at!, undo.cardId);
    } else {
      database.prepare("DELETE FROM review_state WHERE card_id = ?").run(undo.cardId);
    }
    database.prepare("DELETE FROM review_log WHERE id = ?").run(undo.review_log_id);
    database.exec("COMMIT;");
    return { cardId: undo.cardId, restored: true };
  } catch (error) { database.exec("ROLLBACK;"); throw error; }
}

function getBaseEntry(database: DatabaseSync, entryId: number) {
  const entry = database.prepare(`
    SELECT
      entries.id,
      entries.turkish,
      entries.russian,
      entries.example_turkish AS exampleTurkish,
      entries.example_russian AS exampleRussian,
      entries.example_source AS exampleSource,
      entries.example_source_license AS exampleSourceLicense,
      entries.example_source_url AS exampleSourceUrl,
      entries.example_translation_source_url AS exampleTranslationSourceUrl,
      entries.part_of_speech AS partOfSpeech,
      entries.category,
      sources.name AS sourceName,
      sources.license AS sourceLicense,
      sources.url AS sourceUrl,
      CASE WHEN entries.active = 1 THEN 'ACTIVE' ELSE 'DISABLED' END AS status,
      entries.created_at AS createdAt,
      entries.updated_at AS updatedAt
    FROM entries
    JOIN sources ON sources.id = entries.source_id
    WHERE entries.id = ?
  `).get(entryId) as DictionaryEntry | undefined;

  if (entry) {
    entry.tags = getTags(database, entryId, true);
  }

  return entry;
}

function getOverride(database: DatabaseSync, entryId: number) {
  return database.prepare(`
    SELECT
      turkish,
      russian,
      part_of_speech AS partOfSpeech,
      category,
      status,
      tags_overridden AS tagsOverridden,
      updated_at AS updatedAt
    FROM entry_overrides
    WHERE entry_id = ?
  `).get(entryId) as OverrideRow | undefined;
}

function getTags(database: DatabaseSync, entryId: number, baseOnly = false) {
  return (database.prepare(`
    SELECT tag
    FROM ${baseOnly ? "entry_tags" : "effective_entry_tags"}
    WHERE entry_id = ?
      ${baseOnly ? "AND layer = 'base'" : ""}
    ORDER BY tag COLLATE NOCASE
  `).all(entryId) as { tag: string }[]).map((row) => row.tag);
}

function getPrimaryOverrideExample(database: DatabaseSync, entryId: number) {
  return database.prepare(`
    SELECT turkish, russian, source_name AS sourceName, source_url AS sourceUrl,
      source_license AS sourceLicense
    FROM entry_example_items
    WHERE entry_id = ?
      AND layer = 'override'
      AND is_primary = 1
    ORDER BY position
    LIMIT 1
  `).get(entryId) as {
    russian: string; turkish: string; sourceName: string; sourceUrl: string; sourceLicense: string;
  } | undefined;
}

function makeEffectiveEntry(
  database: DatabaseSync,
  base: DictionaryEntry,
  override: OverrideRow | undefined,
) {
  const overrideExample = getPrimaryOverrideExample(database, base.id);

  return {
    ...base,
    category: override?.category ?? base.category,
    exampleRussian: overrideExample?.russian ?? base.exampleRussian,
    exampleTurkish: overrideExample?.turkish ?? base.exampleTurkish,
    exampleSource: overrideExample?.sourceName ?? base.exampleSource,
    exampleSourceUrl: overrideExample?.sourceUrl ?? base.exampleSourceUrl,
    exampleSourceLicense: overrideExample?.sourceLicense ?? base.exampleSourceLicense,
    exampleTranslationSourceUrl: overrideExample ? "" : base.exampleTranslationSourceUrl,
    partOfSpeech: override?.partOfSpeech ?? base.partOfSpeech,
    russian: override?.russian ?? base.russian,
    status: override?.status ?? base.status,
    tags: getTags(database, base.id),
    turkish: override?.turkish ?? base.turkish,
    updatedAt: override?.updatedAt ?? base.updatedAt,
  } satisfies DictionaryEntry;
}

export function getEntryDetail(database: DatabaseSync, entryId: number): EntryDetail | null {
  const base = getBaseEntry(database, entryId);

  if (!base) {
    return null;
  }

  const override = getOverride(database, entryId);
  const effective = makeEffectiveEntry(database, base, override);
  const translations = database.prepare(`
    SELECT
      id,
      layer,
      text,
      is_primary AS isPrimary,
      source_name AS sourceName,
      source_url AS sourceUrl,
      source_license AS sourceLicense
    FROM entry_translation_items
    WHERE entry_id = ?
    ORDER BY layer, position
  `).all(entryId) as unknown as EntryDetail["translations"];
  const examples = database.prepare(`
    SELECT
      id,
      layer,
      turkish,
      russian,
      is_primary AS isPrimary,
      source_name AS sourceName,
      source_url AS sourceUrl,
      source_license AS sourceLicense
    FROM entry_example_items
    WHERE entry_id = ?
    ORDER BY layer, position
  `).all(entryId) as unknown as EntryDetail["examples"];
  const cards = database.prepare(`
    SELECT id, direction, enabled
    FROM cards
    WHERE entry_id = ?
    ORDER BY direction
  `).all(entryId) as unknown as EntryDetail["cards"];
  const review = database.prepare(`
    SELECT
      MIN(due_at) AS dueAt,
      AVG(ease_factor) AS easeFactor,
      MAX(interval_days) AS intervalDays,
      MAX(last_reviewed_at) AS lastReviewedAt,
      COALESCE(SUM(repetitions), 0) AS repetitions
    FROM cards
    LEFT JOIN review_state ON review_state.card_id = cards.id
    WHERE cards.entry_id = ?
  `).get(entryId) as EntryDetail["review"];
  const history = database.prepare(`
    SELECT
      id,
      field,
      old_value_json AS oldValueJson,
      new_value_json AS newValueJson,
      changed_at AS changedAt
    FROM entry_change_log
    WHERE entry_id = ?
    ORDER BY changed_at DESC, id DESC
    LIMIT 50
  `).all(entryId) as EntryDetail["history"];

  return {
    base,
    cards: cards.map((card) => ({ ...card, enabled: Boolean(card.enabled) })),
    effective,
    examples: examples.map((example) => ({ ...example, isPrimary: Boolean(example.isPrimary) })),
    history,
    override: override
      ? {
          category: override.category ?? undefined,
          partOfSpeech: override.partOfSpeech ?? undefined,
          russian: override.russian ?? undefined,
          status: override.status ?? undefined,
          tags: override.tagsOverridden ? effective.tags : undefined,
          turkish: override.turkish ?? undefined,
          updatedAt: override.updatedAt ?? undefined,
        }
      : null,
    review,
    translations: translations.map((translation) => ({
      ...translation,
      isPrimary: Boolean(translation.isPrimary),
    })),
  };
}

function parseTags(value: string[] | undefined) {
  return [...new Set((value ?? []).map((tag) => tag.trim()).filter(Boolean))];
}

function validateEntryInput(input: EntryPatch, create = false) {
  for (const field of ["turkish", "russian", "category", "partOfSpeech", "exampleTurkish", "exampleRussian"] as const) {
    if (input[field] !== undefined && typeof input[field] !== "string") {
      throw new EntryValidationError("Поля карточки должны содержать текст.");
    }
  }
  if ((create || input.turkish !== undefined) && !input.turkish?.trim())
    throw new EntryValidationError("Укажите турецкое слово.");
  if ((create || input.russian !== undefined) && !input.russian?.trim())
    throw new EntryValidationError("Укажите русский перевод.");
  if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.some(tag => typeof tag !== "string")))
    throw new EntryValidationError("Теги должны быть списком строк.");
  if (input.status !== undefined && !["ACTIVE", "DISABLED", "ARCHIVED"].includes(input.status))
    throw new EntryValidationError("Неизвестный статус карточки.");
}

export function patchEntry(database: DatabaseSync, entryId: number, patch: EntryPatch) {
  validateEntryInput(patch);
  const before = getEntryDetail(database, entryId);
  if (!before) {
    return null;
  }

  const now = new Date().toISOString();
  const currentOverride = getOverride(database, entryId);
  const next = {
    category: patch.category ?? currentOverride?.category ?? null,
    partOfSpeech: patch.partOfSpeech ?? currentOverride?.partOfSpeech ?? null,
    russian: patch.russian ?? currentOverride?.russian ?? null,
    status: patch.status ?? currentOverride?.status ?? null,
    tagsOverridden: patch.tags !== undefined ? 1 : currentOverride?.tagsOverridden ?? 0,
    turkish: patch.turkish ?? currentOverride?.turkish ?? null,
  };
  const upsertOverride = database.prepare(`
    INSERT INTO entry_overrides (
      entry_id, turkish, russian, part_of_speech, category, status, tags_overridden, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entry_id) DO UPDATE SET
      turkish = excluded.turkish,
      russian = excluded.russian,
      part_of_speech = excluded.part_of_speech,
      category = excluded.category,
      status = excluded.status,
      tags_overridden = excluded.tags_overridden,
      updated_at = excluded.updated_at
  `);
  const upsertTranslation = database.prepare(`
    INSERT INTO entry_translation_items (
      entry_id, layer, text, is_primary, position, source_name, source_url, source_license,
      created_at, updated_at
    )
    VALUES (?, 'override', ?, 1, 0, 'Пользователь', '', '', ?, ?)
    ON CONFLICT(entry_id, layer, position) DO UPDATE SET
      text = excluded.text,
      updated_at = excluded.updated_at
  `);
  const deleteTranslation = database.prepare(`
    DELETE FROM entry_translation_items WHERE entry_id = ? AND layer = 'override'
  `);
  const upsertExample = database.prepare(`
    INSERT INTO entry_example_items (
      entry_id, layer, turkish, russian, is_primary, position, source_name, source_url, source_license,
      created_at, updated_at
    )
    VALUES (?, 'override', ?, ?, 1, 0, 'Пользователь', '', '', ?, ?)
    ON CONFLICT(entry_id, layer, position) DO UPDATE SET
      turkish = excluded.turkish,
      russian = excluded.russian,
      updated_at = excluded.updated_at
  `);
  const deleteTags = database.prepare("DELETE FROM entry_tags WHERE entry_id = ? AND layer = 'override'");
  const insertTag = database.prepare(`
    INSERT OR IGNORE INTO entry_tags (entry_id, layer, tag, created_at) VALUES (?, 'override', ?, ?)
  `);
  const insertLog = database.prepare(`
    INSERT INTO entry_change_log (
      entry_id, field, old_value_json, new_value_json, change_source, changed_at
    )
    VALUES (?, ?, ?, ?, 'user', ?)
  `);

  database.exec("BEGIN IMMEDIATE;");
  try {
    upsertOverride.run(
      entryId,
      next.turkish,
      next.russian,
      next.partOfSpeech,
      next.category,
      next.status,
      next.tagsOverridden,
      now,
    );

    if (patch.russian !== undefined) {
      if (patch.russian.trim()) {
        upsertTranslation.run(entryId, patch.russian.trim(), now, now);
      } else {
        deleteTranslation.run(entryId);
      }
    }

    if (patch.exampleTurkish !== undefined || patch.exampleRussian !== undefined) {
      const turkish = patch.exampleTurkish ?? before.effective.exampleTurkish;
      const russian = patch.exampleRussian ?? before.effective.exampleRussian;

      // Empty strings are an explicit override, not a request to inherit the base example.
      upsertExample.run(entryId, turkish.trim(), russian.trim(), now, now);
    }

    if (patch.tags !== undefined) {
      deleteTags.run(entryId);
      for (const tag of parseTags(patch.tags)) {
        insertTag.run(entryId, tag, now);
      }
    }

    const fields = Object.entries(patch) as [keyof EntryPatch, EntryPatch[keyof EntryPatch]][];
    for (const [field, value] of fields) {
      insertLog.run(
        entryId,
        field,
        JSON.stringify(before.effective[field as keyof DictionaryEntry] ?? null),
        JSON.stringify(value ?? null),
        now,
      );
    }

    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }

  return getEntryDetail(database, entryId);
}

export function setEntryStatus(database: DatabaseSync, entryId: number, status: EntryStatus) {
  return patchEntry(database, entryId, { status });
}

export function createUserEntry(database: DatabaseSync, input: EntryCreate, origin?: {
  name: string; url: string; license: string;
  example?: { name: string; url: string; translationUrl: string; license: string };
}) {
  validateEntryInput(input, true);
  const turkish = input.turkish.trim();
  const russian = input.russian.trim();

  if (!turkish || !russian) {
    return null;
  }

  const exists = database.prepare(`
    SELECT id
    FROM entries
    WHERE source_key = ?
       OR turkish = ? COLLATE NOCASE
       OR id IN (SELECT entry_id FROM entry_overrides WHERE turkish = ? COLLATE NOCASE)
  `).get(`user:${normalizeUserKey(turkish)}`, turkish, turkish) as IdRow | undefined;

  if (exists) {
    return getEntryDetail(database, exists.id);
  }

  const now = new Date().toISOString();
  const source = database.prepare(`
    INSERT INTO sources (source_key, name, version, license, url, updated_at)
    VALUES (?, ?, 'local', ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET updated_at = excluded.updated_at
    RETURNING id
  `).get(origin ? `web:${origin.url}` : 'user', origin?.name ?? 'Пользователь',
    origin?.license ?? 'Личная запись', origin?.url ?? null, now) as IdRow;
  const insertEntry = database.prepare(`
    INSERT INTO entries (
      source_id, source_key, turkish, russian, example_turkish, example_russian,
      example_source, example_source_license, example_source_url, example_translation_source_url,
      part_of_speech, category, active, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    RETURNING id
  `);
  const insertCard = database.prepare("INSERT OR IGNORE INTO cards (entry_id, direction) VALUES (?, ?)");
  const insertTranslation = database.prepare(`
    INSERT INTO entry_translation_items (
      entry_id, layer, text, is_primary, position, source_name, source_url, source_license,
      created_at, updated_at
    )
    VALUES (?, 'base', ?, 1, 0, ?, ?, ?, ?, ?)
  `);
  const insertExample = database.prepare(`
    INSERT INTO entry_example_items (
      entry_id, layer, turkish, russian, is_primary, position, source_name, source_url, source_license,
      created_at, updated_at
    )
    VALUES (?, 'base', ?, ?, 1, 0, ?, ?, ?, ?, ?)
  `);
  const insertTag = database.prepare(`
    INSERT OR IGNORE INTO entry_tags (entry_id, layer, tag, created_at) VALUES (?, 'base', ?, ?)
  `);
  const insertLog = database.prepare(`
    INSERT INTO entry_change_log (
      entry_id, field, old_value_json, new_value_json, change_source, changed_at
    )
    VALUES (?, 'created', 'null', ?, 'user', ?)
  `);

  database.exec("BEGIN IMMEDIATE;");
  try {
    const entry = insertEntry.get(
      source.id,
      `user:${normalizeUserKey(turkish)}`,
      turkish,
      russian,
      input.exampleTurkish?.trim() ?? "",
      input.exampleRussian?.trim() ?? "",
      origin?.example?.name ?? origin?.name ?? 'Пользователь',
      origin?.example?.license ?? origin?.license ?? '',
      origin?.example?.url ?? origin?.url ?? '',
      origin?.example?.translationUrl ?? '',
      input.partOfSpeech?.trim() || "слово",
      input.category?.trim() || "Пользовательские",
      now,
      now,
    ) as IdRow;
    insertCard.run(entry.id, "tr-ru");
    insertCard.run(entry.id, "ru-tr");
    insertTranslation.run(entry.id, russian, origin?.name ?? 'Пользователь', origin?.url ?? '', origin?.license ?? '', now, now);

    if (input.exampleTurkish?.trim() && input.exampleRussian?.trim()) {
      insertExample.run(
        entry.id,
        input.exampleTurkish.trim(),
        input.exampleRussian.trim(),
        origin?.example?.name ?? origin?.name ?? 'Пользователь',
        origin?.example?.url ?? origin?.url ?? '',
        origin?.example?.license ?? origin?.license ?? '',
        now,
        now,
      );
    }

    for (const tag of parseTags(input.tags)) {
      insertTag.run(entry.id, tag, now);
    }

    insertLog.run(entry.id, JSON.stringify({ russian, turkish }), now);
    database.exec("COMMIT;");

    return getEntryDetail(database, entry.id);
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

function normalizeUserKey(value: string) {
  return value.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, "-");
}

export function closeDatabase(database: DatabaseSync) {
  database.close();
}
