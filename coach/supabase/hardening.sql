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
--  …
--  21. Przypomnienie o samopoczuciu o 8:00 (powiadomienia push).

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

-- 16. Pomiary wpisywane przez podopiecznego (waga, obwody) — lista selfMeasurements, zapis przez funkcję.
--     Trener ich nie nadpisze (może tylko ukryć flagą „hidden”), podopieczny nie zmieni niczego innego w profilu.
create or replace function public.add_measurement(p_client_id text, p_meas jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare m jsonb := '{}'::jsonb; k text; v numeric;
begin
  perform set_config('fitowa.rpc', '1', true);
  if not (is_trainer() or p_client_id in (select my_client_ids())) then raise exception 'Brak dostępu'; end if;
  if coalesce(p_meas ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' or (p_meas ->> 'date')::date > current_date + 1 then raise exception 'Zła data'; end if;
  foreach k in array array['weight', 'waist', 'hips', 'chest', 'arm', 'thigh'] loop
    if jsonb_typeof(p_meas -> k) = 'number' then
      v := (p_meas ->> k)::numeric;
      if v <= 0 or v > 400 then raise exception 'Zła wartość: %', k; end if;
      m := m || jsonb_build_object(k, v);
    end if;
  end loop;
  if m = '{}'::jsonb then raise exception 'Pusty pomiar'; end if;
  m := m || jsonb_build_object('id', left(coalesce(p_meas ->> 'id', md5(random()::text)), 40), 'date', p_meas ->> 'date', 'by', 'client')
         || case when length(coalesce(p_meas ->> 'note', '')) > 0 then jsonb_build_object('note', left(p_meas ->> 'note', 300)) else '{}'::jsonb end;
  update clients
  set data = jsonb_set(data, '{selfMeasurements}', coalesce(data -> 'selfMeasurements', '[]'::jsonb) || jsonb_build_array(m)),
      updated_at = now()
  where id = p_client_id;
end $$;
revoke all on function public.add_measurement from public, anon;
grant execute on function public.add_measurement to authenticated;

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
      from jsonb_array_elements(coalesce(old.data -> 'inbox', '[]'::jsonb)) o), '[]'::jsonb),
    'selfMeasurements', coalesce((
      select jsonb_agg(o
        || case when exists (select 1 from jsonb_array_elements(coalesce(new.data -> 'selfMeasurements', '[]'::jsonb)) n
                             where n ->> 'id' = o ->> 'id' and (n ->> 'hidden')::boolean is true) then '{"hidden": true}'::jsonb else '{}'::jsonb end)
      from jsonb_array_elements(coalesce(old.data -> 'selfMeasurements', '[]'::jsonb)) o), '[]'::jsonb));
  return new;
end $$;
notify pgrst, 'reload schema';

