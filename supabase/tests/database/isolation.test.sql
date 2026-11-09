begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000001','pilot-a@example.test'),
 ('00000000-0000-0000-0000-000000000002','pilot-b@example.test');
select ok(not has_table_privilege('anon','public.entries','SELECT'),'guest cannot read private catalog');
select ok(not has_table_privilege('authenticated','public.entries','UPDATE'),'learner cannot edit catalog directly');
select ok(not has_schema_privilege('authenticated','private','USAGE'),'private schema is inaccessible');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select is((select count(*) from public.profiles),1::bigint,'A sees only own profile');
select lives_ok($$select public.cloud_review(1,'correct','10000000-0000-0000-0000-000000000001')$$,'A can rate');
select lives_ok($$select public.cloud_review(1,'correct','10000000-0000-0000-0000-000000000001')$$,'retry is accepted');
select is((select count(*) from public.review_log),1::bigint,'retry creates only one log event');
select throws_ok($$select public.cloud_review(3,'correct','10000000-0000-0000-0000-000000000001')$$,'22023',null,'request id cannot be reused for another card');
select throws_ok($$update public.profiles set user_id='00000000-0000-0000-0000-000000000002'$$,'42501',null,'A cannot replace profile identity');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select is((select count(*) from public.review_state),0::bigint,'B cannot see A progress');
select is((select count(*) from public.review_log),0::bigint,'B cannot see A history');
select is((public.cloud_stats()->'queue'->>'reviewedToday')::integer,0,'B daily statistics are independent');
select * from finish();
rollback;
