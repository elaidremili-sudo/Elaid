-- MotoRoute : alertes SOS envoyées aux groupes (chute détectée ou SOS manuel) – 20/10/2026
-- À coller une seule fois dans Supabase > SQL Editor, puis « Run ». Peut être relancé sans risque.

create table if not exists public.sos_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  first_name text check (char_length(first_name) <= 40),
  kind text not null default 'chute' check (kind in ('chute', 'sos')),
  msg text check (char_length(msg) <= 500),
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now()
);
create index if not exists sos_alerts_group_time_idx on public.sos_alerts (group_id, created_at desc);

alter table public.sos_alerts enable row level security;
grant select, insert, delete on public.sos_alerts to authenticated;
revoke all on public.sos_alerts from anon;

-- Envoyer : seulement en son nom, et seulement vers un groupe dont on est membre actif
drop policy if exists sos_insert on public.sos_alerts;
create policy sos_insert on public.sos_alerts for insert to authenticated
  with check (user_id = auth.uid() and exists (
    select 1 from public.group_members m
     where m.group_id = sos_alerts.group_id and m.user_id = auth.uid() and coalesce(m.status, 'active') = 'active'));

-- Lire : ses propres alertes + celles des groupes dont on est membre actif (dernières 24 h)
drop policy if exists sos_select on public.sos_alerts;
create policy sos_select on public.sos_alerts for select to authenticated
  using (user_id = auth.uid() or (created_at > now() - interval '24 hours' and exists (
    select 1 from public.group_members m
     where m.group_id = sos_alerts.group_id and m.user_id = auth.uid() and coalesce(m.status, 'active') = 'active')));

-- Supprimer : ses propres alertes
drop policy if exists sos_delete on public.sos_alerts;
create policy sos_delete on public.sos_alerts for delete to authenticated using (user_id = auth.uid());

-- Temps réel : les membres reçoivent l'alerte tout de suite (si l'app est ouverte)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sos_alerts') then
    execute 'alter publication supabase_realtime add table public.sos_alerts';
  end if;
end $$;

-- Ménage : les alertes de plus de 7 jours sont effacées à chaque nouvelle alerte
create or replace function public.mr_sos_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.sos_alerts where created_at < now() - interval '7 days';
  return null;
end $$;
revoke all on function public.mr_sos_cleanup() from public, anon, authenticated;
drop trigger if exists sos_cleanup on public.sos_alerts;
create trigger sos_cleanup after insert on public.sos_alerts for each statement execute function public.mr_sos_cleanup();
