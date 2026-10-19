-- MotoRoute : comparaison d'un même trajet entre membres d'un groupe (test-26)
-- À coller une seule fois dans Supabase > SQL Editor, puis « Run ». Peut être relancé sans risque.
-- Ce n'est pas une course : on compare seulement les chiffres de chacun sur le même trajet.

-- 1) Les trajets mesurés (onglet Conduite), envoyés seulement si le membre active « Partager mes trajets »
create table if not exists public.trajets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  local_id text not null,
  started_at timestamptz not null,
  km numeric not null,
  dur integer not null,
  vmax integer, vavg integer, lean_l integer, lean_r integer, vc integer, vca integer,
  a_lat double precision not null, a_lng double precision not null,   -- départ
  b_lat double precision not null, b_lng double precision not null,   -- arrivée
  sortie_id text,                                                      -- sortie du club (si le trajet a été fait pendant une sortie)
  shared boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, local_id)
);
create index if not exists trajets_depart_idx on public.trajets (a_lat, a_lng);

-- 2) Chacun ne voit et ne modifie que SES lignes (personne ne voit les positions des autres)
alter table public.trajets enable row level security;
drop policy if exists trajets_own_select on public.trajets;
create policy trajets_own_select on public.trajets for select to authenticated using (user_id = auth.uid());
drop policy if exists trajets_own_insert on public.trajets;
create policy trajets_own_insert on public.trajets for insert to authenticated with check (user_id = auth.uid());
drop policy if exists trajets_own_update on public.trajets;
create policy trajets_own_update on public.trajets for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists trajets_own_delete on public.trajets;
create policy trajets_own_delete on public.trajets for delete to authenticated using (user_id = auth.uid());

-- 3) Trajets comparables : membres actifs d'un même groupe, même départ et même arrivée (≈ 500 m),
--    distance proche (± 20 %, au moins 1 km) ou même sortie. Renvoie le prénom et les chiffres, JAMAIS les positions.
--    Une seule ligne par membre : son passage le plus récent sur ce trajet.
create or replace function public.trajets_comparables(
  p_a_lat double precision, p_a_lng double precision,
  p_b_lat double precision, p_b_lng double precision,
  p_km numeric, p_sortie text default null)
returns table (first_name text, started_at timestamptz, km numeric, dur integer, vmax integer, vavg integer,
               lean_l integer, lean_r integer, vc integer, vca integer)
language sql stable security definer set search_path = public as $$
  with mates as (
    select distinct m2.user_id
      from public.group_members m1
      join public.group_members m2 on m2.group_id = m1.group_id
     where m1.user_id = auth.uid() and coalesce(m1.status, 'active') = 'active'
       and coalesce(m2.status, 'active') = 'active' and m2.user_id <> auth.uid()
  ), cand as (
    select distinct on (t.user_id) t.*
      from public.trajets t join mates on mates.user_id = t.user_id
     where t.shared and auth.uid() is not null
       and ( (p_sortie is not null and t.sortie_id = p_sortie)
          or ( abs(t.a_lat - p_a_lat) < 0.0045 and abs(t.a_lng - p_a_lng) < 0.006
           and abs(t.b_lat - p_b_lat) < 0.0045 and abs(t.b_lng - p_b_lng) < 0.006
           and abs(t.km - p_km) <= greatest(1, p_km * 0.2) ) )
     order by t.user_id, t.started_at desc
  )
  select coalesce(nullif(p.first_name, ''), 'Motard'), c.started_at, c.km, c.dur, c.vmax, c.vavg,
         c.lean_l, c.lean_r, c.vc, c.vca
    from cand c left join public.profiles p on p.id = c.user_id
   order by c.started_at desc
   limit 12;
$$;

revoke all on function public.trajets_comparables(double precision, double precision, double precision, double precision, numeric, text) from public, anon;
grant execute on function public.trajets_comparables(double precision, double precision, double precision, double precision, numeric, text) to authenticated;
