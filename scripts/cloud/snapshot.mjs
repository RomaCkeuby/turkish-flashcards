import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

// Explicit allowlist: never export the separate auth module's credentials/sessions.
export const tables = ['sources', 'entries', 'cards', 'entry_overrides', 'entry_translation_items',
  'entry_example_items', 'entry_tags', 'entry_change_log', 'entry_removals',
  'review_state', 'review_log', 'review_undo', 'update_history', 'update_snapshots', 'app_settings'];
const settings = new Set(['updates.autoCheckEnabled', 'updates.lastCheckAt']);
const hash = value => createHash('sha256').update(value).digest('hex');
const quote = value => `"${value.replaceAll('"', '""')}"`;

export function inspect(database) {
  const integrity = database.prepare('PRAGMA integrity_check').all().map(row => row.integrity_check);
  const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
  if (integrity.length !== 1 || integrity[0] !== 'ok' || foreignKeys.length) {
    throw new Error(`Snapshot is not valid: ${JSON.stringify({ integrity, foreignKeys })}`);
  }
  const schema = database.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  for (const table of tables) {
    if (!schema.some(row => row.name === table)) throw new Error(`Missing source table: ${table}`);
  }
  const data = Object.fromEntries(tables.map(table => {
    const columns = database.prepare(`PRAGMA table_info(${quote(table)})`).all();
    const primary = columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk);
    const order = (primary.length ? primary : columns).map(column => quote(column.name)).join(', ');
    let rows = database.prepare(`SELECT * FROM ${quote(table)} ORDER BY ${order}`).all();
    if (table === 'app_settings') rows = rows.filter(row => settings.has(row.key));
    return [table, rows];
  }));
  // Preserve numeric IDs; package identity is (source.source_key, entry.source_key), never spelling.
  const sourceKeys = new Map(data.sources.map(source => [source.id, source.source_key]));
  const identity = data.entries.map(entry => ({ legacyId: entry.id,
    stableKey: JSON.stringify([sourceKeys.get(entry.source_id), entry.source_key]) }));
  if (new Set(identity.map(entry => entry.stableKey)).size !== identity.length) throw new Error('Duplicate stable identity');
  const orphanDirections = database.prepare(`SELECT entries.id FROM entries LEFT JOIN cards ON cards.entry_id = entries.id
    GROUP BY entries.id HAVING count(cards.id) != 2`).all();
  if (orphanDirections.length) throw new Error('Entries must retain both card directions');
  return { schema, data, identity, integrity: 'ok', foreignKeyViolations: 0 };
}

export async function createSnapshot(sourcePath, outputPath) {
  const source = resolve(sourcePath);
  const output = resolve(outputPath);
  if (!existsSync(source)) throw new Error('Source database does not exist');
  // An existing directory is never overwritten, even after a partial run.
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  mkdirSync(output, { recursive: false, mode: 0o700 });
  const copyPath = join(output, 'source.sqlite');
  const live = new DatabaseSync(source, { readOnly: true });
  try { await backup(live, copyPath); } finally { live.close(); }
  // Do not call openDatabase(): it seeds, migrates and repairs the database.
  const copy = new DatabaseSync(copyPath, { readOnly: true });
  let checked;
  try { checked = inspect(copy); } finally { copy.close(); }
  const snapshot = { format: 'turkish-flashcards-sqlite', version: 1, createdAt: new Date().toISOString(),
    sourceTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...checked };
  const payload = JSON.stringify(snapshot);
  writeFileSync(join(output, 'export.json'), payload, { flag: 'wx', mode: 0o600 });
  const manifest = { version: 1, snapshotId: hash(payload), createdAt: snapshot.createdAt,
    sourceTimeZone: snapshot.sourceTimeZone, integrity: checked.integrity, foreignKeyViolations: 0,
    databaseBytes: statSync(copyPath).size, databaseSha256: hash(readFileSync(copyPath)),
    exportSha256: hash(payload), counts: Object.fromEntries(tables.map(table => [table, checked.data[table].length])),
    excludedTables: checked.schema.map(row => row.name).filter(name => !tables.includes(name)),
    packages: checked.data.update_history.map(row => ({ version: row.package_version, sha256: row.manifest_sha256 })),
    activeUndo: 'archived-only; never import as an active cloud undo token' };
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return manifest;
}

export function verifySnapshot(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  const payload = readFileSync(join(directory, 'export.json'));
  if (hash(payload) !== manifest.exportSha256 || hash(payload) !== manifest.snapshotId ||
      hash(readFileSync(join(directory, 'source.sqlite'))) !== manifest.databaseSha256) throw new Error('Snapshot checksum mismatch');
  const snapshot = JSON.parse(payload);
  const restored = new DatabaseSync(join(directory, 'source.sqlite'), { readOnly: true });
  try {
    const checked = inspect(restored);
    if (JSON.stringify(checked.data) !== JSON.stringify(snapshot.data) ||
        JSON.stringify(checked.identity) !== JSON.stringify(snapshot.identity)) throw new Error('Snapshot content mismatch');
  } finally { restored.close(); }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'create' && args.length === 2) console.log(JSON.stringify(await createSnapshot(...args), null, 2));
  else if (command === 'verify' && args.length === 1) console.log(JSON.stringify(verifySnapshot(args[0]), null, 2));
  else throw new Error('Usage: snapshot.mjs create <source.db> <new-directory> | verify <directory>');
}
