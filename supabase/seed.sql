-- Synthetic fixture only. Never seed the owner's SQLite export here.
insert into public.sources(id,source_key,name,version,license,url,updated_at)
values(1,'pilot-test','Synthetic pilot','1','CC0','https://example.com',now());
insert into public.entries(id,source_id,source_key,turkish,russian,part_of_speech,category,created_at,updated_at)
values (1,1,'hello','merhaba','привет','междометие','Пилот',now(),now()),
       (2,1,'apple','elma','яблоко','существительное','Пилот',now(),now());
insert into public.cards(id,entry_id,direction) values(1,1,'tr-ru'),(2,1,'ru-tr'),(3,2,'tr-ru'),(4,2,'ru-tr');
select setval(pg_get_serial_sequence('public.sources','id'),(select max(id) from public.sources));
select setval(pg_get_serial_sequence('public.entries','id'),(select max(id) from public.entries));
select setval(pg_get_serial_sequence('public.cards','id'),(select max(id) from public.cards));
