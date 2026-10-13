-- Fitowa / coach — schemat bazy i reguły dostępu (RLS).
-- Uruchom raz w Supabase: SQL Editor → New query → wklej → Run. Można uruchomić ponownie.
-- Trener: pełny dostęp. Klient: widzi tylko swoje dane (dopasowanie po e-mailu w profilu klienta),
-- zapisuje swoje treningi i samopoczucie, niczego nie usuwa.

create table if not exists public.trainers (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.clients (
  id text primary key,
  email text,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.plans (
  id text primary key,
  client_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.sessions (
  id text primary key,
  client_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.appointments (
  id text primary key,
  client_id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.library (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists clients_email_idx on public.clients (lower(email));
create index if not exists plans_client_idx on public.plans (client_id);
create index if not exists sessions_client_idx on public.sessions (client_id);
create index if not exists appointments_client_idx on public.appointments (client_id);

-- Funkcje pomocnicze (security definer — bez rekurencji w regułach).
create or replace function public.is_trainer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from trainers where user_id = auth.uid());
$$;

create or replace function public.trainer_exists() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from trainers);
$$;

create or replace function public.my_client_ids() returns setof text
language sql stable security definer set search_path = public as $$
  select id from clients
  where email is not null and auth.jwt() ->> 'email' is not null
    and lower(email) = lower(auth.jwt() ->> 'email');
$$;

-- Pierwsza osoba, która to wywoła, zostaje trenerem (tylko gdy trenera jeszcze nie ma).
create or replace function public.claim_trainer() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from trainers) then
    return exists (select 1 from trainers where user_id = auth.uid());
  end if;
  insert into trainers (user_id) values (auth.uid());
  return true;
end $$;

-- Check-in samopoczucia: klient zmienia tylko swoją listę check-inów, nie resztę profilu.
create or replace function public.save_checkin(p_client_id text, p_checkin jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_trainer() or p_client_id in (select my_client_ids())) then
    raise exception 'Brak dostępu';
  end if;
  update clients
  set data = jsonb_set(
        data, '{checkins}',
        coalesce((select jsonb_agg(c) from jsonb_array_elements(coalesce(data -> 'checkins', '[]'::jsonb)) c
                  where c ->> 'date' <> p_checkin ->> 'date'), '[]'::jsonb) || jsonb_build_array(p_checkin)),
      updated_at = now()
  where id = p_client_id;
end $$;

revoke all on function public.is_trainer, public.trainer_exists, public.my_client_ids, public.claim_trainer, public.save_checkin from public, anon;
grant execute on function public.is_trainer, public.trainer_exists, public.my_client_ids, public.claim_trainer, public.save_checkin to authenticated;

-- Reguły dostępu
alter table public.trainers enable row level security;
alter table public.clients enable row level security;
alter table public.plans enable row level security;
alter table public.sessions enable row level security;
alter table public.appointments enable row level security;
alter table public.library enable row level security;

drop policy if exists own_row on public.trainers;
create policy own_row on public.trainers for select to authenticated using (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['clients', 'plans', 'sessions', 'appointments', 'library'] loop
    execute format('drop policy if exists trainer_all on public.%I', t);
    execute format('create policy trainer_all on public.%I for all to authenticated using (public.is_trainer()) with check (public.is_trainer())', t);
  end loop;
end $$;

drop policy if exists client_read on public.clients;
create policy client_read on public.clients for select to authenticated
  using (id in (select public.my_client_ids()));

drop policy if exists client_read on public.plans;
create policy client_read on public.plans for select to authenticated
  using (client_id in (select public.my_client_ids()));

drop policy if exists client_read on public.sessions;
create policy client_read on public.sessions for select to authenticated
  using (client_id in (select public.my_client_ids()));
drop policy if exists client_insert on public.sessions;
create policy client_insert on public.sessions for insert to authenticated
  with check (client_id in (select public.my_client_ids()));
drop policy if exists client_update on public.sessions;
create policy client_update on public.sessions for update to authenticated
  using (client_id in (select public.my_client_ids()))
  with check (client_id in (select public.my_client_ids()));

drop policy if exists client_read on public.appointments;
create policy client_read on public.appointments for select to authenticated
  using (client_id in (select public.my_client_ids()));
drop policy if exists client_update on public.appointments;
create policy client_update on public.appointments for update to authenticated
  using (client_id in (select public.my_client_ids()))
  with check (client_id in (select public.my_client_ids()));

drop policy if exists client_read on public.library;
create policy client_read on public.library for select to authenticated using (true);
