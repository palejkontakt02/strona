-- Fitowa / coach — zabezpieczenia (po schema.sql). Uruchom w Supabase: SQL Editor → New query → wklej → Run.
-- Można uruchomić ponownie. Nie zmienia ani nie usuwa istniejących danych.
--
-- Co robi:
--  1. Klient (podopieczny) nie zmienia rozliczenia, daty ani miejsca treningu — także przez API.
--     Jego nowe treningi są zawsze „bez rozliczenia” (nie zużywają pakietu, nie liczą się klubowi).
--  2. Wiersze muszą mieć poprawny kształt, a kolumny id / client_id muszą zgadzać się z danymi.
--  3. Dostęp klienta do danych tylko po POTWIERDZONYM adresie e-mail.
--  4. Klient nie zmienia wizyt w kalendarzu (tylko trener).
--  5. Miejsca i biblioteka ćwiczeń — tylko trener i powiązani klienci, nie każdy zalogowany.
--  6. Trener może być tylko jeden (nikt inny nie przejmie roli).
--  7. Walidacja check-inu samopoczucia.

-- 1. Pola rozliczeniowe treningu chronione przed klientem ---------------------------------------
create or replace function public.guard_client_session() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if is_trainer() then return new; end if;
  if tg_op = 'INSERT' then
    new.data := (new.data - 'clubRate' - 'paymentId') || jsonb_build_object('charge', 'brak');
  else
    -- poprawki klienta: serie, notatki, odczucia tak; rozliczenie, data, miejsce, podopieczny — bez zmian
    foreach k in array array['charge', 'date', 'locationId', 'clubRate', 'paymentId', 'clientId', 'id'] loop
      if old.data ? k then
        new.data := jsonb_set(new.data, array[k], old.data -> k);
      else
        new.data := new.data - k;
      end if;
    end loop;
    new.id := old.id;
    new.client_id := old.client_id;
  end if;
  return new;
end $$;

drop trigger if exists guard_client_session on public.sessions;
create trigger guard_client_session before insert or update on public.sessions
  for each row execute function public.guard_client_session();