-- 17. Ankieta podopiecznego (zdrowie, styl życia, odżywianie, sport, cele) — zapis przez funkcję,
--     tylko przez samego podopiecznego albo trenera; zapis profilu przez trenera jej nie nadpisze.
create or replace function public.save_intake(p_client_id text, p_intake jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('fitowa.rpc', '1', true);
  if not (is_trainer() or p_client_id in (select my_client_ids())) then raise exception 'Brak dostępu'; end if;
  if jsonb_typeof(p_intake) <> 'object' or jsonb_typeof(p_intake -> 'answers') <> 'object' then raise exception 'Zła ankieta'; end if;
  if length(p_intake::text) > 60000 then raise exception 'Ankieta za długa'; end if;
  update clients
  set data = jsonb_set(data, '{intake}', jsonb_build_object(
        'answers', p_intake -> 'answers',
        'consentAt', coalesce(data #> '{intake,consentAt}', p_intake -> 'consentAt'),
        'completedAt', coalesce(data #> '{intake,completedAt}', to_jsonb(now())),
        'updatedAt', to_jsonb(now()))),
      updated_at = now()
  where id = p_client_id;
end $$;
revoke all on function public.save_intake from public, anon;
grant execute on function public.save_intake to authenticated;

create or replace function public.guard_client_intake() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('fitowa.rpc', true), '') = '1' then return new; end if;
  new.data := (new.data - 'intake') || case when old.data ? 'intake' then jsonb_build_object('intake', old.data -> 'intake') else '{}'::jsonb end;
  return new;
end $$;
drop trigger if exists guard_client_intake on public.clients;
create trigger guard_client_intake before update on public.clients
  for each row execute function public.guard_client_intake();
notify pgrst, 'reload schema';

-- 18. Pliki w ankiecie (zdjęcia, wyniki badań, PDF) — prywatny koszyk Storage „client-files”.
--     Folder = id podopiecznego; trener widzi i usuwa wszystko, podopieczny tylko swój folder.
--     Lista plików zapisuje się w ankiecie (save_intake) — tylko odnośniki do własnego folderu.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-files', 'client-files', false, 20971520, array['image/*', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists client_files_trainer on storage.objects;
create policy client_files_trainer on storage.objects for all to authenticated
  using (bucket_id = 'client-files' and public.is_trainer())
  with check (bucket_id = 'client-files' and public.is_trainer());

drop policy if exists client_files_client_read on storage.objects;
create policy client_files_client_read on storage.objects for select to authenticated
  using (bucket_id = 'client-files' and (storage.foldername(name))[1] in (select public.my_client_ids()));

drop policy if exists client_files_client_insert on storage.objects;
create policy client_files_client_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'client-files' and (storage.foldername(name))[1] in (select public.my_client_ids()));

drop policy if exists client_files_client_delete on storage.objects;
create policy client_files_client_delete on storage.objects for delete to authenticated
  using (bucket_id = 'client-files' and (storage.foldername(name))[1] in (select public.my_client_ids()));

create or replace function public.save_intake(p_client_id text, p_intake jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare files jsonb;
begin
  perform set_config('fitowa.rpc', '1', true);
  if not (is_trainer() or p_client_id in (select my_client_ids())) then raise exception 'Brak dostępu'; end if;
  if jsonb_typeof(p_intake) <> 'object' or jsonb_typeof(p_intake -> 'answers') <> 'object' then raise exception 'Zła ankieta'; end if;
  if length(p_intake::text) > 60000 then raise exception 'Ankieta za długa'; end if;
  -- pliki: najwyżej 30, tylko odnośniki do folderu tego podopiecznego (albo plik z przeglądarki „idb:”)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', left(f ->> 'id', 64), 'ref', f ->> 'ref', 'name', left(coalesce(f ->> 'name', 'plik'), 120),
           'type', left(coalesce(f ->> 'type', ''), 60), 'size', case when jsonb_typeof(f -> 'size') = 'number' then f -> 'size' else '0'::jsonb end,
           'at', left(coalesce(f ->> 'at', ''), 40), 'kind', left(coalesce(f ->> 'kind', 'Inne'), 40))), '[]'::jsonb)
    into files
    from (select f from jsonb_array_elements(case when jsonb_typeof(p_intake -> 'files') = 'array' then p_intake -> 'files' else '[]'::jsonb end) f limit 30) t
    where jsonb_typeof(f) = 'object' and ((f ->> 'ref') like 'sb:' || p_client_id || '/%' or (f ->> 'ref') like 'idb:%');
  update clients
  set data = jsonb_set(data, '{intake}', jsonb_build_object(
        'answers', p_intake -> 'answers',
        'files', files,
        'consentAt', coalesce(data #> '{intake,consentAt}', p_intake -> 'consentAt'),
        'completedAt', coalesce(data #> '{intake,completedAt}', to_jsonb(now())),
        'updatedAt', to_jsonb(now()))),
      updated_at = now()
  where id = p_client_id;
end $$;
revoke all on function public.save_intake from public, anon;
grant execute on function public.save_intake to authenticated;
notify pgrst, 'reload schema';

-- 19. Wpisy podopiecznego: raport tygodniowy (weeklyReports), zdjęcia sylwetki (progressPhotos),
--     makro i kroki dzień po dniu (dayLog) — zapis tylko przez tę funkcję, przez samego podopiecznego albo trenera.
--     Podopieczny nie ustawia „przeczytane” (seenAt) ani komentarza trenera (coachNote) w raporcie, ani „ukryte” (hidden)
--     przy zdjęciu. Zapis profilu przez trenera nie nadpisuje tych list — trener może tylko oznaczyć raport jako
--     przeczytany, dopisać komentarz i ukryć zdjęcie. Najwyżej 400 ostatnich wpisów każdego rodzaju.
create or replace function public.save_client_entry(p_client_id text, p_kind text, p_entry jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  trainer boolean := is_trainer();
  e jsonb;
  old_e jsonb;
  key text;
  keyval text;
  k text;
  v numeric;
  lo numeric;
  hi numeric;
begin
  perform set_config('fitowa.rpc', '1', true); -- zapis przez funkcję podopiecznego (patrz guard_client_owned)
  if not (trainer or p_client_id in (select my_client_ids())) then raise exception 'Brak dostępu'; end if;
  if jsonb_typeof(p_entry) is distinct from 'object' then raise exception 'Nieprawidłowy wpis'; end if;
  key := case p_kind when 'dayLog' then 'date' when 'weeklyReports' then 'id' when 'progressPhotos' then 'id' end;
  if key is null then raise exception 'Nieznany rodzaj wpisu: %', p_kind; end if;
  keyval := p_entry ->> key;
  if key = 'id' and (coalesce(keyval, '') = '' or length(keyval) > 64) then raise exception 'Brak id wpisu'; end if;
  -- dotychczasowy wpis o tym samym kluczu (poprawka) — zostają z niego pola trenera
  select x into old_e from clients c,
    jsonb_array_elements(case when jsonb_typeof(c.data -> p_kind) = 'array' then c.data -> p_kind else '[]'::jsonb end) x
  where c.id = p_client_id and x ->> key = keyval limit 1;

  if p_kind = 'weeklyReports' then
    if coalesce(p_entry ->> 'week', '') !~ '^\d{4}-\d{2}-\d{2}$' or (p_entry ->> 'week')::date > current_date + 7
       or (p_entry ->> 'week')::date < date '2000-01-01' then raise exception 'Zły tydzień'; end if;
    e := jsonb_build_object('id', keyval, 'week', p_entry ->> 'week', 'at', coalesce(old_e -> 'at', to_jsonb(now())));
    foreach k in array array['sleep', 'stress', 'energy', 'adherence', 'weight', 'steps'] loop
      if p_entry ? k and jsonb_typeof(p_entry -> k) <> 'null' then
        if jsonb_typeof(p_entry -> k) <> 'number' then raise exception 'Zła wartość: %', k; end if;
        v := (p_entry ->> k)::numeric;
        lo := case k when 'weight' then 20 when 'steps' then 0 else 1 end;
        hi := case k when 'weight' then 400 when 'steps' then 100000 else 5 end;
        if v < lo or v > hi then raise exception 'Zła wartość: %', k; end if;
        e := e || jsonb_build_object(k, v);
      end if;
    end loop;
    if length(coalesce(p_entry ->> 'comment', '')) > 2000 then raise exception 'Komentarz za długi (najwyżej 2000 znaków)'; end if;
    if length(trim(coalesce(p_entry ->> 'comment', ''))) > 0 then e := e || jsonb_build_object('comment', p_entry ->> 'comment'); end if;
    if jsonb_typeof(p_entry -> 'photoIds') = 'array' then
      if jsonb_array_length(p_entry -> 'photoIds') > 3 then raise exception 'Najwyżej 3 zdjęcia w raporcie'; end if;
      e := e || jsonb_build_object('photoIds', coalesce((select jsonb_agg(left(x #>> '{}', 64)) from jsonb_array_elements(p_entry -> 'photoIds') x
                                                         where jsonb_typeof(x) = 'string'), '[]'::jsonb));
    end if;
    -- pola trenera: trener ustawia je sam, podopieczny ich nie zmienia (zostają z poprzedniej wersji raportu)
    e := e || jsonb_strip_nulls(jsonb_build_object(
      'seenAt', case when trainer then left(p_entry ->> 'seenAt', 40) else old_e ->> 'seenAt' end,
      'coachNote', case when trainer then left(p_entry ->> 'coachNote', 2000) else old_e ->> 'coachNote' end));

  elsif p_kind = 'progressPhotos' then
    if coalesce(p_entry ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' or (p_entry ->> 'date')::date > current_date + 1 then raise exception 'Zła data'; end if;
    -- tylko plik z folderu tego podopiecznego w magazynie albo z pamięci przeglądarki
    if length(coalesce(p_entry ->> 'ref', '')) > 300
       or not ((p_entry ->> 'ref') like 'sb:' || p_client_id || '/%' or (p_entry ->> 'ref') like 'idb:%')
       or (p_entry ->> 'ref') like '%..%' then raise exception 'Zły plik zdjęcia'; end if;
    if coalesce(p_entry ->> 'pose', '') not in ('przód', 'bok', 'tył', 'inne') then raise exception 'Zła poza'; end if;
    e := jsonb_build_object('id', keyval, 'date', p_entry ->> 'date', 'ref', p_entry ->> 'ref', 'pose', p_entry ->> 'pose',
                            'at', coalesce(old_e -> 'at', to_jsonb(now())));
    if (case when trainer then (p_entry ->> 'hidden') else (old_e ->> 'hidden') end) = 'true' then
      e := e || '{"hidden": true}'::jsonb;
    end if;

  else -- dayLog: jeden wpis na dzień
    if coalesce(keyval, '') !~ '^\d{4}-\d{2}-\d{2}$' or keyval::date > current_date + 1 then raise exception 'Zła data'; end if;
    e := jsonb_build_object('date', keyval);
    foreach k in array array['protein', 'kcal', 'steps', 'water'] loop
      if p_entry ? k and jsonb_typeof(p_entry -> k) <> 'null' then
        if jsonb_typeof(p_entry -> k) <> 'number' then raise exception 'Zła wartość: %', k; end if;
        v := (p_entry ->> k)::numeric;
        hi := case k when 'protein' then 500 when 'kcal' then 10000 when 'steps' then 100000 else 15 end;
        if v < 0 or v > hi then raise exception 'Zła wartość: %', k; end if;
        e := e || jsonb_build_object(k, v);
      end if;
    end loop;
  end if;

  update clients
  set data = jsonb_set(data, array[p_kind],
        coalesce((select jsonb_agg(x order by ord) from (
          select x, ord from jsonb_array_elements(case when jsonb_typeof(data -> p_kind) = 'array' then data -> p_kind else '[]'::jsonb end)
            with ordinality t(x, ord)
          where x ->> key is distinct from keyval
          order by ord desc limit 399) s), '[]'::jsonb)
        || jsonb_build_array(e)),
      updated_at = now()
  where id = p_client_id;
end $$;
revoke all on function public.save_client_entry from public, anon;
grant execute on function public.save_client_entry to authenticated;

-- Strażnik profilu (wersja z sekcji 16 + wpisy podopiecznego z tej sekcji).
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
      from jsonb_array_elements(coalesce(old.data -> 'inbox', '[]'::jsonb)) o), '[]'::jsonb),
    'selfMeasurements', coalesce((
      select jsonb_agg(o
        || case when exists (select 1 from jsonb_array_elements(coalesce(new.data -> 'selfMeasurements', '[]'::jsonb)) n
                             where n ->> 'id' = o ->> 'id' and (n ->> 'hidden')::boolean is true) then '{"hidden": true}'::jsonb else '{}'::jsonb end)
      from jsonb_array_elements(coalesce(old.data -> 'selfMeasurements', '[]'::jsonb)) o), '[]'::jsonb),
    -- raporty: treść od podopiecznego; „przeczytane” i komentarz — z zapisu trenera (gdy ma ten raport u siebie)
    'weeklyReports', coalesce((
      select jsonb_agg(case when n is null then o
                            else (o - 'seenAt' - 'coachNote') || jsonb_strip_nulls(jsonb_build_object(
                                   'seenAt', left(n ->> 'seenAt', 40), 'coachNote', left(n ->> 'coachNote', 2000))) end order by ord)
      from jsonb_array_elements(case when jsonb_typeof(old.data -> 'weeklyReports') = 'array' then old.data -> 'weeklyReports' else '[]'::jsonb end)
             with ordinality t(o, ord)
      left join lateral (select n from jsonb_array_elements(case when jsonb_typeof(new.data -> 'weeklyReports') = 'array' then new.data -> 'weeklyReports' else '[]'::jsonb end) n
                         where n ->> 'id' = o ->> 'id' limit 1) m on true), '[]'::jsonb),
    -- zdjęcia: trener może tylko ukryć / odkryć
    'progressPhotos', coalesce((
      select jsonb_agg(case when n is null then o
                            else (o - 'hidden') || case when (n ->> 'hidden') = 'true' then '{"hidden": true}'::jsonb else '{}'::jsonb end end order by ord)
      from jsonb_array_elements(case when jsonb_typeof(old.data -> 'progressPhotos') = 'array' then old.data -> 'progressPhotos' else '[]'::jsonb end)
             with ordinality t(o, ord)
      left join lateral (select n from jsonb_array_elements(case when jsonb_typeof(new.data -> 'progressPhotos') = 'array' then new.data -> 'progressPhotos' else '[]'::jsonb end) n
                         where n ->> 'id' = o ->> 'id' limit 1) m on true), '[]'::jsonb),
    'dayLog', coalesce(old.data -> 'dayLog', '[]'::jsonb));
  return new;
end $$;
notify pgrst, 'reload schema';

-- 20. Powiadomienia push na telefon (Web Push) — instrukcja krok po kroku: supabase/PUSH.md.
--     WYMAGA rozszerzeń pg_net (wysyłka z bazy) i — dla porannych przypomnień — pg_cron:
--     Supabase → Database → Extensions → włącz „pg_net” i „pg_cron”, potem uruchom tę sekcję (ponownie można).
--     Bez rozszerzeń sekcja też się wykona: zapis danych działa normalnie, tylko powiadomienia nie wychodzą.
--     Telefon zapisuje swoją subskrypcję (push_subscriptions); zdarzenia w danych wywołują funkcję Edge „send-push”,
--     która wysyła powiadomienie. Powiadomienie nigdy nie blokuje ani nie cofa zapisu.
create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique,
  keys jsonb not null,
  role text not null check (role in ('trainer', 'client')),
  client_id text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_client_idx on public.push_subscriptions (client_id);
alter table public.push_subscriptions enable row level security;
-- każdy widzi i usuwa tylko subskrypcje swoich urządzeń; dodanie — przez funkcję save_push_subscription
drop policy if exists own_read on public.push_subscriptions;
create policy own_read on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists own_delete on public.push_subscriptions;
create policy own_delete on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;

-- Ustawienia wysyłki: adres funkcji Edge i wspólny sekret (baza → funkcja). Nikt z aplikacji ich nie czyta.
-- Sekret do wklejenia w Edge Functions → Secrets (PUSH_HOOK_SECRET): select value from public.push_config where key = 'secret';
create table if not exists public.push_config (key text primary key, value text not null);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;
insert into public.push_config (key, value) values
  ('url', 'https://pmsspumbjsapjqkvjscz.supabase.co/functions/v1/send-push'),
  ('secret', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;
-- ostatnio wysłane (bez dubli, np. seria 8 wizyt = jedno powiadomienie)
create table if not exists public.push_log (key text primary key, at timestamptz not null default now());
alter table public.push_log enable row level security;
revoke all on public.push_log from anon, authenticated;

-- Telefon włącza powiadomienia: zapis (albo przepisanie na to konto) subskrypcji tego urządzenia.
create or replace function public.save_push_subscription(p_endpoint text, p_keys jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare r text; cid text;
begin
  if auth.uid() is null then raise exception 'Brak dostępu'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000
     or jsonb_typeof(p_keys -> 'p256dh') <> 'string' or jsonb_typeof(p_keys -> 'auth') <> 'string'
     or length(p_keys ->> 'p256dh') > 200 or length(p_keys ->> 'auth') > 100 then raise exception 'Zła subskrypcja'; end if;
  if is_trainer() then r := 'trainer';
  else
    select id into cid from my_client_ids() id limit 1;
    if cid is null then raise exception 'Brak dostępu'; end if;
    r := 'client';
  end if;
  insert into push_subscriptions (user_id, endpoint, keys, role, client_id)
  values (auth.uid(), p_endpoint, jsonb_build_object('p256dh', p_keys ->> 'p256dh', 'auth', p_keys ->> 'auth'), r, cid)
  on conflict (endpoint) do update set user_id = excluded.user_id, keys = excluded.keys, role = excluded.role, client_id = excluded.client_id;
  return r;
end $$;
revoke all on function public.save_push_subscription from public, anon;
grant execute on function public.save_push_subscription to authenticated;

-- Funkcja Edge zgłasza wygasłe subskrypcje (telefon wyłączył powiadomienia / odinstalował aplikację).
create or replace function public.push_gone(p_secret text, p_endpoints text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or p_secret is distinct from (select value from push_config where key = 'secret') then raise exception 'Brak dostępu'; end if;
  delete from push_subscriptions where endpoint = any (p_endpoints);
end $$;
revoke all on function public.push_gone from public;
grant execute on function public.push_gone to anon, authenticated;

-- Wysyłka: do trenera (p_role = 'trainer') albo do podopiecznego (p_role = 'client', p_client_id).
-- p_once: ten sam klucz w ciągu 3 minut = bez powtórnego powiadomienia.
create or replace function public.push_send(p_role text, p_client_id text, p_title text, p_body text, p_url text, p_tag text, p_once text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare subs jsonb; cfg_url text; cfg_secret text;
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'net' and p.proname = 'http_post') then
    return; -- pg_net nie jest włączone — bez powiadomień
  end if;
  select value into cfg_url from push_config where key = 'url';
  select value into cfg_secret from push_config where key = 'secret';
  if coalesce(cfg_url, '') = '' or coalesce(cfg_secret, '') = '' then return; end if;
  select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', s.keys)) into subs
  from push_subscriptions s
  where (p_role = 'trainer' and s.role = 'trainer' and s.user_id in (select user_id from trainers))
     or (p_role = 'client' and s.role = 'client' and s.client_id = p_client_id);
  if subs is null then return; end if;
  if p_once is not null then
    delete from push_log where at < now() - interval '1 day';
    if exists (select 1 from push_log where key = p_role || ':' || coalesce(p_client_id, '') || ':' || p_once and at > now() - interval '3 minutes') then return; end if;
    insert into push_log (key, at) values (p_role || ':' || coalesce(p_client_id, '') || ':' || p_once, now())
    on conflict (key) do update set at = excluded.at;
  end if;
  perform net.http_post(
    url := cfg_url,
    body := jsonb_build_object('subscriptions', subs, 'title', left(p_title, 80), 'body', left(coalesce(p_body, ''), 180),
                               'url', coalesce(p_url, '/app/'), 'tag', p_tag),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg_secret),
    timeout_milliseconds := 8000);
exception when others then
  raise warning 'push_send: %', sqlerrm; -- powiadomienie nigdy nie psuje zapisu
end $$;
revoke all on function public.push_send from public, anon, authenticated;

create or replace function public.push_first_name(p_client_id text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(split_part(data ->> 'name', ' ', 1), 'Podopieczny') from clients where id = p_client_id;
$$;
revoke all on function public.push_first_name from public, anon, authenticated;

create or replace function public.push_dm(d text) returns text language sql immutable as $$
  select case when d ~ '^\d{4}-\d{2}-\d{2}$' then substr(d, 9, 2) || '.' || substr(d, 6, 2) else coalesce(d, '') end;
$$;

-- Profil podopiecznego: wiadomość, ankieta, raport tygodniowy (→ trener); odpowiedź trenera (→ podopieczny).
create or replace function public.push_on_clients() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; x jsonb; trainer boolean := is_trainer();
begin
  if (select count(*) from new_rows) > 20 then return null; end if; -- import / przywracanie kopii — bez powiadomień
  for r in select n.id, n.data nd, o.data od from new_rows n join old_rows o on o.id = n.id loop
    if not trainer then
      for x in select e from jsonb_array_elements(case when jsonb_typeof(r.nd -> 'inbox') = 'array' then r.nd -> 'inbox' else '[]'::jsonb end) e
               where not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(r.od -> 'inbox') = 'array' then r.od -> 'inbox' else '[]'::jsonb end) f where f ->> 'id' = e ->> 'id')
      loop
        perform push_send('trainer', r.id, 'Wiadomość: ' || push_first_name(r.id), x ->> 'text', '/app/?c=' || r.id || '&t=Przegląd', 'inbox-' || r.id);
      end loop;
      if r.nd #>> '{intake,updatedAt}' is distinct from r.od #>> '{intake,updatedAt}' and r.nd ? 'intake' then
        perform push_send('trainer', r.id, 'Ankieta: ' || push_first_name(r.id),
          case when r.od ? 'intake' then 'Zaktualizowana ankieta' else 'Nowa ankieta do przejrzenia' end,
          '/app/?c=' || r.id || '&t=Profil', 'intake-' || r.id, 'intake');
      end if;
      for x in select e from jsonb_array_elements(case when jsonb_typeof(r.nd -> 'weeklyReports') = 'array' then r.nd -> 'weeklyReports' else '[]'::jsonb end) e
               where not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(r.od -> 'weeklyReports') = 'array' then r.od -> 'weeklyReports' else '[]'::jsonb end) f where f ->> 'id' = e ->> 'id')
      loop
        perform push_send('trainer', r.id, 'Raport tygodniowy: ' || push_first_name(r.id), coalesce(left(x ->> 'comment', 140), 'Tydzień od ' || push_dm(x ->> 'week')),
          '/app/?c=' || r.id || '&t=Przegląd', 'report-' || r.id);
      end loop;
    else
      for x in select e from jsonb_array_elements(case when jsonb_typeof(r.nd -> 'replies') = 'array' then r.nd -> 'replies' else '[]'::jsonb end) e
               where not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(r.od -> 'replies') = 'array' then r.od -> 'replies' else '[]'::jsonb end) f where f ->> 'id' = e ->> 'id')
      loop
        perform push_send('client', r.id, 'Odpowiedź od trenera', x ->> 'text', '/app/', 'reply');
      end loop;
    end if;
  end loop;
  return null;
exception when others then
  raise warning 'push_on_clients: %', sqlerrm;
  return null;
end $$;
drop trigger if exists push_clients on public.clients;
create trigger push_clients after update on public.clients
  referencing old table as old_rows new table as new_rows for each statement execute function public.push_on_clients();

-- Treningi: ból ≥ 5 (→ trener), komentarz trenera do treningu (→ podopieczny).
create or replace function public.push_on_sessions() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; trainer boolean := is_trainer();
begin
  if (select count(*) from new_rows) > 20 then return null; end if;
  for r in
    select n.client_id, n.data nd, null::jsonb od from new_rows n where tg_op = 'INSERT'
  loop
    if not trainer and jsonb_typeof(r.nd -> 'pain') = 'number' and (r.nd ->> 'pain')::numeric >= 5 then
      perform push_send('trainer', r.client_id, 'Ból ' || (r.nd ->> 'pain') || '/10 — ' || push_first_name(r.client_id),
        coalesce(r.nd ->> 'workoutName', 'Trening') || ' · ' || push_dm(r.nd ->> 'date'), '/app/?c=' || r.client_id || '&t=Treningi', 'pain-' || r.client_id);
    end if;
  end loop;
  if tg_op = 'UPDATE' then
    for r in select n.client_id, n.data nd, o.data od from new_rows n join old_rows o on o.id = n.id loop
      if not trainer and jsonb_typeof(r.nd -> 'pain') = 'number' and (r.nd ->> 'pain')::numeric >= 5
         and coalesce((case when jsonb_typeof(r.od -> 'pain') = 'number' then (r.od ->> 'pain')::numeric end), 0) < 5 then
        perform push_send('trainer', r.client_id, 'Ból ' || (r.nd ->> 'pain') || '/10 — ' || push_first_name(r.client_id),
          coalesce(r.nd ->> 'workoutName', 'Trening') || ' · ' || push_dm(r.nd ->> 'date'), '/app/?c=' || r.client_id || '&t=Treningi', 'pain-' || r.client_id);
      end if;
      if trainer and length(trim(coalesce(r.nd ->> 'coachNote', ''))) > 0 and (r.nd ->> 'coachNote') is distinct from (r.od ->> 'coachNote') then
        perform push_send('client', r.client_id, 'Trener skomentował trening', r.nd ->> 'coachNote', '/app/', 'note-' || (r.nd ->> 'id'));
      end if;
    end loop;
  end if;
  return null;
exception when others then
  raise warning 'push_on_sessions: %', sqlerrm;
  return null;
end $$;
drop trigger if exists push_sessions_ins on public.sessions;
create trigger push_sessions_ins after insert on public.sessions
  referencing new table as new_rows for each statement execute function public.push_on_sessions();
drop trigger if exists push_sessions_upd on public.sessions;
create trigger push_sessions_upd after update on public.sessions
  referencing old table as old_rows new table as new_rows for each statement execute function public.push_on_sessions();

-- Plany: nowy trening zadany na dzień (trening dodatkowy z datą) → podopieczny.
create or replace function public.push_on_plans() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; w record;
begin
  if not is_trainer() or (select count(*) from new_rows) > 20 then return null; end if;
  for r in select n.client_id, n.data nd from new_rows n where (n.data ->> 'extra') = 'true' loop
    for w in
      select k from jsonb_array_elements(case when jsonb_typeof(r.nd -> 'weeks') = 'array' then r.nd -> 'weeks' else '[]'::jsonb end) wk,
                    jsonb_array_elements(case when jsonb_typeof(wk -> 'workouts') = 'array' then wk -> 'workouts' else '[]'::jsonb end) k
      where (k ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' and (k ->> 'date')::date >= current_date
    loop
      -- wysyłka raz na trening i termin (kolejne zapisy planu nie powtarzają powiadomienia)
      if not exists (select 1 from push_log where key = 'client:' || r.client_id || ':wo-' || (w.k ->> 'id') || '-' || (w.k ->> 'date')) then
        perform push_send('client', r.client_id, 'Nowy trening na ' || push_dm(w.k ->> 'date'), coalesce(w.k ->> 'name', 'Trening'), '/app/',
          'workout', 'wo-' || (w.k ->> 'id') || '-' || (w.k ->> 'date'));
        update push_log set at = now() + interval '30 days' where key = 'client:' || r.client_id || ':wo-' || (w.k ->> 'id') || '-' || (w.k ->> 'date');
      end if;
    end loop;
  end loop;
  return null;
exception when others then
  raise warning 'push_on_plans: %', sqlerrm;
  return null;
end $$;
drop trigger if exists push_plans_ins on public.plans;
create trigger push_plans_ins after insert on public.plans
  referencing new table as new_rows for each statement execute function public.push_on_plans();
drop trigger if exists push_plans_upd on public.plans;
create trigger push_plans_upd after update on public.plans
  referencing new table as new_rows for each statement execute function public.push_on_plans();

-- Wizyty: nowa, zmiana terminu, odwołanie → podopieczny (seria = jedno powiadomienie).
create or replace function public.push_appt_event(p_client_id text, nd jsonb, od jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare once text; series boolean;
begin
  if (nd ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$' or (nd ->> 'date')::date < current_date then return; end if;
  series := coalesce(nd ->> 'seriesId', '') <> '';
  once := case when series then 'appt-s-' || split_part(nd ->> 'seriesId', ':', 1) else 'appt-' || (nd ->> 'id') end;
  if od is null and (nd ->> 'status') = 'planned' then
    perform push_send('client', p_client_id, 'Nowa wizyta: ' || push_dm(nd ->> 'date') || ' ' || coalesce(nd ->> 'time', ''),
      case when series then 'Co tydzień o tej porze' else coalesce(nd ->> 'location', 'Do zobaczenia!') end, '/app/', 'appt', once);
  elsif od is not null and (nd ->> 'status') = 'planned'
        and ((nd ->> 'date') is distinct from (od ->> 'date') or (nd ->> 'time') is distinct from (od ->> 'time')) then
    perform push_send('client', p_client_id, 'Zmiana terminu: ' || push_dm(nd ->> 'date') || ' ' || coalesce(nd ->> 'time', ''),
      'Było: ' || push_dm(od ->> 'date') || ' ' || coalesce(od ->> 'time', ''), '/app/', 'appt', once || '-m');
  elsif od is not null and (nd ->> 'status') = 'cancel' and (od ->> 'status') = 'planned' then
    perform push_send('client', p_client_id, 'Wizyta odwołana: ' || push_dm(nd ->> 'date') || ' ' || coalesce(nd ->> 'time', ''),
      'Trener odwołał wizytę', '/app/', 'appt', once || '-c');
  end if;
end $$;
revoke all on function public.push_appt_event from public, anon, authenticated;

create or replace function public.push_on_appointments() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not is_trainer() or (select count(*) from new_rows) > 30 then return null; end if;
  if tg_op = 'INSERT' then
    for r in select n.client_id, n.data nd from new_rows n loop
      perform push_appt_event(r.client_id, r.nd, null);
    end loop;
  else
    for r in select n.client_id, n.data nd, o.data od from new_rows n join old_rows o on o.id = n.id loop
      perform push_appt_event(r.client_id, r.nd, r.od);
    end loop;
  end if;
  return null;
exception when others then
  raise warning 'push_on_appointments: %', sqlerrm;
  return null;
end $$;
drop trigger if exists push_appointments_ins on public.appointments;
create trigger push_appointments_ins after insert on public.appointments
  referencing new table as new_rows for each statement execute function public.push_on_appointments();
drop trigger if exists push_appointments_upd on public.appointments;
create trigger push_appointments_upd after update on public.appointments
  referencing old table as old_rows new table as new_rows for each statement execute function public.push_on_appointments();

-- Poranne przypomnienie „Masz dziś trening” (7:00 czasu polskiego): wizyta albo trening zadany / z planu na dziś.
create or replace function public.push_daily_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; today date := (now() at time zone 'Europe/Warsaw')::date;
begin
  for r in
    select c.id,
      (select min(a.data ->> 'time') from appointments a where a.client_id = c.id and a.data ->> 'date' = today::text and a.data ->> 'status' = 'planned') appt_time,
      (select k ->> 'name' from plans p,
              jsonb_array_elements(case when jsonb_typeof(p.data -> 'weeks') = 'array' then p.data -> 'weeks' else '[]'::jsonb end) with ordinality wk(w, wi),
              jsonb_array_elements(case when jsonb_typeof(w -> 'workouts') = 'array' then w -> 'workouts' else '[]'::jsonb end) k
        where p.client_id = c.id
          and (k ->> 'date' = today::text
               or ((p.data ->> 'active') = 'true' and coalesce(p.data ->> 'extra', '') <> 'true' and (p.data ->> 'startDate') ~ '^\d{4}-\d{2}-\d{2}$'
                   and (k ->> 'day') ~ '^[1-7]$'
                   and date_trunc('week', (p.data ->> 'startDate')::date)::date + ((wi - 1) * 7 + (k ->> 'day')::int - 1)::int = today))
        limit 1) wo_name
    from clients c
    where coalesce(c.data ->> 'status', 'aktywny') = 'aktywny'
      and exists (select 1 from push_subscriptions s where s.role = 'client' and s.client_id = c.id)
      and not exists (select 1 from sessions s where s.client_id = c.id and s.data ->> 'date' = today::text)
  loop
    continue when r.appt_time is null and r.wo_name is null;
    perform push_send('client', r.id, 'Masz dziś trening',
      case when r.appt_time is not null then 'Wizyta o ' || r.appt_time else r.wo_name end, '/app/', 'daily', 'daily-' || today);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.push_daily_reminders from public, anon, authenticated;

-- Harmonogram (pg_cron, w UTC): 5:00 i 6:00 UTC = 7:00 w Polsce latem / zimą; funkcja wysyła tylko o 7:00 czasu polskiego.
-- Bez przypomnień: select cron.unschedule('fitowa-push-daily');
create or replace function public.push_daily_tick() returns void
language plpgsql security definer set search_path = public as $$
begin
  if extract(hour from now() at time zone 'Europe/Warsaw') = 7 then perform push_daily_reminders(); end if;
end $$;
revoke all on function public.push_daily_tick from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('fitowa-push-daily', '0 5,6 * * *', 'select public.push_daily_tick()');
  else
    raise notice 'pg_cron nie jest włączone — poranne przypomnienia wyłączone (Database → Extensions → pg_cron, potem uruchom sekcję 20 ponownie).';
  end if;
end $$;
notify pgrst, 'reload schema';

-- 21. Przypomnienie o samopoczuciu codziennie o 8:00 (czas polski) — tylko podopiecznym, którzy mają włączone
--     powiadomienia i jeszcze nie wypełnili dzisiejszego „Jak się dziś czujesz?”. Wymaga sekcji 20 (pg_net, pg_cron).
create or replace function public.push_checkin_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; today date := (now() at time zone 'Europe/Warsaw')::date;
begin
  for r in
    select c.id from clients c
    where coalesce(c.data ->> 'status', 'aktywny') = 'aktywny'
      and exists (select 1 from push_subscriptions s where s.role = 'client' and s.client_id = c.id)
      and not exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(c.data -> 'checkins') = 'array' then c.data -> 'checkins' else '[]'::jsonb end) ci
        where ci ->> 'date' = today::text)
  loop
    perform push_send('client', r.id, 'Jak się dziś czujesz?', 'Zaznacz sen, energię, mięśnie, stres i nastrój — 10 sekund.', '/app/', 'checkin', 'checkin-' || today);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.push_checkin_reminders from public, anon, authenticated;

-- Harmonogram (pg_cron, w UTC): 5, 6 i 7 UTC pokrywa 7:00 i 8:00 w Polsce latem i zimą;
-- funkcja sprawdza godzinę polską: 7:00 → „Masz dziś trening”, 8:00 → samopoczucie.
create or replace function public.push_daily_tick() returns void
language plpgsql security definer set search_path = public as $$
declare h int := extract(hour from now() at time zone 'Europe/Warsaw');
begin
  if h = 7 then perform push_daily_reminders(); end if;
  if h = 8 then perform push_checkin_reminders(); end if;
end $$;
revoke all on function public.push_daily_tick from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('fitowa-push-daily', '0 5,6,7 * * *', 'select public.push_daily_tick()');
  else
    raise notice 'pg_cron nie jest włączone — przypomnienia wyłączone (Database → Extensions → pg_cron, potem uruchom sekcje 20 i 21 ponownie).';
  end if;
end $$;
notify pgrst, 'reload schema';

-- 22. Żywienie dzień po dniu (dayLog): oprócz białka, kcal, kroków i wody także tłuszcze (fat), węglowodany (carbs)
--     i zrzut ekranu z aplikacji do liczenia kalorii (shot = plik w koszyku „client-files”, folder podopiecznego — sekcja 18).
--     Ta sama funkcja co w sekcji 19, rozszerzona tylko w części dayLog. Można uruchomić ponownie.
--     Zadania dzienne (habits / habitLog) nie wymagają zmian — działają przez save_habit_day (sekcja 10).
create or replace function public.save_client_entry(p_client_id text, p_kind text, p_entry jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  trainer boolean := is_trainer();
  e jsonb;
  old_e jsonb;
  key text;
  keyval text;
  k text;
  v numeric;
  lo numeric;
  hi numeric;
begin
  perform set_config('fitowa.rpc', '1', true); -- zapis przez funkcję podopiecznego (patrz guard_client_owned)
  if not (trainer or p_client_id in (select my_client_ids())) then raise exception 'Brak dostępu'; end if;
  if jsonb_typeof(p_entry) is distinct from 'object' then raise exception 'Nieprawidłowy wpis'; end if;
  key := case p_kind when 'dayLog' then 'date' when 'weeklyReports' then 'id' when 'progressPhotos' then 'id' end;
  if key is null then raise exception 'Nieznany rodzaj wpisu: %', p_kind; end if;
  keyval := p_entry ->> key;
  if key = 'id' and (coalesce(keyval, '') = '' or length(keyval) > 64) then raise exception 'Brak id wpisu'; end if;
  -- dotychczasowy wpis o tym samym kluczu (poprawka) — zostają z niego pola trenera
  select x into old_e from clients c,
    jsonb_array_elements(case when jsonb_typeof(c.data -> p_kind) = 'array' then c.data -> p_kind else '[]'::jsonb end) x
  where c.id = p_client_id and x ->> key = keyval limit 1;

  if p_kind = 'weeklyReports' then
    if coalesce(p_entry ->> 'week', '') !~ '^\d{4}-\d{2}-\d{2}$' or (p_entry ->> 'week')::date > current_date + 7
       or (p_entry ->> 'week')::date < date '2000-01-01' then raise exception 'Zły tydzień'; end if;
    e := jsonb_build_object('id', keyval, 'week', p_entry ->> 'week', 'at', coalesce(old_e -> 'at', to_jsonb(now())));
    foreach k in array array['sleep', 'stress', 'energy', 'adherence', 'weight', 'steps'] loop
      if p_entry ? k and jsonb_typeof(p_entry -> k) <> 'null' then
        if jsonb_typeof(p_entry -> k) <> 'number' then raise exception 'Zła wartość: %', k; end if;
        v := (p_entry ->> k)::numeric;
        lo := case k when 'weight' then 20 when 'steps' then 0 else 1 end;
        hi := case k when 'weight' then 400 when 'steps' then 100000 else 5 end;
        if v < lo or v > hi then raise exception 'Zła wartość: %', k; end if;
        e := e || jsonb_build_object(k, v);
      end if;
    end loop;
    if length(coalesce(p_entry ->> 'comment', '')) > 2000 then raise exception 'Komentarz za długi (najwyżej 2000 znaków)'; end if;
    if length(trim(coalesce(p_entry ->> 'comment', ''))) > 0 then e := e || jsonb_build_object('comment', p_entry ->> 'comment'); end if;
    if jsonb_typeof(p_entry -> 'photoIds') = 'array' then
      if jsonb_array_length(p_entry -> 'photoIds') > 3 then raise exception 'Najwyżej 3 zdjęcia w raporcie'; end if;
      e := e || jsonb_build_object('photoIds', coalesce((select jsonb_agg(left(x #>> '{}', 64)) from jsonb_array_elements(p_entry -> 'photoIds') x
                                                         where jsonb_typeof(x) = 'string'), '[]'::jsonb));
    end if;
    -- pola trenera: trener ustawia je sam, podopieczny ich nie zmienia (zostają z poprzedniej wersji raportu)
    e := e || jsonb_strip_nulls(jsonb_build_object(
      'seenAt', case when trainer then left(p_entry ->> 'seenAt', 40) else old_e ->> 'seenAt' end,
      'coachNote', case when trainer then left(p_entry ->> 'coachNote', 2000) else old_e ->> 'coachNote' end));

  elsif p_kind = 'progressPhotos' then
    if coalesce(p_entry ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' or (p_entry ->> 'date')::date > current_date + 1 then raise exception 'Zła data'; end if;
    -- tylko plik z folderu tego podopiecznego w magazynie albo z pamięci przeglądarki
    if length(coalesce(p_entry ->> 'ref', '')) > 300
       or not ((p_entry ->> 'ref') like 'sb:' || p_client_id || '/%' or (p_entry ->> 'ref') like 'idb:%')
       or (p_entry ->> 'ref') like '%..%' then raise exception 'Zły plik zdjęcia'; end if;
    if coalesce(p_entry ->> 'pose', '') not in ('przód', 'bok', 'tył', 'inne') then raise exception 'Zła poza'; end if;
    e := jsonb_build_object('id', keyval, 'date', p_entry ->> 'date', 'ref', p_entry ->> 'ref', 'pose', p_entry ->> 'pose',
                            'at', coalesce(old_e -> 'at', to_jsonb(now())));
    if (case when trainer then (p_entry ->> 'hidden') else (old_e ->> 'hidden') end) = 'true' then
      e := e || '{"hidden": true}'::jsonb;
    end if;

  else -- dayLog: jeden wpis na dzień
    if coalesce(keyval, '') !~ '^\d{4}-\d{2}-\d{2}$' or keyval::date > current_date + 1 then raise exception 'Zła data'; end if;
    e := jsonb_build_object('date', keyval);
    foreach k in array array['protein', 'kcal', 'steps', 'water', 'fat', 'carbs'] loop
      if p_entry ? k and jsonb_typeof(p_entry -> k) <> 'null' then
        if jsonb_typeof(p_entry -> k) <> 'number' then raise exception 'Zła wartość: %', k; end if;
        v := (p_entry ->> k)::numeric;
        hi := case k when 'protein' then 600 when 'kcal' then 10000 when 'steps' then 100000 when 'fat' then 600 when 'carbs' then 1500 else 15 end;
        if v < 0 or v > hi then raise exception 'Zła wartość: %', k; end if;
        e := e || jsonb_build_object(k, v);
      end if;
    end loop;
    -- zrzut ekranu z aplikacji do liczenia kalorii (np. Fitatu): tylko plik z folderu tego podopiecznego albo z pamięci przeglądarki
    if coalesce(p_entry ->> 'shot', '') <> '' then
      if length(p_entry ->> 'shot') > 300
         or not ((p_entry ->> 'shot') like 'sb:' || p_client_id || '/%' or (p_entry ->> 'shot') like 'idb:%')
         or (p_entry ->> 'shot') like '%..%' then raise exception 'Zły plik zrzutu'; end if;
      e := e || jsonb_build_object('shot', p_entry ->> 'shot');
    end if;
  end if;

  update clients
  set data = jsonb_set(data, array[p_kind],
        coalesce((select jsonb_agg(x order by ord) from (
          select x, ord from jsonb_array_elements(case when jsonb_typeof(data -> p_kind) = 'array' then data -> p_kind else '[]'::jsonb end)
            with ordinality t(x, ord)
          where x ->> key is distinct from keyval
          order by ord desc limit 399) s), '[]'::jsonb)
        || jsonb_build_array(e)),
      updated_at = now()
  where id = p_client_id;
end $$;
revoke all on function public.save_client_entry from public, anon;
grant execute on function public.save_client_entry to authenticated;
notify pgrst, 'reload schema';

-- 23. Rozmowa z mediami, komentarze do treningu i odpowiedź podopiecznego na wizytę. Można uruchomić ponownie.
--     a) Wiadomości głosowe zapisują się w koszyku „client-files” (sekcja 18) — dopuszczony typ audio/*.
--        Zdjęcia — też „client-files”, wideo — „set-videos” (sekcja 12); folder = id podopiecznego, te same reguły dostępu.
--     b) Wiadomość podopiecznego może mieć: kontekst treningu / ćwiczenia (ref) i do 4 załączników (media) — tylko pliki
--        z folderu tego podopiecznego. Sama wiadomość głosowa / zdjęcie bez tekstu dostaje opis („Wiadomość głosowa”)
--        z flagą textAuto — powiadomienie push do trenera (sekcja 20) działa bez zmian.
--     c) Wizyty: podopieczny nie zmienia kalendarza (sekcja 4), ale przez funkcję client_respond_appointment może
--        potwierdzić albo odwołać SWOJĄ zaplanowaną wizytę (z powodem). Zmienia się tylko status (odwołanie → 'cancel')
--        i pole reply {kind, at, reason, late}; late = odwołanie krócej niż 24 h przed wizytą. Trener dostaje push.
update storage.buckets set allowed_mime_types = array['image/*', 'application/pdf', 'audio/*'] where id = 'client-files';

create or replace function public.add_client_note(p_client_id text, p_note jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  txt text := left(coalesce(p_note ->> 'text', ''), 2000);
  r jsonb := p_note -> 'ref';
  ref jsonb;
  med jsonb := '[]'::jsonb;
  m jsonb;
  auto boolean := false;
begin
  perform set_config('fitowa.rpc', '1', true); -- zapis przez funkcję podopiecznego (patrz guard_client_owned)
  if not (is_trainer() or p_client_id in (select my_client_ids())) then raise exception 'Brak dostępu'; end if;
  -- załączniki: zdjęcie / wideo / głos, tylko pliki z folderu tego podopiecznego (albo z pamięci przeglądarki)
  if jsonb_typeof(p_note -> 'media') = 'array' then
    if jsonb_array_length(p_note -> 'media') > 4 then raise exception 'Najwyżej 4 załączniki'; end if;
    for m in select x from jsonb_array_elements(p_note -> 'media') x loop
      if jsonb_typeof(m) <> 'object' or coalesce(m ->> 'kind', '') not in ('image', 'video', 'audio') then raise exception 'Zły załącznik'; end if;
      if length(coalesce(m ->> 'ref', '')) > 300 or (m ->> 'ref') like '%..%'
         or not ((m ->> 'ref') like 'sb:' || p_client_id || '/%' or (m ->> 'ref') like 'idb:%') then raise exception 'Zły plik załącznika'; end if;
      med := med || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'kind', m ->> 'kind', 'ref', m ->> 'ref', 'mime', left(m ->> 'mime', 80),
        'dur', case when jsonb_typeof(m -> 'dur') = 'number' and (m ->> 'dur')::numeric between 0 and 3600 then round((m ->> 'dur')::numeric, 1) end)));
    end loop;
  end if;
  if length(trim(txt)) = 0 then
    if jsonb_array_length(med) = 0 then raise exception 'Pusta notatka'; end if;
    txt := case med -> 0 ->> 'kind' when 'audio' then 'Wiadomość głosowa' when 'video' then 'Nagranie wideo' else 'Zdjęcie' end;
    auto := true;
  end if;
  -- kontekst: trening / ćwiczenie
  if jsonb_typeof(r) = 'object' then
    ref := jsonb_strip_nulls(jsonb_build_object(
      'sessionId', left(r ->> 'sessionId', 40),
      'exIndex', case when jsonb_typeof(r -> 'exIndex') = 'number' and (r ->> 'exIndex')::numeric between 0 and 200 then (r ->> 'exIndex')::numeric::int end,
      'exName', left(r ->> 'exName', 120),
      'workout', left(r ->> 'workout', 120),
      'date', case when (r ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' then r ->> 'date' end));
    if ref = '{}'::jsonb then ref := null; end if;
  end if;
  update clients
  set data = jsonb_set(data, '{inbox}',
        coalesce((select jsonb_agg(n) from (select n from jsonb_array_elements(coalesce(data -> 'inbox', '[]'::jsonb)) n offset greatest(0, jsonb_array_length(coalesce(data -> 'inbox', '[]'::jsonb)) - 199)) t), '[]'::jsonb)
        || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
             'id', left(coalesce(p_note ->> 'id', md5(random()::text)), 40), 'at', now(), 'text', txt,
             'sessionId', left(coalesce(p_note ->> 'sessionId', ref ->> 'sessionId'), 40),
             'ref', ref,
             'media', case when jsonb_array_length(med) > 0 then med end,
             'textAuto', case when auto then true end)))),
      updated_at = now()
  where id = p_client_id;
end $$;
revoke all on function public.add_client_note from public, anon;
grant execute on function public.add_client_note to authenticated;

-- Odpowiedź podopiecznego na wizytę: p_kind = 'confirm' | 'cancel'. Zwraca zapisaną wizytę (data).
create or replace function public.client_respond_appointment(p_id text, p_kind text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a record;
  trainer boolean := is_trainer();
  start_at timestamptz;
  late boolean;
  why text := nullif(trim(left(coalesce(p_reason, ''), 300)), '');
  nd jsonb;
begin
  if p_kind not in ('confirm', 'cancel') then raise exception 'Nieznana odpowiedź'; end if;
  select id, client_id, data into a from appointments where id = p_id for update;
  if not found or not (trainer or a.client_id in (select my_client_ids())) then raise exception 'Brak dostępu'; end if;
  if coalesce(a.data ->> 'status', 'planned') <> 'planned' then raise exception 'Wizyta nie jest już zaplanowana'; end if;
  if (a.data ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Zła data wizyty'; end if;
  start_at := ((a.data ->> 'date') || ' ' || case when (a.data ->> 'time') ~ '^\d{1,2}:\d{2}$' then a.data ->> 'time' else '00:00' end)::timestamp
              at time zone 'Europe/Warsaw';
  if start_at + make_interval(mins => coalesce(case when jsonb_typeof(a.data -> 'duration') = 'number' then (a.data ->> 'duration')::numeric::int end, 60)) < now() then
    raise exception 'Wizyta już się odbyła';
  end if;
  late := p_kind = 'cancel' and start_at - now() < interval '24 hours';
  nd := a.data || jsonb_build_object('reply', jsonb_strip_nulls(jsonb_build_object(
          'kind', p_kind, 'at', to_jsonb(now()), 'reason', case when p_kind = 'cancel' then why end, 'late', case when late then true end)));
  if p_kind = 'cancel' then nd := nd || '{"status": "cancel"}'::jsonb; end if;
  update appointments set data = nd, updated_at = now() where id = p_id;
  if not trainer then
    perform push_send('trainer', a.client_id,
      case when p_kind = 'cancel' then (case when late then 'Późne odwołanie: ' else 'Odwołanie: ' end) else 'Potwierdzenie: ' end || push_first_name(a.client_id),
      push_dm(a.data ->> 'date') || ' ' || coalesce(a.data ->> 'time', '') || case when why is not null and p_kind = 'cancel' then ' — ' || why else '' end,
      '/app/?c=' || a.client_id || '&t=Przegląd', 'appt-reply-' || a.client_id);
  end if;
  return nd;
end $$;
revoke all on function public.client_respond_appointment from public, anon;
grant execute on function public.client_respond_appointment to authenticated;
notify pgrst, 'reload schema';

-- 24. RODO: zgody podopiecznego (dane o zdrowiu — art. 9, zdjęcia i nagrania) i prośba o usunięcie konta.
--     Lista clients.data.consents — zapis tylko przez save_consent i tylko przez SAMEGO podopiecznego
--     (trener nie zaznaczy zgody za niego); daty ustawia baza. Zapis profilu przez trenera jej nie nadpisze.
--     Współpraca zakończona (status „zakończony”): podopieczny dalej się loguje, czyta i pobiera swoją historię
--     (reguły odczytu nie zależą od statusu), ale nie zapisuje nowych treningów ani nie zmienia starych.
--     Uwaga: nie usuwaj e-maila z profilu zakończonego klienta — po e-mailu baza łączy konto z danymi.
--     Można uruchomić ponownie.
create or replace function public.save_consent(p_client_id text, p_kind text, p_entry jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  cid text := p_entry ->> 'id';
  turn_on boolean;
  old_e jsonb;
  ts text := to_jsonb(now()) #>> '{}';
begin
  if p_client_id is null or p_client_id not in (select my_client_ids()) then raise exception 'Brak dostępu'; end if;
  if p_kind is distinct from 'consents' then raise exception 'Nieznany rodzaj wpisu: %', p_kind; end if;
  if jsonb_typeof(p_entry) is distinct from 'object' or coalesce(cid, '') not in ('health', 'media', 'erasure')
     or jsonb_typeof(p_entry -> 'on') is distinct from 'boolean' then raise exception 'Nieprawidłowa zgoda'; end if;
  turn_on := (p_entry ->> 'on')::boolean;
  perform set_config('fitowa.rpc', '1', true); -- zapis przez funkcję podopiecznego (patrz guard_client_owned / guard_client_consents)
  select x into old_e from clients c,
    jsonb_array_elements(case when jsonb_typeof(c.data -> 'consents') = 'array' then c.data -> 'consents' else '[]'::jsonb end) x
  where c.id = p_client_id and x ->> 'id' = cid limit 1;
  if old_e is not null and (old_e ->> 'on') = turn_on::text then return; end if; -- bez zmiany — data zostaje
  update clients
  set data = jsonb_set(data, '{consents}',
        coalesce((select jsonb_agg(x) from jsonb_array_elements(case when jsonb_typeof(data -> 'consents') = 'array' then data -> 'consents' else '[]'::jsonb end) x
                  where x ->> 'id' is distinct from cid), '[]'::jsonb)
        || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
             'id', cid, 'on', turn_on, 'at', ts,
             'givenAt', case when turn_on then ts else old_e ->> 'givenAt' end,
             'withdrawnAt', case when turn_on then old_e ->> 'withdrawnAt' else ts end,
             'v', case when jsonb_typeof(p_entry -> 'v') = 'number' then least(greatest((p_entry ->> 'v')::numeric, 0), 1000)::int end,
             -- historia zmian (dowód zgody, art. 7 ust. 1) — 20 ostatnich
             'log', coalesce((select jsonb_agg(l order by ord) from (
                      select l, ord from jsonb_array_elements(case when jsonb_typeof(old_e -> 'log') = 'array' then old_e -> 'log' else '[]'::jsonb end)
                        with ordinality h(l, ord) order by ord desc limit 19) s), '[]'::jsonb)
                    || jsonb_build_array(jsonb_build_object('on', turn_on, 'at', ts)))))),
      updated_at = now()
  where id = p_client_id;
end $$;
revoke all on function public.save_consent from public, anon;
grant execute on function public.save_consent to authenticated;

-- Strażnik zgód: zapis profilu (trener, import) nie zmienia listy zgód — zostaje wersja z bazy.
create or replace function public.guard_client_consents() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('fitowa.rpc', true), '') = '1' then return new; end if;
  new.data := (new.data - 'consents') || case when old.data ? 'consents' then jsonb_build_object('consents', old.data -> 'consents') else '{}'::jsonb end;
  return new;
end $$;
drop trigger if exists guard_client_consents on public.clients;
create trigger guard_client_consents before update on public.clients
  for each row execute function public.guard_client_consents();

-- Współpraca zakończona: konto podopiecznego tylko do odczytu (bez nowych treningów i poprawek starych).
create or replace function public.guard_session_archived() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_trainer() then return new; end if;
  if exists (select 1 from clients where id = new.client_id and data ->> 'status' = 'zakończony') then
    raise exception 'Współpraca zakończona — nowe treningi są wyłączone';
  end if;
  return new;
end $$;
revoke all on function public.guard_session_archived from public, anon, authenticated;
drop trigger if exists guard_session_archived on public.sessions;
create trigger guard_session_archived before insert or update on public.sessions
  for each row execute function public.guard_session_archived();
notify pgrst, 'reload schema';
