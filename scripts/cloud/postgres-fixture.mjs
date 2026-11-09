import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export async function createTestDatabase(seed = true) {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;`);
    for (const file of readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort()) {
      await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
    }
    if (seed) await db.exec(readFileSync('supabase/seed.sql', 'utf8'));
    return db;
  } catch (error) { await db.close(); throw error; }
}
