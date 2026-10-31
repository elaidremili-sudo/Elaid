-- MotoRoute talkie-walkie : COUPE-CIRCUIT du mode direct, version 2 (A5, 31/10/2026)
-- À appliquer APRÈS supabase/talkie-quota.sql (il réutilise la table public.talkie_usage).
-- Le téléphone ne compte plus chaque minute mais toutes les 5 minutes : la fonction serveur « talkie » ajoute
-- donc 5 minutes d'un coup. Cette fonction fait l'ajout en UNE seule requête (au lieu de 5 appels à mr_talkie_tick).
-- Le nombre de minutes est borné (1 à 10) et n'est appelable que par la clé de service (fonction serveur).
-- mr_talkie_tick et mr_talkie_usage restent en place (compatibilité). Rejouable sans risque.
begin;

-- +p_minutes pour ce membre aujourd'hui ; renvoie le total du club sur le mois en cours et celui du membre aujourd'hui
create or replace function public.mr_talkie_add(p_user uuid, p_minutes int)
returns table (month_minutes bigint, day_minutes int)
language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'Africa/Algiers')::date;
  n int := least(greatest(coalesce(p_minutes, 1), 1), 10);
begin
  insert into public.talkie_usage (day, user_id, minutes) values (d, p_user, n)
  on conflict (day, user_id) do update set minutes = public.talkie_usage.minutes + n;
  return query
    select (select coalesce(sum(u.minutes), 0) from public.talkie_usage u where u.day >= date_trunc('month', d)::date),
           (select u.minutes from public.talkie_usage u where u.day = d and u.user_id = p_user);
end $$;

revoke all on function public.mr_talkie_add(uuid, int) from public, anon, authenticated;
grant execute on function public.mr_talkie_add(uuid, int) to service_role;

commit;
