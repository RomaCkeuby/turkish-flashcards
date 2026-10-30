import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export type UpdateCardRecord = {
  category: string;
  exampleRussian: string;
  exampleSource: string;
  exampleSourceLicense: string;
  exampleSourceUrl: string;
  exampleTurkish: string;
  exampleTranslationSourceUrl: string;
  partOfSpeech: string;
  russian: string;
  sourceLicense: string;
  sourceName: string;
  sourceUrl: string;
  turkish: string;
};

export type UpdateManifest = {
  createdAt: string;
  packageFile: string;
  recordCount: number;
  schemaVersion: 1;
  sha256: string;
  source: {
    name: string;
    url: string;
    license: string;
  };
  updateMode?: "append" | "full";
  version: string;
};

export type UpdatePreview = {
  added: number;
  changed: number;
  disabled: number;
  details: {
    added: UpdateCardRecord[];
    changed: {
      after: UpdateCardRecord;
      before: EntryRow;
      fields: string[];
    }[];
    disabled: { turkish: string; russian: string }[];
  };
  examples: {
    added: UpdateCardRecord[];
    changed: UpdateCardRecord[];
    disabled: { turkish: string; russian: string }[];
  };
  manifest: UpdateManifest;
};

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const defaultPackageDirectory = resolve(moduleDirectory, "../update-packages/current");

type CountRow = { count: number };
type EntryRow = {
  active: number;
  category: string;
  exampleRussian: string;
  exampleSource: string;
  exampleSourceLicense: string;
  exampleSourceUrl: string;
  exampleTranslationSourceUrl: string;
  exampleTurkish: string;
  id: number;
  partOfSpeech: string;
  russian: string;
  sourceKey: string;
  personal: number;
  turkish: string;
};
type IdRow = { id: number };
type SnapshotRow = {
  id: number;
  snapshotJson: string;
  createdAt: string;
  packageVersion: string;
};
const snapshotTables = [
  "sources", "entries", "cards", "entry_translation_items", "entry_example_items",
] as const;
type SnapshotTable = typeof snapshotTables[number];
type SnapshotDataRow = Record<string, unknown> & { id: number };
type DictionarySnapshot = Record<SnapshotTable, SnapshotDataRow[]>;
type RowChange = { before: SnapshotDataRow | null; after: SnapshotDataRow };
type UpdateChanges = {
  formatVersion: 2;
  historyId?: number;
  changes: Record<SnapshotTable, RowChange[]>;
};

export class UpdateRollbackConflictError extends Error {}

export function getDefaultPackageDirectory() {
  return defaultPackageDirectory;
}

export function normalizeTurkishKey(value: string) {
  return value.trim().toLocaleLowerCase("tr-TR");
}

export function readUpdatePackage(packageDirectory = defaultPackageDirectory) {
  const manifestPath = resolve(packageDirectory, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as UpdateManifest;
  const cardsPath = resolve(packageDirectory, manifest.packageFile);
  const compressed = readFileSync(cardsPath);
  const sha256 = createHash("sha256").update(compressed).digest("hex");

  if (sha256 !== manifest.sha256) {
    throw new Error("Контрольная сумма пакета обновления не совпадает с manifest.json.");
  }

  const records = gunzipSync(compressed)
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as UpdateCardRecord);

  return { manifest, records };
}

