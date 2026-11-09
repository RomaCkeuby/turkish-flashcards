create function private.entry_json(e public.effective_entries) returns jsonb language sql immutable set search_path = '' as $$
 select jsonb_build_object('id',e.id,'turkish',e.turkish,'russian',e.russian,'partOfSpeech',e.part_of_speech,
  'category',e.category,'status',e.status,'createdAt',e.created_at,'updatedAt',e.updated_at,'tags',e.tags,
  'exampleTurkish',e.example_turkish,'exampleRussian',e.example_russian,'exampleSource',e.example_source,
  'exampleSourceLicense',e.example_source_license,'exampleSourceUrl',e.example_source_url,
  'exampleTranslationSourceUrl',e.example_translation_source_url,
  'sourceName',e.source_name,'sourceLicense',e.source_license,'sourceUrl',e.source_url)
$$;
create function private.matches(e public.effective_entries, f jsonb) returns boolean language sql immutable set search_path = '' as $$
 select (coalesce(f->>'category','')='' or e.category=f->>'category')
  and (coalesce(f->>'partOfSpeech','')='' or e.part_of_speech=f->>'partOfSpeech')
  and (coalesce(f->>'tag','')='' or (f->>'tag')=any(e.tags))
$$;
create function private.queue_stats(u uuid, d text, f jsonb, at_time timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
declare tz text; day_start timestamptz; day_end timestamptz; due_count integer; new_count integer;
  first_count integer; reviewed_count integer; correct_count integer;
begin
 select coalesce(p.time_zone,'Europe/Moscow') into tz from public.profiles p where p.user_id=u;
 tz := coalesce(tz,'Europe/Moscow');
 day_start := date_trunc('day',at_time at time zone tz) at time zone tz;
 day_end := (date_trunc('day',at_time at time zone tz)+interval '1 day') at time zone tz;
 select count(*) filter(where s.card_id is not null and s.due_at<=at_time),count(*) filter(where s.card_id is null)
 into due_count,new_count from public.cards c join public.effective_entries e on e.id=c.entry_id
 left join public.review_state s on s.card_id=c.id and s.user_id=u
 where c.enabled=1 and e.active=1 and e.status='ACTIVE' and e.removal_kind is null
 and (d is null or c.direction=d) and private.matches(e,f);
 select count(*) into first_count from public.review_state where user_id=u and first_reviewed_at>=day_start and first_reviewed_at<day_end;
 select count(*),count(*) filter(where rating='good') into reviewed_count,correct_count
 from public.review_log where user_id=u and reviewed_at>=day_start and reviewed_at<day_end;
 return jsonb_build_object('due',due_count,'newTotal',new_count,'newAvailable',new_count,'newUsedToday',first_count,
  'reviewedToday',reviewed_count,'correctToday',correct_count,'isDoneToday',due_count=0 and new_count=0,
  'accuracyToday',case when reviewed_count=0 then null else round(correct_count*100.0/reviewed_count) end);
end $$;

create function public.cloud_stats() returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.require_user(); at_time timestamptz:=statement_timestamp(); result jsonb;
begin
 select jsonb_build_object('entries',(select count(*) from public.effective_entries where active=1 and status='ACTIVE' and removal_kind is null),
 'cards',(select count(*) from public.cards c join public.effective_entries e on e.id=c.entry_id where c.enabled=1 and e.removal_kind is null),
 'reviewed',(select count(*) from public.review_state where user_id=u),
 'queue',private.queue_stats(u,null,'{}',at_time),
 'directions',jsonb_build_object('tr-ru',private.queue_stats(u,'tr-ru','{}',at_time),'ru-tr',private.queue_stats(u,'ru-tr','{}',at_time))) into result;
 return result;
end $$;

create function public.cloud_entries(p_search text default '',p_filters jsonb default '{}',p_limit integer default 50,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.require_user(); result jsonb;
begin
 p_search:=btrim(coalesce(p_search,''));
 if length(p_search)>200 or p_limit not between 1 and 100 or p_offset<0 then raise exception 'Invalid pagination'; end if;
 with matching as (select e.* from public.effective_entries e where e.removal_kind is null and e.active=1
 and (coalesce(p_filters->>'status','')='' or e.status=p_filters->>'status')
 and (coalesce(p_filters->>'category','')='' or e.category=p_filters->>'category')
 and (coalesce(p_filters->>'partOfSpeech','')='' or e.part_of_speech=p_filters->>'partOfSpeech')
 and (coalesce(p_filters->>'tag','')='' or (p_filters->>'tag')=any(e.tags))
 and (p_search='' or strpos(lower(translate(e.turkish,'Iİ','ıi')),lower(translate(p_search,'Iİ','ıi')))>0 or strpos(lower(e.russian),lower(p_search))>0))
 select jsonb_build_object('total',(select count(*) from matching),
 'entries',coalesce((select jsonb_agg(private.entry_json(m)) from
  (select * from matching order by turkish,id limit p_limit offset p_offset) m), '[]')) into result;
 return result;
end $$;
create function public.cloud_filters() returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.require_user(); result jsonb;
begin
 with eligible as (select * from public.effective_entries where active=1 and removal_kind is null)
 select jsonb_build_object('categories',coalesce((select jsonb_agg(category order by category) from (select distinct category from eligible where category<>'' and category<>'Глаголы') x),'[]'),
 'partsOfSpeech',coalesce((select jsonb_agg(part_of_speech order by part_of_speech) from (select distinct part_of_speech from eligible where part_of_speech<>'') x),'[]'),
 'tags',coalesce((select jsonb_agg(tag order by tag) from (select distinct unnest(tags) tag from eligible) x),'[]')) into result;
 return result;
end $$;
create function public.cloud_next_card(p_direction text,p_filters jsonb default '{}',p_mode text default 'all',p_card_id bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.require_user(); at_time timestamptz:=statement_timestamp(); card jsonb;
begin
 if p_direction is null or p_mode is null or p_direction not in ('tr-ru','ru-tr') or p_mode not in ('all','new','review') then raise exception 'Invalid study options'; end if;
 select private.entry_json(e)||jsonb_build_object('id',c.id,'entryId',e.id,'direction',c.direction) into card
 from public.cards c join public.effective_entries e on e.id=c.entry_id
 left join public.review_state s on s.user_id=u and s.card_id=c.id
 where c.enabled=1 and e.active=1 and e.status='ACTIVE' and e.removal_kind is null and c.direction=p_direction
 and private.matches(e,p_filters) and (s.card_id is null or s.due_at<=at_time)
 and (p_mode<>'new' or s.card_id is null) and (p_mode<>'review' or s.card_id is not null)
 order by (c.id=p_card_id) desc nulls last,(s.card_id is not null) desc,s.due_at,random() limit 1;
 return jsonb_build_object('card',card,'queue',private.queue_stats(u,p_direction,p_filters,at_time));
end $$;

create function public.cloud_review(p_card_id bigint,p_result text,p_request_id uuid,p_expected_user_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.require_user(); old public.review_state; next_state public.review_state;
 receipt private.review_requests; response jsonb; token uuid:=gen_random_uuid(); log_id bigint;
 at_time timestamptz; days double precision; ease double precision; reps integer; lapse_count integer;
begin
 if p_expected_user_id is not null and p_expected_user_id<>u then raise exception 'Account changed' using errcode='42501'; end if;
 if p_card_id is null or p_request_id is null or p_result is null or p_result not in ('correct','incorrect') then raise exception 'Invalid review'; end if;
 -- Per-user lock also serializes the first ever review, before a progress row exists.
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into receipt from private.review_requests where user_id=u and request_id=p_request_id;
 if found then
   if receipt.card_id<>p_card_id or receipt.result<>p_result then raise exception 'Request ID reused with different input' using errcode='22023'; end if;
   return receipt.response;
 end if;
 if not exists(select 1 from public.cards c join public.effective_entries e on e.id=c.entry_id
   where c.id=p_card_id and c.enabled=1 and e.active=1 and e.status='ACTIVE' and e.removal_kind is null) then
   raise exception 'Card unavailable' using errcode='22023';
 end if;
 at_time:=clock_timestamp();
 select * into old from public.review_state where user_id=u and card_id=p_card_id;
 if p_result='correct' then
  reps:=coalesce(old.repetitions,0)+1;
  days:=case when coalesce(old.repetitions,0)=0 then 1 when old.repetitions=1 then 3
    else greatest(1,floor(old.interval_days*old.ease_factor+0.5)) end;
  ease:=least(3,coalesce(old.ease_factor,2.5)+0.05); lapse_count:=coalesce(old.lapses,0);
 else
  reps:=0; days:=5.0/(24*60); ease:=greatest(1.3,coalesce(old.ease_factor,2.5)-0.2); lapse_count:=coalesce(old.lapses,0)+1;
 end if;
 insert into public.review_state values(u,p_card_id,at_time+days*interval '1 day',days,ease,reps,lapse_count,
  coalesce(old.first_reviewed_at,at_time),at_time)
 on conflict(user_id,card_id) do update set due_at=excluded.due_at,interval_days=excluded.interval_days,
  ease_factor=excluded.ease_factor,repetitions=excluded.repetitions,lapses=excluded.lapses,
  first_reviewed_at=excluded.first_reviewed_at,last_reviewed_at=excluded.last_reviewed_at returning * into next_state;
 insert into public.review_log(user_id,card_id,rating,reviewed_at,request_id)
 values(u,p_card_id,case when p_result='correct' then 'good' else 'again' end,at_time,p_request_id) returning id into log_id;
 insert into private.review_undo values(u,token,log_id,case when old.card_id is null then null else to_jsonb(old) end,to_jsonb(next_state))
 on conflict(user_id) do update set token=excluded.token,review_log_id=excluded.review_log_id,
  previous_state=excluded.previous_state,result_state=excluded.result_state;
 response:=jsonb_build_object('cardId',p_card_id,'dueAt',next_state.due_at,'intervalDays',days,'easeFactor',ease,
  'repetitions',reps,'lapses',lapse_count,'result',p_result,'undoToken',token);
 insert into private.review_requests(user_id,request_id,card_id,result,response) values(u,p_request_id,p_card_id,p_result,response);
 return response;
end $$;
create function public.cloud_undo(p_token uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.require_user(); undo private.review_undo; current_state public.review_state; restored public.review_state; card bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select * into undo from private.review_undo where user_id=u and token=p_token;
 if not found then raise exception 'Undo expired or already used' using errcode='22023'; end if;
 card:=(undo.result_state->>'card_id')::bigint;
 select * into current_state from public.review_state where user_id=u and card_id=card;
 if to_jsonb(current_state) is distinct from undo.result_state then raise exception 'Progress changed; undo refused' using errcode='22023'; end if;
 delete from public.review_state where user_id=u and card_id=card;
 if undo.previous_state is not null then
  restored:=jsonb_populate_record(null::public.review_state,undo.previous_state);
  insert into public.review_state select restored.*;
 end if;
 delete from public.review_log where id=undo.review_log_id and user_id=u;
 return jsonb_build_object('cardId',card,'restored',true);
end $$;

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.cloud_stats(), public.cloud_entries(text,jsonb,integer,integer), public.cloud_filters(),
 public.cloud_next_card(text,jsonb,text,bigint),public.cloud_review(bigint,text,uuid,uuid),public.cloud_undo(uuid) from public, anon;
grant execute on function public.cloud_stats(), public.cloud_entries(text,jsonb,integer,integer), public.cloud_filters(),
 public.cloud_next_card(text,jsonb,text,bigint),public.cloud_review(bigint,text,uuid,uuid),public.cloud_undo(uuid) to authenticated;
