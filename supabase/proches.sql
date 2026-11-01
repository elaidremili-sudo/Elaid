-- MotoRoute – carte Route « Position et motards proches » (01/11/2026, test-73)
-- « Partager ma position avec mon groupe » : la dernière position du membre (une seule ligne par membre),
--   visible UNIQUEMENT par les membres actifs d'un groupe en commun, et seulement si elle date de moins de 30 min.
-- « Prévenir quand un motard est proche » : l'app lit ces positions et prévient quand un membre de ses groupes
--   est à moins de 3 km.
-- Le prénom et l'heure sont imposés par le serveur ; une mise à jour toutes les 20 s au plus ;
-- effacement automatique après 8 h (pg_cron) et dès que le membre décoche la case.
-- Rejouable sans risque.
begin;

create table if not exists public.member_positions (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  updated_at timestamptz not null default now()
);
alter table public.member_positions enable row level security;

-- Vrai si le membre connecté et p_other sont tous les deux membres actifs d'au moins un même groupe
create or replace function public.mr_shares_group(p_other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members a
    join public.group_members b on b.group_id = a.group_id
    where a.user_id = (select auth.uid()) and b.user_id = p_other
      and a.status = 'active' and b.status = 'active');
$$;
revoke all on function public.mr_shares_group(uuid) from public, anon;
grant execute on function public.mr_shares_group(uuid) to authenticated;

-- Auteur, prénom et heure imposés par le serveur ; au plus une mise à jour toutes les 20 s
create or replace function public.mr_member_pos_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
  else
    new.user_id := old.user_id;
    if old.updated_at > now() - interval '20 seconds' then return null; end if;  -- ignorée sans erreur
  end if;
  if new.user_id is null then raise exception 'mr-auteur-absent : compte connecté obligatoire'; end if;
  new.first_name := public.mr_display_name(new.user_id);
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.mr_member_pos_guard() from public, anon, authenticated;

drop trigger if exists mr_member_pos_guard on public.member_positions;
create trigger mr_member_pos_guard before insert or update on public.member_positions
  for each row execute function public.mr_member_pos_guard();

drop policy if exists mp_select on public.member_positions;
drop policy if exists mp_insert on public.member_positions;
drop policy if exists mp_update on public.member_positions;
drop policy if exists mp_delete on public.member_positions;
create policy mp_select on public.member_positions for select to authenticated
  using (user_id = (select auth.uid())
         or (updated_at > now() - interval '30 minutes' and public.mr_shares_group(user_id)));
create policy mp_insert on public.member_positions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy mp_update on public.member_positions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy mp_delete on public.member_positions for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.member_positions from public, anon;
grant select, insert, update, delete on public.member_positions to authenticated;

commit;

-- Effacement automatique après 8 h (hors transaction : ne bloque jamais le reste)
do $$
begin
  perform cron.schedule('mr-purge-member-positions', '*/30 * * * *',
    $c$delete from public.member_positions where updated_at < now() - interval '8 hours'$c$);
exception when others then
  raise notice 'pg_cron indisponible : effacement après 8 h non planifié (%)', sqlerrm;
end $$;
