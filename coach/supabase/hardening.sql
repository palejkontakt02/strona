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