export function writeUpdatePackage(
  records: UpdateCardRecord[],
  version: string,
  packageDirectory = defaultPackageDirectory,
  options: {
    source?: UpdateManifest["source"];
    updateMode?: UpdateManifest["updateMode"];
  } = {},
) {
  mkdirSync(packageDirectory, { recursive: true });

  const packageFile = "cards.jsonl.gz";
  const cardsBody = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  const compressed = gzipSync(Buffer.from(cardsBody, "utf8"), { level: 9 });
  const sha256 = createHash("sha256").update(compressed).digest("hex");
  const manifest: UpdateManifest = {
    createdAt: new Date().toISOString(),
    packageFile,
    recordCount: records.length,
    schemaVersion: 1,
    sha256,
    source: {
      license: "Wiktionary/Kaikki data, see source pages for license details",
      name: "Kaikki/Wiktionary",
      url: "https://kaikki.org/dictionary/rawdata.html",
    },
    updateMode: options.updateMode,
    version,
  };
  if (options.source) {
    manifest.source = options.source;
  }

  writeFileSync(resolve(packageDirectory, packageFile), compressed);
  writeFileSync(resolve(packageDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  return manifest;
}

function hasPackage(packageDirectory = defaultPackageDirectory) {
  return existsSync(resolve(packageDirectory, "manifest.json"));
}

function selectEntries(database: DatabaseSync) {
  return database.prepare(`
    SELECT
      entries.id,
      turkish,
      russian,
      example_turkish AS exampleTurkish,
      example_russian AS exampleRussian,
      example_source AS exampleSource,
      example_source_license AS exampleSourceLicense,
      example_source_url AS exampleSourceUrl,
      example_translation_source_url AS exampleTranslationSourceUrl,
      part_of_speech AS partOfSpeech,
      category,
      active,
      sources.source_key AS sourceKey,
      CASE WHEN entries.source_key LIKE 'user:%' OR sources.source_key = 'user' THEN 1 ELSE 0 END AS personal
    FROM entries
    JOIN sources ON sources.id = entries.source_id
  `).all() as EntryRow[];
}

function getUpdateContext(database: DatabaseSync, packageDirectory: string) {
  const { manifest, records } = readUpdatePackage(packageDirectory);
  const allEntries = selectEntries(database);
  const personalKeys = new Set(allEntries.filter((entry) => entry.personal === 1)
    .map((entry) => normalizeTurkishKey(entry.turkish)));
  return {
    manifest,
    records: records.filter((record) => !personalKeys.has(normalizeTurkishKey(record.turkish))),
    entries: allEntries.filter((entry) => entry.personal === 0),
  };
}

function comparableEntry(record: UpdateCardRecord) {
  return JSON.stringify({
    category: record.category,
    exampleRussian: record.exampleRussian,
    exampleSource: record.exampleSource,
    exampleSourceLicense: record.exampleSourceLicense,
    exampleSourceUrl: record.exampleSourceUrl,
    exampleTranslationSourceUrl: record.exampleTranslationSourceUrl,
    exampleTurkish: record.exampleTurkish,
    partOfSpeech: record.partOfSpeech,
    russian: record.russian,
    turkish: record.turkish,
  });
}

function comparableExisting(entry: EntryRow) {
  return JSON.stringify({
    category: entry.category,
    exampleRussian: entry.exampleRussian,
    exampleSource: entry.exampleSource,
    exampleSourceLicense: entry.exampleSourceLicense,
    exampleSourceUrl: entry.exampleSourceUrl,
    exampleTranslationSourceUrl: entry.exampleTranslationSourceUrl,
    exampleTurkish: entry.exampleTurkish,
    partOfSpeech: entry.partOfSpeech,
    russian: entry.russian,
    turkish: entry.turkish,
  });
}

function changedFields(entry: EntryRow, record: UpdateCardRecord) {
  const fields: string[] = [];
  const before = {
    category: entry.category,
    exampleRussian: entry.exampleRussian,
    exampleTurkish: entry.exampleTurkish,
    partOfSpeech: entry.partOfSpeech,
    russian: entry.russian,
    turkish: entry.turkish,
  };
  const after = {
    category: record.category,
    exampleRussian: record.exampleRussian,
    exampleTurkish: record.exampleTurkish,
    partOfSpeech: record.partOfSpeech,
    russian: record.russian,
    turkish: record.turkish,
  };

  for (const key of Object.keys(before) as (keyof typeof before)[]) {
    if (before[key] !== after[key]) {
      fields.push(key);
    }
  }

  return fields;
}

export function previewUpdate(database: DatabaseSync, packageDirectory = defaultPackageDirectory) {
  const { manifest, records, entries } = getUpdateContext(database, packageDirectory);
  const existingByKey = new Map(entries.map((entry) => [normalizeTurkishKey(entry.turkish), entry]));
  const packageKeys = new Set(records.map((record) => normalizeTurkishKey(record.turkish)));
  const added: UpdateCardRecord[] = [];
  const changed: { after: UpdateCardRecord; before: EntryRow; fields: string[] }[] = [];
  const disabled: { turkish: string; russian: string }[] = [];

  for (const record of records) {
    const existing = existingByKey.get(normalizeTurkishKey(record.turkish));
    if (!existing) {
      added.push(record);
    } else if (existing.active === 0 || comparableExisting(existing) !== comparableEntry(record)) {
      const fields = changedFields(existing, record);
      if (existing.active === 0) fields.push("status");
      changed.push({ after: record, before: existing, fields });
    }
  }

  if (manifest.updateMode !== "append") {
    for (const entry of entries) {
      if (entry.active === 1 && !packageKeys.has(normalizeTurkishKey(entry.turkish))) {
        disabled.push({ russian: entry.russian, turkish: entry.turkish });
      }
    }
  }

  return {
    added: added.length,
    changed: changed.length,
    disabled: disabled.length,
    details: {
      added: added.slice(0, 25),
      changed: changed.slice(0, 25),
      disabled: disabled.slice(0, 25),
    },
    examples: {
      added: added.slice(0, 5),
      changed: changed.slice(0, 5).map((item) => item.after),
      disabled: disabled.slice(0, 5),
    },
    manifest,
  } satisfies UpdatePreview;
}

function snapshotDictionary(database: DatabaseSync): DictionarySnapshot {
  return Object.fromEntries(snapshotTables.map((table) => [
    table,
    database.prepare(`SELECT * FROM ${table} ${table.startsWith("entry_") ? "WHERE layer = 'base'" : ""}`)
      .all(),
  ])) as DictionarySnapshot;
}

function dictionaryChanges(before: DictionarySnapshot, after: DictionarySnapshot): UpdateChanges {
  return {
    formatVersion: 2,
    changes: Object.fromEntries(snapshotTables.map((table) => {
      const previous = new Map(before[table].map((row) => [row.id, row]));
      const changes = after[table].flatMap((row) => {
        const old = previous.get(row.id) ?? null;
        return old && rowsEqual(old, row) ? [] : [{ before: old, after: row }];
      });
      return [table, changes];
    })) as UpdateChanges["changes"],
  };
}

function rowsEqual(expected: SnapshotDataRow, actual: SnapshotDataRow) {
  return Object.keys(expected).every((column) => expected[column] === actual[column]);
}

function getOrCreateSource(database: DatabaseSync, manifest: UpdateManifest) {
  return database.prepare(`
    INSERT INTO sources (source_key, name, version, license, url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
      name = excluded.name,
      version = excluded.version,
      license = excluded.license,
      url = excluded.url,
      updated_at = excluded.updated_at
    RETURNING id
  `).get(
    "kaikki-wiktionary",
    manifest.source.name,
    manifest.version,
    manifest.source.license,
    manifest.source.url,
    new Date().toISOString(),
  ) as IdRow;
}

export function applyUpdate(database: DatabaseSync, packageDirectory = defaultPackageDirectory) {
  const preview = previewUpdate(database, packageDirectory);
  const { manifest, records, entries } = getUpdateContext(database, packageDirectory);
  const now = new Date().toISOString();
  const existingByKey = new Map(entries.map((entry) => [normalizeTurkishKey(entry.turkish), entry]));
  const packageKeys = new Set(records.map((record) => normalizeTurkishKey(record.turkish)));

  const insertSnapshot = database.prepare(`
    INSERT INTO update_snapshots (package_version, manifest_sha256, snapshot_json, created_at)
    VALUES (?, ?, ?, ?)
  `);
  const updateEntry = database.prepare(`
    UPDATE entries SET
      turkish = ?,
      russian = ?,
      example_turkish = ?,
      example_russian = ?,
      example_source = ?,
      example_source_license = ?,
      example_source_url = ?,
      example_translation_source_url = ?,
      part_of_speech = ?,
      category = ?,
      active = 1,
      updated_at = ?
    WHERE id = ?
  `);
  const insertEntry = database.prepare(`
    INSERT INTO entries (
      source_id, source_key, turkish, russian, example_turkish, example_russian,
      example_source, example_source_license, example_source_url, example_translation_source_url,
      part_of_speech, category, active, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    RETURNING id
  `);
  const insertCard = database.prepare(`
    INSERT INTO cards (entry_id, direction) VALUES (?, ?)
    ON CONFLICT(entry_id, direction) DO UPDATE SET enabled = 1
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
  const disableEntry = database.prepare("UPDATE entries SET active = 0, updated_at = ? WHERE id = ?");
  const insertHistory = database.prepare(`
    INSERT INTO update_history (
      package_version, manifest_sha256, applied_at, added_count, changed_count, disabled_count
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  database.exec("BEGIN IMMEDIATE;");
  try {
    const before = snapshotDictionary(database);
    const source = getOrCreateSource(database, manifest);

    for (const record of records) {
      const key = normalizeTurkishKey(record.turkish);
      const sourceKey = `kaikki:${key}`;
      const existing = existingByKey.get(key);
      const parameters = [
        record.turkish,
        record.russian,
        record.exampleTurkish,
        record.exampleRussian,
        record.exampleSource,
        record.exampleSourceLicense,
        record.exampleSourceUrl,
        record.exampleTranslationSourceUrl,
        record.partOfSpeech,
        record.category,
      ] as const;

      if (existing) {
        updateEntry.run(...parameters, now, existing.id);
        upsertBaseTranslation.run(
          existing.id,
          record.russian,
          record.sourceName,
          record.sourceUrl,
          record.sourceLicense,
          now,
          now,
        );
        if (record.exampleTurkish && record.exampleRussian) {
          upsertBaseExample.run(
            existing.id,
            record.exampleTurkish,
            record.exampleRussian,
            record.exampleSource,
            record.exampleSourceUrl,
            record.exampleSourceLicense,
            now,
            now,
          );
        }
        insertCard.run(existing.id, "tr-ru");
        insertCard.run(existing.id, "ru-tr");
      } else {
        const inserted = insertEntry.get(source.id, sourceKey, ...parameters, now, now) as IdRow;
        upsertBaseTranslation.run(
          inserted.id,
          record.russian,
          record.sourceName,
          record.sourceUrl,
          record.sourceLicense,
          now,
          now,
        );
        if (record.exampleTurkish && record.exampleRussian) {
          upsertBaseExample.run(
            inserted.id,
            record.exampleTurkish,
            record.exampleRussian,
            record.exampleSource,
            record.exampleSourceUrl,
            record.exampleSourceLicense,
            now,
            now,
          );
        }
        insertCard.run(inserted.id, "tr-ru");
        insertCard.run(inserted.id, "ru-tr");
      }
    }

    if (manifest.updateMode !== "append") {
      for (const entry of existingByKey.values()) {
        if (entry.active === 1 && !packageKeys.has(normalizeTurkishKey(entry.turkish))) {
          disableEntry.run(now, entry.id);
        }
      }
    }

    const history = insertHistory.run(
      manifest.version,
      manifest.sha256,
      now,
      preview.added,
      preview.changed,
      preview.disabled,
    );
    const changes = dictionaryChanges(before, snapshotDictionary(database));
    changes.historyId = Number(history.lastInsertRowid);
    insertSnapshot.run(manifest.version, manifest.sha256, JSON.stringify(changes), now);
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }

  return preview;
}

export function rollbackLastUpdate(database: DatabaseSync) {
  const snapshot = database.prepare(`
    SELECT id, snapshot_json AS snapshotJson, created_at AS createdAt,
      package_version AS packageVersion
    FROM update_snapshots
    ORDER BY id DESC
    LIMIT 1
  `).get() as SnapshotRow | undefined;

  if (!snapshot) {
    return null;
  }

  database.exec("BEGIN IMMEDIATE;");
  try {
    const changes = readSnapshotChanges(database, snapshot);
    // Check every affected base row before writing anything. Overrides and reviews
    // live in separate tables and never participate in the rollback.
    for (const table of snapshotTables) {
      const select = database.prepare(`SELECT * FROM ${table} WHERE id = ?`);
      for (const change of changes.changes[table]) {
        const current = select.get(change.after.id) as SnapshotDataRow | undefined;
        if (!current || !rowsEqual(change.after, current)) {
          throw new UpdateRollbackConflictError(
            "Данные после обновления изменились. Откат отменён, чтобы сохранить более поздние изменения.",
          );
        }
      }
    }
    for (const table of snapshotTables) {
      for (const change of changes.changes[table]) {
        if (change.before) {
          restoreRows(database, table, [change.before]);
        } else if (table === "entries" || table === "cards") {
          // Keep IDs and review progress so applying the package again restores learning.
          const column = table === "entries" ? "active" : "enabled";
          database.prepare(`UPDATE ${table} SET ${column} = 0 WHERE id = ?`).run(change.after.id);
        } else if (table !== "sources") {
          database.prepare(`DELETE FROM ${table} WHERE id = ?`).run(change.after.id);
        }
        // New sources remain referenced by the retained, inactive entries.
      }
    }
    if (changes.historyId !== undefined) {
      database.prepare("DELETE FROM update_history WHERE id = ?").run(changes.historyId);
    }
    database.prepare("DELETE FROM update_snapshots WHERE id = ?").run(snapshot.id);
    database.exec("COMMIT;");
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }

  return { restored: true };
}

function readSnapshotChanges(database: DatabaseSync, snapshot: SnapshotRow): UpdateChanges {
  const data = JSON.parse(snapshot.snapshotJson) as UpdateChanges | {
    cards: SnapshotDataRow[];
    entries: SnapshotDataRow[];
    examples?: SnapshotDataRow[];
    sources: SnapshotDataRow[];
    translations?: SnapshotDataRow[];
  };
  if ("formatVersion" in data) {
    return data;
  }

  // Old snapshots have no change list. Their timestamp identifies rows written
  // by the old apply implementation; later additions must remain untouched.
  const current = snapshotDictionary(database);
  const affectedIds = new Set(current.entries
    .filter((row) => row.updated_at === snapshot.createdAt)
    .map((row) => row.id));
  const scope = (rows: DictionarySnapshot): DictionarySnapshot => ({
    entries: rows.entries.filter((row) => affectedIds.has(row.id)),
    cards: rows.cards.filter((row) => affectedIds.has(Number(row.entry_id))),
    entry_translation_items: rows.entry_translation_items.filter((row) => affectedIds.has(Number(row.entry_id))),
    entry_example_items: rows.entry_example_items.filter((row) => affectedIds.has(Number(row.entry_id))),
    sources: rows.sources.filter((row) => row.source_key === "kaikki-wiktionary"),
  });
  const changes = dictionaryChanges(scope({
    cards: data.cards,
    entries: data.entries,
    sources: data.sources,
    entry_translation_items: data.translations ?? [],
    entry_example_items: data.examples ?? [],
  }), scope(current));
  const history = database.prepare(`
    SELECT id FROM update_history WHERE applied_at = ? AND package_version = ? ORDER BY id DESC LIMIT 1
  `).get(snapshot.createdAt, snapshot.packageVersion) as IdRow | undefined;
  changes.historyId = history?.id;
  return changes;
}

function restoreRows(database: DatabaseSync, table: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    return;
  }

  const columns = Object.keys(rows[0] ?? {});
  const placeholders = columns.map(() => "?").join(", ");
  const updateColumns = columns
    .filter((column) => column !== "id")
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");
  const statement = database.prepare(`
    INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})
    ON CONFLICT(id) DO UPDATE SET ${updateColumns}
  `);

  for (const row of rows) {
    statement.run(...columns.map((column) => toSqlValue(row[column])));
  }
}

function toSqlValue(value: unknown): SQLInputValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    value instanceof Uint8Array
  ) {
    return value;
  }

  return null;
}

export function getUpdateStatus(database: DatabaseSync, packageDirectory = defaultPackageDirectory) {
  const history = database.prepare(`
    SELECT
      package_version AS packageVersion,
      manifest_sha256 AS manifestSha256,
      applied_at AS appliedAt,
      added_count AS added,
      changed_count AS changed,
      disabled_count AS disabled
    FROM update_history
    ORDER BY id DESC
    LIMIT 1
  `).get();
  const snapshotCount = database.prepare("SELECT COUNT(*) AS count FROM update_snapshots").get() as CountRow;
  const settings = getUpdateSettings(database);
  const packageAvailable = hasPackage(packageDirectory);
  const preview = packageAvailable ? previewUpdate(database, packageDirectory) : null;

  return {
    autoCheckEnabled: settings.autoCheckEnabled,
    canRollback: snapshotCount.count > 0,
    lastCheckAt: settings.lastCheckAt ?? null,
    lastUpdate: history ?? null,
    nextCheckAt: settings.nextCheckAt,
    packageAvailable,
    preview,
  };
}

function getUpdateSettings(database: DatabaseSync) {
  const autoCheckEnabled = getSetting(database, "updates.autoCheckEnabled") !== "false";
  const lastCheckAt = getSetting(database, "updates.lastCheckAt");
  const nextCheckAt = lastCheckAt
    ? new Date(new Date(lastCheckAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    : null;

  return { autoCheckEnabled, lastCheckAt, nextCheckAt };
}

function getSetting(database: DatabaseSync, key: string) {
  return (database.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined)?.value;
}

export function markWeeklyUpdateCheck(database: DatabaseSync) {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('updates.lastCheckAt', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(now, now);

  return getUpdateStatus(database);
}

export function runAutomaticWeeklyUpdateCheck(database: DatabaseSync) {
  const settings = getUpdateSettings(database);
  if (!settings.autoCheckEnabled) {
    return getUpdateStatus(database);
  }

  if (settings.lastCheckAt && settings.nextCheckAt && new Date(settings.nextCheckAt) > new Date()) {
    return getUpdateStatus(database);
  }

  return markWeeklyUpdateCheck(database);
}
