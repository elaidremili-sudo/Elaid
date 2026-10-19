-- MotoRoute : Rallye de régularité
-- À coller une seule fois dans Supabase > SQL Editor, puis « Run ». Peut être relancé sans risque.
-- Principe : le gagnant est celui qui arrive le plus près du temps idéal (moyenne imposée),
-- avec des pénalités en cas de dépassement de la vitesse maximale. Rouler vite fait perdre.

create table if not exists public.rallies (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  start_lat double precision not null,
  start_lng double precision not null,
  end_lat double precision not null,
  end_lng double precision not null,
  target_kmh int not null check (target_kmh between 20 and 90),
  cap_kmh int not null check (cap_kmh between 30 and 110),
  ride_date date,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.rally_entries (
  rally_id uuid not null references public.rallies(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  first_name text,
  moto text,
  status text not null default 'joined' check (status in ('joined', 'riding', 'finished', 'dnf')),
  duration_s int,
  distance_km numeric,
  avg_kmh numeric,
  max_kmh numeric,
  over_s int,
  lean_max int,
  smooth int,
  score numeric,
  updated_at timestamptz not null default now(),
  primary key (rally_id, user_id)
);

alter table public.rallies enable row level security;
alter table public.rally_entries enable row level security;

drop policy if exists rallies_read on public.rallies;
create policy rallies_read on public.rallies for select to authenticated using (true);
drop policy if exists rallies_insert on public.rallies;
create policy rallies_insert on public.rallies for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists rallies_update on public.rallies;
create policy rallies_update on public.rallies for update to authenticated using (owner_id = auth.uid());
drop policy if exists rallies_delete on public.rallies;
create policy rallies_delete on public.rallies for delete to authenticated using (owner_id = auth.uid());

drop policy if exists entries_read on public.rally_entries;
create policy entries_read on public.rally_entries for select to authenticated using (true);
drop policy if exists entries_insert on public.rally_entries;
create policy entries_insert on public.rally_entries for insert to authenticated with check (user_id = auth.uid());
drop policy if exists entries_update on public.rally_entries;
create policy entries_update on public.rally_entries for update to authenticated using (user_id = auth.uid());
drop policy if exists entries_delete on public.rally_entries;
create policy entries_delete on public.rally_entries for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.rallies r where r.id = rally_id and r.owner_id = auth.uid()));

-- Rejoindre un rallye avec son code : ajoute le motard au tableau avec son prénom et sa moto
create or replace function public.join_rally_by_code(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r record; p record;
begin
  if uid is null then raise exception 'Connexion requise.'; end if;
  select id, status into r from public.rallies where upper(code) = upper(trim(p_code));
  if not found then raise exception 'Code de rallye inconnu.'; end if;
  if r.status <> 'open' then raise exception 'Ce rallye est clôturé.'; end if;
  select first_name, moto into p from public.profiles where id = uid;
  insert into public.rally_entries (rally_id, user_id, first_name, moto)
  values (r.id, uid, p.first_name, p.moto)
  on conflict (rally_id, user_id) do nothing;
  return r.id;
end $$;
grant execute on function public.join_rally_by_code(text) to authenticated;
