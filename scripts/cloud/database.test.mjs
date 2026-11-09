import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createTestDatabase } from './postgres-fixture.mjs';
import { openDatabase, recordReview, undoReview } from '../../apps/server/src/database.ts';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-000000000002';
const owner = '00000000-0000-0000-0000-000000000003';

export async function fixture() {
  const db = await createTestDatabase();
  await db.query('insert into auth.users values ($1,$2),($3,$4),($5,$6)', [A,'a@example.com',B,'b@example.com',owner,'owner@example.com']);
  await db.query("insert into private.collection_roles values ($1,'owner')",[owner]);
  return db;
}

async function asUser(db, user, operation, role='authenticated') {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user ?? '']);
    const result = await operation();
    await db.exec('commit');
    return result;
  } catch (error) { await db.exec('rollback'); throw error; }
}
const call = async (db, name, args=[]) => (await db.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args)).rows[0].result;

test('cloud migrations: real PostgreSQL roles enforce catalog/progress isolation and block privilege escalation', async t => {
  const db = await fixture(); t.after(()=>db.close());
  await assert.rejects(asUser(db,null,()=>call(db,'cloud_stats'), 'anon'),/permission denied/);
  await assert.rejects(asUser(db,null,()=>call(db,'cloud_stats')),/Authentication required/);
  await assert.rejects(asUser(db,A,()=>db.query('select * from private.collection_roles')),/permission denied/);
  await assert.rejects(asUser(db,A,()=>db.query("insert into public.profiles(user_id) values ($1)",[owner])),/permission denied/);
  await assert.rejects(asUser(db,A,()=>db.query("update public.entries set russian='injected'")),/permission denied/);
  await assert.rejects(asUser(db,A,()=>db.query("insert into public.review_state values ($1,1,now(),1,2.5,1,0,now(),now())",[B])),/permission denied/);
  const result = await asUser(db,A,()=>call(db,'cloud_review',[1,'correct',randomUUID()]));
  await assert.rejects(asUser(db,B,()=>call(db,'cloud_review',[1,'correct',randomUUID(),A])),/Account changed/);
  assert.equal(result.intervalDays,1);
  assert.equal((await asUser(db,B,()=>db.query('select * from public.review_state'))).rows.length,0);
  assert.equal((await asUser(db,A,()=>db.query('select * from public.review_state'))).rows.length,1);
  assert.equal((await asUser(db,B,()=>db.query('select * from public.review_log'))).rows.length,0);
  assert.equal((await asUser(db,B,()=>db.query('select * from public.profiles'))).rows.length,1);
  await assert.rejects(asUser(db,B,()=>call(db,'cloud_undo',[result.undoToken])),/Undo expired/);
  await assert.rejects(asUser(db,A,()=>db.query('select * from private.update_snapshots')),/permission denied/);
  await assert.rejects(asUser(db,A,()=>db.query("update public.profiles set time_zone='UTC'")),/permission denied/);
});

test('cloud review idempotency, queue, latest undo and SQLite schedule parity', async t => {
  const db = await fixture(); t.after(()=>db.close());
  const sqlite = openDatabase(':memory:'); t.after(()=>sqlite.close());
  for (const answer of ['correct','correct','correct','incorrect','incorrect','correct']) {
    const id=randomUUID();
    const first=await asUser(db,A,()=>call(db,'cloud_review',[1,answer,id]));
    const again=await asUser(db,A,()=>call(db,'cloud_review',[1,answer,id]));
    assert.deepEqual(first,again);
    const local=recordReview(sqlite,1,answer,new Date(first.dueAt).getTime() ?
      new Date(new Date(first.dueAt).getTime()-first.intervalDays*86400000) : undefined);
    for (const field of ['intervalDays','easeFactor','repetitions','lapses']) assert.equal(first[field],local[field]);
    assert.ok(Math.abs(Date.parse(first.dueAt)-Date.parse(local.dueAt))<2);
    await assert.rejects(asUser(db,A,()=>call(db,'cloud_review',[3,answer,id])),/reused/);
  }
  const stats=await asUser(db,A,()=>call(db,'cloud_stats'));
  assert.equal(stats.queue.reviewedToday,6);
  assert.equal(stats.queue.correctToday,4);
  assert.equal(stats.directions['ru-tr'].reviewedToday,6); // Legacy daily totals span both directions.
  const next=await asUser(db,A,()=>call(db,'cloud_next_card',['tr-ru',{},'new',null]));
  assert.equal(next.card.id,3);
  const other=await asUser(db,B,()=>call(db,'cloud_next_card',['tr-ru',{},'new',1]));
  assert.equal(other.card.id,1);
  const initial=await asUser(db,A,()=>call(db,'cloud_review',[3,'incorrect',randomUUID()]));
  const latest=await asUser(db,A,()=>call(db,'cloud_review',[1,'correct',randomUUID()]));
  await assert.rejects(asUser(db,A,()=>call(db,'cloud_undo',[initial.undoToken])),/expired/);
  await asUser(db,A,()=>call(db,'cloud_undo',[latest.undoToken]));
  await assert.rejects(asUser(db,A,()=>call(db,'cloud_undo',[latest.undoToken])),/expired/);
  const fresh=await asUser(db,B,()=>call(db,'cloud_review',[3,'correct',randomUUID()]));
  await asUser(db,B,()=>call(db,'cloud_undo',[fresh.undoToken]));
  assert.equal((await asUser(db,B,()=>db.query('select * from public.review_state'))).rows.length,0);
  assert.equal(undoReview(sqlite,'not-a-valid-token'),null);
});

