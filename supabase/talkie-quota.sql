-- MotoRoute talkie-walkie : COUPE-CIRCUIT du mode direct (Cloudflare) – 31/10/2026
-- Compte les minutes de connexion au direct, par membre et par jour. La fonction serveur « talkie » refuse le direct
-- (l'app repasse toute seule en messages vocaux) quand le club dépasse son quota du mois, ou un membre son quota du jour.
-- Les minutes de CONNEXION surestiment largement la consommation réelle (le son ne part que quand quelqu'un parle) :
-- le quota protège donc avec une bonne marge. Rejouable sans risque.
begin;

create table if not exists public.talkie_usage (
  day date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  minutes int not null default 0,
  primary key (day, user_id)
);
alter table public.talkie_usage enable row level security;
revoke all on public.talkie_usage from public, anon, authenticated;
grant all on public.talkie_usage to service_role;

-- +1 minute pour ce membre aujourd'hui ; renvoie le total du club sur le mois en cours et celui du membre aujourd'hui
create or replace function public.mr_talkie_tick(p_user uuid)
returns table (month_minutes bigint, day_minutes int)
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Africa/Algiers')::date;
begin
  insert into public.talkie_usage (day, user_id, minutes) values (d, p_user, 1)
  on conflict (day, user_id) do update set minutes = public.talkie_usage.minutes + 1;
  return query
    select (select coalesce(sum(u.minutes), 0) from public.talkie_usage u where u.day >= date_trunc('month', d)::date),
           (select u.minutes from public.talkie_usage u where u.day = d and u.user_id = p_user);
end $$;

-- Lecture seule des mêmes totaux (au moment de rejoindre un canal)
create or replace function public.mr_talkie_usage(p_user uuid)
returns table (month_minutes bigint, day_minutes int)
language sql stable security definer set search_path = public as $$
  select (select coalesce(sum(u.minutes), 0) from public.talkie_usage u
           where u.day >= date_trunc('month', (now() at time zone 'Africa/Algiers'))::date),
         (select coalesce(max(u.minutes), 0) from public.talkie_usage u
           where u.day = (now() at time zone 'Africa/Algiers')::date and u.user_id = p_user);
$$;

revoke all on function public.mr_talkie_tick(uuid), public.mr_talkie_usage(uuid) from public, anon, authenticated;
grant execute on function public.mr_talkie_tick(uuid), public.mr_talkie_usage(uuid) to service_role;

commit;
