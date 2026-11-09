import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTestDatabase } from './postgres-fixture.mjs';
import { planImport } from './import.mjs';
import { getEntries, getQueueStats } from '../../apps/server/src/database.ts';

const fixtureOwner='00000000-0000-0000-0000-000000000001';
const fixtureLearner='00000000-0000-0000-0000-000000000002';
const normalize=entry=>({...entry,createdAt:new Date(entry.createdAt).toISOString(),updatedAt:new Date(entry.updatedAt).toISOString(),tags:[...entry.tags].sort()});

export async function checkRestore(directory) {
  const {report,sql}=planImport(directory,fixtureOwner);
  if (report.sourceTimeZone!==Intl.DateTimeFormat().resolvedOptions().timeZone) {
    throw new Error('Run restore-check with TZ matching the sourceTimeZone from manifest.json');
  }
  const db=await createTestDatabase(false);
  const sqlite=new DatabaseSync(join(directory,'source.sqlite'),{readOnly:true});
  try {
    await db.query('insert into auth.users values($1,$2),($3,$4)',[fixtureOwner,'test-owner@example.com',fixtureLearner,'test-learner@example.com']);
    await db.exec(sql);
    return await compareRestored(db,sqlite,report,sql);
  } finally { sqlite.close(); await db.close(); }
}

async function compareRestored(db,sqlite,report,sql) {
  await db.exec('begin; set local role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[fixtureOwner]);
  const actual=[];
  for(let offset=0;;offset+=100){
    const result=(await db.query('select public.cloud_entries($1,$2,$3,$4) result',['',{},100,offset])).rows[0].result;
    actual.push(...result.entries);
    if(actual.length>=result.total) break;
  }
  await db.exec('commit');
  const expected=getEntries(sqlite,'',100000,0).entries;
  assert.deepEqual(actual.map(normalize).sort((a,b)=>a.id-b.id),expected.map(normalize).sort((a,b)=>a.id-b.id),'effective Base / Override values');
  const now=new Date();
  for(const direction of [null,'tr-ru','ru-tr']){
    const cloud=(await db.query('select private.queue_stats($1,$2,$3,$4) result',[fixtureOwner,direction,{},now.toISOString()])).rows[0].result;
    assert.deepEqual(cloud,getQueueStats(sqlite,now,{},direction??undefined),'queue and daily statistics');
  }
  const imported=(await db.query('select count(*)::integer count from public.review_state where user_id=$1',[fixtureOwner])).rows[0].count;
  const other=(await db.query('select count(*)::integer count from public.review_state where user_id=$1',[fixtureLearner])).rows[0].count;
  assert.equal(imported,report.counts.review_state); assert.equal(other,0);
  assert.equal((await db.query('select count(*)::integer count from private.review_undo')).rows[0].count,0);
  await assert.rejects(db.exec(sql),/already imported/);
  await db.exec('rollback');
  return {...report,verified:{effectiveEntries:actual.length,queueDirections:2,ownerProgress:imported,otherProgress:other,activeUndo:0},
    environment:'isolated in-memory PostgreSQL (PGlite); hosted Auth/JWT and concurrency not tested'};
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [directory,...extra]=process.argv.slice(2);
  if(!directory||extra.length) throw new Error('Usage: restore-check.mjs <snapshot-directory>');
  console.log(JSON.stringify(await checkRestore(directory),null,2));
}