test('catalog filters and empty overrides survive cloud reads', async t => {
  const db=await fixture(); t.after(()=>db.close());
  await db.exec(`insert into public.entry_overrides(entry_id,russian,tags_overridden,updated_at) values(1,'мой перевод',1,now());
    insert into public.entry_tags(entry_id,layer,tag,created_at) values(1,'base','base-only',now());
    insert into public.entry_example_items(entry_id,layer,turkish,russian,is_primary,created_at,updated_at)
    values(1,'override','','',1,now(),now());`);
  const list=await asUser(db,A,()=>call(db,'cloud_entries',['мой',{},50,0]));
  assert.equal(list.total,1); assert.equal(list.entries[0].russian,'мой перевод');
  assert.deepEqual(list.entries[0].tags,[]); assert.equal(list.entries[0].exampleTurkish,'');
  const filters=await asUser(db,A,()=>call(db,'cloud_filters'));
  assert.deepEqual(filters.tags,[]);
  await db.exec("insert into public.entry_removals values(1,'deleted',null,now());");
  const remaining=await asUser(db,A,()=>call(db,'cloud_entries',['',{},50,0]));
  assert.equal(remaining.total,1);
  await assert.rejects(asUser(db,A,()=>call(db,'cloud_review',[1,'correct',randomUUID()])),/unavailable/);
});

test('Moscow day boundaries, due priority and stale undo preserve the legacy rules',async t=>{
  const db=await fixture();t.after(()=>db.close());
  await db.query(`insert into public.review_log(user_id,card_id,rating,reviewed_at) values
    ($1,1,'good','2026-11-02T20:59:59.999Z'),($1,1,'good','2026-11-02T21:00:00Z'),
    ($1,1,'again','2026-11-03T20:59:59.999Z'),($1,1,'good','2026-11-03T21:00:00Z')`,[A]);
  const at=async time=>(await db.query('select private.queue_stats($1,null,$2,$3) result',[A,{},time])).rows[0].result;
  const end=await at('2026-11-03T20:59:59.999Z');
  assert.equal(end.reviewedToday,2);assert.equal(end.accuracyToday,50);
  const start=await at('2026-11-03T21:00:00Z');
  assert.equal(start.reviewedToday,1);assert.equal(start.accuracyToday,100);
  const reviewed=await asUser(db,A,()=>call(db,'cloud_review',[1,'correct',randomUUID()]));
  await db.query("update public.review_state set due_at=now()-interval '1 day' where user_id=$1 and card_id=1",[A]);
  const next=await asUser(db,A,()=>call(db,'cloud_next_card',['tr-ru',{},'all',null]));
  assert.equal(next.card.id,1,'due reviews precede new cards');
  await assert.rejects(asUser(db,A,()=>call(db,'cloud_undo',[reviewed.undoToken])),/Progress changed/);
  assert.equal((await db.query('select count(*)::integer count from public.review_state where user_id=$1',[A])).rows[0].count,1);
  const spaced=await asUser(db,A,()=>call(db,'cloud_entries',[' merhaba ',{},50,0]));
  assert.equal(spaced.total,1);
});