-- 2. Kształt danych (NOT VALID: sprawdza nowe zapisy, stare wiersze zostają bez zmian) ------------
alter table public.sessions drop constraint if exists sessions_shape;
alter table public.sessions add constraint sessions_shape check (
  jsonb_typeof(data) = 'object'
  and data ->> 'id' = id
  and data ->> 'clientId' = client_id
  and coalesce(data ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
  and jsonb_typeof(data -> 'exercises') = 'array'
  and data ->> 'charge' in ('pakiet', 'pojedyncza', 'abonament', 'klub', 'brak')
) not valid;

alter table public.appointments drop constraint if exists appointments_shape;
alter table public.appointments add constraint appointments_shape check (
  jsonb_typeof(data) = 'object'
  and data ->> 'id' = id
  and data ->> 'clientId' = client_id
  and coalesce(data ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
  and jsonb_typeof(data -> 'time') = 'string'
) not valid;

alter table public.plans drop constraint if exists plans_shape;
alter table public.plans add constraint plans_shape check (
  jsonb_typeof(data) = 'object' and data ->> 'id' = id and data ->> 'clientId' = client_id and jsonb_typeof(data -> 'weeks') = 'array'
) not valid;

alter table public.clients drop constraint if exists clients_shape;
alter table public.clients add constraint clients_shape check (
  jsonb_typeof(data) = 'object' and data ->> 'id' = id and jsonb_typeof(data -> 'name') = 'string'
) not valid;

alter table public.library drop constraint if exists library_shape;
alter table public.library add constraint library_shape check (jsonb_typeof(data) = 'object' and data ->> 'id' = id) not valid;
alter table public.locations drop constraint if exists locations_shape;
alter table public.locations add constraint locations_shape check (jsonb_typeof(data) = 'object' and data ->> 'id' = id) not valid;

-- 3. Klient = potwierdzony e-mail z konta, nie sam tekst w tokenie --------------------------------
create or replace function public.my_client_ids() returns setof text
language sql stable security definer set search_path = public as $$
  select c.id from clients c
  join auth.users u on u.id = auth.uid()
  where u.email_confirmed_at is not null
    and c.email is not null
    and lower(c.email) = lower(u.email);
$$;

-- 4. Wizyty zmienia tylko trener ------------------------------------------------------------------
drop policy if exists client_update on public.appointments;

-- 5. Miejsca i biblioteka: trener (reguła trainer_all) albo powiązany klient ----------------------
drop policy if exists client_read on public.library;
create policy client_read on public.library for select to authenticated
  using (exists (select 1 from public.my_client_ids()));
drop policy if exists client_read on public.locations;
create policy client_read on public.locations for select to authenticated
  using (exists (select 1 from public.my_client_ids()));

-- 6. Jeden trener --------------------------------------------------------------------------------
create unique index if not exists trainers_single on public.trainers ((true));

create or replace function public.claim_trainer() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  lock table trainers in exclusive mode;
  if exists (select 1 from trainers) then
    return exists (select 1 from trainers where user_id = auth.uid());
  end if;
  insert into trainers (user_id) values (auth.uid());
  return true;
end $$;

-- 7. Check-in: tylko data + oceny 1–5 -------------------------------------------------------------
create or replace function public.save_checkin(p_client_id text, p_checkin jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  k text;
  clean jsonb;
begin
  perform set_config('fitowa.rpc', '1', true); -- zapis przez funkcję podopiecznego (patrz guard_client_owned)
  if not (is_trainer() or p_client_id in (select my_client_ids())) then
    raise exception 'Brak dostępu';
  end if;
  if jsonb_typeof(p_checkin) is distinct from 'object' or coalesce(p_checkin ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Nieprawidłowy check-in';
  end if;
  clean := jsonb_build_object('date', p_checkin ->> 'date');
  foreach k in array array['sleep', 'energy', 'muscle', 'stress', 'mood'] loop
    if jsonb_typeof(p_checkin -> k) = 'number' and (p_checkin ->> k)::numeric between 1 and 5 then
      clean := clean || jsonb_build_object(k, (p_checkin ->> k)::numeric);
    end if;
  end loop;
  update clients
  set data = jsonb_set(
        data, '{checkins}',
        coalesce((select jsonb_agg(c) from jsonb_array_elements(coalesce(data -> 'checkins', '[]'::jsonb)) c
                  where (c ->> 'date') is distinct from (clean ->> 'date')), '[]'::jsonb) || jsonb_build_array(clean)),
      updated_at = now()
  where id = p_client_id;
end $$;

revoke all on function public.guard_client_session, public.my_client_ids, public.claim_trainer, public.save_checkin from public, anon;
grant execute on function public.my_client_ids, public.claim_trainer, public.save_checkin to authenticated;
notify pgrst, 'reload schema';

-- 8. Podopieczny może oznaczyć jako niewykonany (usunąć) tylko swój trening bez rozliczenia
drop policy if exists client_delete on public.sessions;
create policy client_delete on public.sessions for delete to authenticated
  using (client_id in (select public.my_client_ids()) and data ->> 'charge' = 'brak');

-- 9. Trener widzi konta w aplikacji (e-mail, potwierdzenie, ostatnie logowanie) — tylko trener
create or replace function public.trainer_accounts()
returns table (email text, confirmed boolean, created_at timestamptz, last_sign_in_at timestamptz, is_trainer boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_trainer() then raise exception 'Brak dostępu'; end if;
  return query
    select lower(u.email)::text, u.email_confirmed_at is not null, u.created_at, u.last_sign_in_at,
           exists (select 1 from trainers t where t.user_id = u.id)
    from auth.users u
    order by u.created_at desc;
end $$;
revoke all on function public.trainer_accounts from public, anon;
grant execute on function public.trainer_accounts to authenticated;
notify pgrst, 'reload schema';

-- 10. Zadania dzienne (odhaczenia) i notatki od podopiecznego — zapis tylko przez te funkcje
create or replace function public.save_habit_day(p_client_id text, p_date text, p_done jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare clean jsonb;
begin
  perform set_config('fitowa.rpc', '1', true); -- zapis przez funkcję podopiecznego (patrz guard_client_owned)
  if not (is_trainer() or p_client_id in (select my_client_ids())) then raise exception 'Brak dostępu'; end if;
  if coalesce(p_date, '') !~ '^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(p_done) is distinct from 'array' or jsonb_array_length(p_done) > 50 then
    raise exception 'Nieprawidłowe dane';
  end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into clean from jsonb_array_elements(p_done) x where jsonb_typeof(x) = 'string' and length(x #>> '{}') <= 64;
  update clients
  set data = jsonb_set(data, '{habitLog}',
        coalesce((select jsonb_agg(d order by d ->> 'date') from (
          select d from jsonb_array_elements(coalesce(data -> 'habitLog', '[]'::jsonb)) d where d ->> 'date' is distinct from p_date
          order by d ->> 'date' desc limit 399) t), '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('date', p_date, 'done', clean))),
      updated_at = now()
  where id = p_client_id;
end $$;

create or replace function public.add_client_note(p_client_id text, p_note jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare txt text := left(coalesce(p_note ->> 'text', ''), 2000);
begin
  perform set_config('fitowa.rpc', '1', true); -- zapis przez funkcję podopiecznego (patrz guard_client_owned)
  if not (is_trainer() or p_client_id in (select my_client_ids())) then raise exception 'Brak dostępu'; end if;
  if length(trim(txt)) = 0 then raise exception 'Pusta notatka'; end if;
  update clients
  set data = jsonb_set(data, '{inbox}',
        coalesce((select jsonb_agg(n) from (select n from jsonb_array_elements(coalesce(data -> 'inbox', '[]'::jsonb)) n offset greatest(0, jsonb_array_length(coalesce(data -> 'inbox', '[]'::jsonb)) - 199)) t), '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('id', left(coalesce(p_note ->> 'id', md5(random()::text)), 40), 'at', now(), 'text', txt))),
      updated_at = now()
  where id = p_client_id;
end $$;

revoke all on function public.save_habit_day, public.add_client_note from public, anon;
grant execute on function public.save_habit_day, public.add_client_note to authenticated;
notify pgrst, 'reload schema';

-- 11. Zapis profilu przez trenera nie nadpisuje danych zapisywanych przez podopiecznego
--     (odhaczenia zadań, check-iny, wiadomości) — trener może tylko oznaczać wiadomości jako przeczytane.
create or replace function public.guard_client_owned() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('fitowa.rpc', true), '') = '1' then return new; end if;
  new.data := new.data || jsonb_build_object(
    'habitLog', coalesce(old.data -> 'habitLog', '[]'::jsonb),
    'checkins', coalesce(old.data -> 'checkins', '[]'::jsonb),
    'inbox', coalesce((
      select jsonb_agg(o || case when exists (
          select 1 from jsonb_array_elements(coalesce(new.data -> 'inbox', '[]'::jsonb)) n
          where n ->> 'id' = o ->> 'id' and (n ->> 'read')::boolean is true) then '{"read": true}'::jsonb else '{}'::jsonb end)
      from jsonb_array_elements(coalesce(old.data -> 'inbox', '[]'::jsonb)) o), '[]'::jsonb));
  return new;
end $$;

drop trigger if exists guard_client_owned on public.clients;
create trigger guard_client_owned before update on public.clients
  for each row execute function public.guard_client_owned();
notify pgrst, 'reload schema';

-- 12. Nagrania serii (wideo techniki) — prywatny koszyk Storage „set-videos”.
--     Folder = id podopiecznego; trener widzi i usuwa wszystko, podopieczny tylko swój folder.
--     Limit 50 MB na plik (darmowy plan; w płatnym można podnieść file_size_limit).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('set-videos', 'set-videos', false, 52428800, array['video/*'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists set_videos_trainer on storage.objects;
create policy set_videos_trainer on storage.objects for all to authenticated
  using (bucket_id = 'set-videos' and public.is_trainer())
  with check (bucket_id = 'set-videos' and public.is_trainer());

drop policy if exists set_videos_client_read on storage.objects;
create policy set_videos_client_read on storage.objects for select to authenticated
  using (bucket_id = 'set-videos' and (storage.foldername(name))[1] in (select public.my_client_ids()));

drop policy if exists set_videos_client_insert on storage.objects;
create policy set_videos_client_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'set-videos' and (storage.foldername(name))[1] in (select public.my_client_ids()));

drop policy if exists set_videos_client_delete on storage.objects;
create policy set_videos_client_delete on storage.objects for delete to authenticated
  using (bucket_id = 'set-videos' and (storage.foldername(name))[1] in (select public.my_client_ids()));

-- 13. Przegląd treningów przez trenera i wiadomości powiązane z treningiem.
--     Podopieczny nie ustawia ani nie zmienia „obejrzane” (reviewedAt) i komentarza trenera (coachNote);
--     notatka z podsumowania treningu trafia do wiadomości z odnośnikiem do treningu (sessionId).
create or replace function public.guard_client_session() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if is_trainer() then return new; end if;
  if tg_op = 'INSERT' then
    new.data := (new.data - 'clubRate' - 'paymentId' - 'reviewedAt' - 'coachNote') || jsonb_build_object('charge', 'brak');
  else
    -- poprawki klienta: serie, notatki, odczucia tak; rozliczenie, data, miejsce, podopieczny, ocena trenera — bez zmian
    foreach k in array array['charge', 'date', 'locationId', 'clubRate', 'paymentId', 'clientId', 'id', 'reviewedAt', 'coachNote'] loop
      if old.data ? k then
        new.data := jsonb_set(new.data, array[k], old.data -> k);
      else
        new.data := new.data - k;
      end if;
    end loop;
    new.id := old.id;
    new.client_id := old.client_id;
  end if;
  return new;
end $$;

create or replace function public.add_client_note(p_client_id text, p_note jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare txt text := left(coalesce(p_note ->> 'text', ''), 2000);
begin
  perform set_config('fitowa.rpc', '1', true); -- zapis przez funkcję podopiecznego (patrz guard_client_owned)
  if not (is_trainer() or p_client_id in (select my_client_ids())) then raise exception 'Brak dostępu'; end if;
  if length(trim(txt)) = 0 then raise exception 'Pusta notatka'; end if;
  update clients
  set data = jsonb_set(data, '{inbox}',
        coalesce((select jsonb_agg(n) from (select n from jsonb_array_elements(coalesce(data -> 'inbox', '[]'::jsonb)) n offset greatest(0, jsonb_array_length(coalesce(data -> 'inbox', '[]'::jsonb)) - 199)) t), '[]'::jsonb)
        || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
             'id', left(coalesce(p_note ->> 'id', md5(random()::text)), 40), 'at', now(), 'text', txt,
             'sessionId', left(p_note ->> 'sessionId', 40))))),
      updated_at = now()
  where id = p_client_id;
end $$;
notify pgrst, 'reload schema';

-- 14. Trener może ukryć wiadomość podopiecznego (np. wysłaną przez pomyłkę) — oprócz „przeczytane”
--     przenoszona jest flaga „hidden”; treści wiadomości trener nadal nie zmieni ani nie podmieni.
create or replace function public.guard_client_owned() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('fitowa.rpc', true), '') = '1' then return new; end if;
  new.data := new.data || jsonb_build_object(
    'habitLog', coalesce(old.data -> 'habitLog', '[]'::jsonb),
    'checkins', coalesce(old.data -> 'checkins', '[]'::jsonb),
    'inbox', coalesce((
      select jsonb_agg(o
        || case when exists (select 1 from jsonb_array_elements(coalesce(new.data -> 'inbox', '[]'::jsonb)) n
                             where n ->> 'id' = o ->> 'id' and (n ->> 'read')::boolean is true) then '{"read": true}'::jsonb else '{}'::jsonb end
        || case when exists (select 1 from jsonb_array_elements(coalesce(new.data -> 'inbox', '[]'::jsonb)) n
                             where n ->> 'id' = o ->> 'id' and (n ->> 'hidden')::boolean is true) then '{"hidden": true}'::jsonb else '{}'::jsonb end)
      from jsonb_array_elements(coalesce(old.data -> 'inbox', '[]'::jsonb)) o), '[]'::jsonb));
  return new;
end $$;
notify pgrst, 'reload schema';

-- 15. Dane tylko dla trenera: wywiad zdrowotny (PAR-Q, leki, zgoda lekarza, przeciwwskazania),
--     prywatne notatki i notatki z wizyt. Osobna tabela — podopieczny nie ma do niej żadnego dostępu.
create table if not exists public.trainer_notes (
  id text primary key,
  client_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.trainer_notes enable row level security;
drop policy if exists trainer_all on public.trainer_notes;
create policy trainer_all on public.trainer_notes for all to authenticated
  using (public.is_trainer()) with check (public.is_trainer());
alter table public.trainer_notes drop constraint if exists trainer_notes_shape;
alter table public.trainer_notes add constraint trainer_notes_shape check (
  jsonb_typeof(data) = 'object' and data ->> 'id' = id and data ->> 'clientId' = client_id
);
revoke all on public.trainer_notes from anon;
grant select, insert, update, delete on public.trainer_notes to authenticated;
notify pgrst, 'reload schema';
