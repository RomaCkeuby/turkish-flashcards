import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, patchEntry, recordReview, getEntryDetail } from '../../apps/server/src/database.ts';
import { createSnapshot, verifySnapshot } from './snapshot.mjs';

test('online WAL backup preserves overrides, review state, IDs and history without seeding the snapshot', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cloud-snapshot-'));
  const source = join(directory, 'live.db');
  const database = openDatabase(source);
  t.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });
  patchEntry(database, 1, { tags: [], exampleTurkish: '', exampleRussian: '' });
  recordReview(database, 1, 'correct');
  database.exec("CREATE TABLE auth_sessions (secret TEXT); INSERT INTO auth_sessions VALUES ('DO-NOT-EXPORT');");
  database.prepare('INSERT INTO app_settings VALUES (?, ?, ?)').run('auth.secret', 'DO-NOT-EXPORT', new Date().toISOString());
  const before = getEntryDetail(database, 1);
  const output = join(directory, 'snapshot');
  const manifest = await createSnapshot(source, output);
  assert.equal(manifest.counts.entries, 250);
  assert.equal(manifest.counts.review_log, 1);
  assert.deepEqual(verifySnapshot(output), manifest);
  const exported = readFileSync(join(output, 'export.json'), 'utf8');
  assert.equal(exported.includes('DO-NOT-EXPORT'), false);
  assert.deepEqual(getEntryDetail(database, 1), before);
  // The raw private SQLite backup includes all original tables; the portable export excludes Auth.
  const copy = new DatabaseSync(join(output, 'source.sqlite'), { readOnly: true });
  try { assert.deepEqual(copy.prepare('SELECT * FROM review_state').all(), database.prepare('SELECT * FROM review_state').all()); }
  finally { copy.close(); }
  recordReview(database, 2, 'incorrect');
  assert.equal(verifySnapshot(output).counts.review_log, 1);
  await assert.rejects(createSnapshot(source, output), /EEXIST/);
  writeFileSync(join(output, 'export.json'), exported + ' ');
  assert.throws(() => verifySnapshot(output), /checksum/);
});
