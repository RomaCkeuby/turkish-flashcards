import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifySnapshot } from './snapshot.mjs';

const publicTables = ['sources','entries','cards','entry_overrides','entry_translation_items','entry_example_items',
  'entry_tags','entry_change_log','entry_removals','review_state','review_log'];
const privateTables = ['update_history','update_snapshots','app_settings'];
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const quote = name => `"${name.replaceAll('"','""')}"`;

export function planImport(directory, ownerId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId ?? '')) {
    throw new Error('An explicit Auth owner UUID is required; email and automatic owner selection are not accepted');
  }
  const manifest=verifySnapshot(directory);
  const snapshot=JSON.parse(readFileSync(join(directory,'export.json'),'utf8'));
  if (snapshot.version!==1 || snapshot.format!=='turkish-flashcards-sqlite') throw new Error('Unsupported export format');
  if (!snapshot.sourceTimeZone) throw new Error('Missing original statistics time zone');
  const report={snapshotId:manifest.snapshotId,ownerId,sourceTimeZone:snapshot.sourceTimeZone,
    counts:manifest.counts,legacyNumericIds:'preserved',activeUndoImported:false,
    target:'empty catalog only; isolated pilot must be cleaned separately',localConflicts:[],
    targetConflicts:'checked only when applying the transaction, not during offline dry-run'};
  const rows={...snapshot.data,
    review_state:snapshot.data.review_state.map(row=>({...row,user_id:ownerId})),
    review_log:snapshot.data.review_log.map(row=>({...row,user_id:ownerId,request_id:null}))};
  const allTables=[...publicTables.map(t=>`public.${t}`),...privateTables.map(t=>`private.${t}`)];
  let sql=`-- PRIVATE: contains personal collection/progress. Never publish as a CI artifact.\nBEGIN;\nSET LOCAL standard_conforming_strings = on;\n`;
  sql+=`LOCK TABLE ${allTables.join(', ')}, private.migration_imports, private.collection_roles IN ACCESS EXCLUSIVE MODE;\n`;
  sql+=`DO $preflight$ BEGIN
    IF EXISTS(SELECT 1 FROM private.migration_imports WHERE snapshot_id=${literal(manifest.snapshotId)}) THEN RAISE EXCEPTION 'Snapshot already imported'; END IF;
    IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=${literal(ownerId)}::uuid) THEN RAISE EXCEPTION 'Owner Auth account does not exist'; END IF;
    IF EXISTS(SELECT 1 FROM private.collection_roles WHERE user_id<>${literal(ownerId)}::uuid) THEN RAISE EXCEPTION 'Another owner is configured'; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=${literal(snapshot.sourceTimeZone)}) THEN RAISE EXCEPTION 'Unknown source time zone'; END IF;
    IF ${allTables.map(t=>`EXISTS(SELECT 1 FROM ${t})`).join(' OR ')}
      OR EXISTS(SELECT 1 FROM private.review_requests) OR EXISTS(SELECT 1 FROM private.review_undo)
      THEN RAISE EXCEPTION 'Target catalog/progress must be empty'; END IF;
  END $preflight$;\n`;
  for (const name of [...publicTables,...privateTables]) {
    const target=`${publicTables.includes(name)?'public':'private'}.${name}`;
    if (!rows[name].length) continue;
    const columns=Object.keys(rows[name][0]).map(quote).join(',');
    sql+=`INSERT INTO ${target} (${columns}) SELECT ${columns} FROM jsonb_populate_recordset(null::${target},${literal(JSON.stringify(rows[name]))}::jsonb);\n`;
    if (Object.hasOwn(rows[name][0],'id')) {
      sql+=`SELECT setval(pg_get_serial_sequence(${literal(target)},'id'),(SELECT max(id) FROM ${target}),true);\n`;
    }
  }
  sql+=`INSERT INTO private.collection_roles VALUES(${literal(ownerId)}::uuid,'owner') ON CONFLICT(user_id) DO NOTHING;\n`;
  sql+=`INSERT INTO public.profiles(user_id,time_zone) VALUES(${literal(ownerId)}::uuid,${literal(snapshot.sourceTimeZone)})
    ON CONFLICT(user_id) DO UPDATE SET time_zone=excluded.time_zone;\n`;
  sql+=`DO $verify$ BEGIN\n`;
  for (const name of [...publicTables,...privateTables]) {
    const target=`${publicTables.includes(name)?'public':'private'}.${name}`;
    sql+=`IF (SELECT count(*) FROM ${target})<>${rows[name].length} THEN RAISE EXCEPTION 'Count mismatch: ${name}'; END IF;\n`;
  }
  sql+=`END $verify$;\nINSERT INTO private.migration_imports(snapshot_id,owner_id,report) VALUES(${literal(manifest.snapshotId)},${literal(ownerId)}::uuid,${literal(JSON.stringify(report))}::jsonb);\nCOMMIT;\n`;
  return {report,sql};
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [directory,ownerId,output,...extra]=process.argv.slice(2);
  if (!directory || !ownerId || extra.length) throw new Error('Usage: import.mjs <snapshot-directory> <owner-uuid> [private-output.sql]. Without output: dry-run only.');
  const plan=planImport(directory,ownerId);
  if (output) {
    if (existsSync(output)) throw new Error('Output already exists');
    writeFileSync(output,plan.sql,{flag:'wx',mode:0o600});
  }
  console.log(JSON.stringify({...plan.report,mode:output?'SQL prepared; not applied':'dry-run; target not contacted'},null,2));
}
