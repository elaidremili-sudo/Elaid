-- MotoRoute — sécurité du 07/11/2026 (audit des 6 relecteurs)
-- À coller dans Supabase → SQL Editor → Run. Le script peut être relancé sans risque.
--
-- Problème corrigé : dans un groupe PUBLIC, quelqu'un qui venait d'entrer voyait tout de suite
-- les positions en direct des membres (« motards proches ») et les alertes SOS des dernières 24 h
-- (nom, groupe sanguin, position). Un inconnu pouvait donc s'inscrire pour suivre des motards.
-- Désormais, dans un groupe public, il faut être membre depuis 24 h (même règle que pour la sirène).
-- Les groupes privés (entrée par code) et le chef du groupe ne sont pas concernés.

create or replace function public.mr_member_trusted(p_group uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members m
    join public.groups g on g.id = m.group_id
    where m.group_id = p_group and m.user_id = p_user
      and coalesce(m.status, 'active') = 'active'
      and (g.is_private or g.owner_id = p_user or m.joined_at is null
           or m.joined_at < now() - interval '24 hours'));
$$;
revoke all on function public.mr_member_trusted(uuid, uuid) from public, anon;
grant execute on function public.mr_member_trusted(uuid, uuid) to authenticated;

-- Positions en direct : partagées seulement avec les membres « de confiance » du groupe commun
create or replace function public.mr_shares_group(p_other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members a
    join public.group_members b on b.group_id = a.group_id
    where a.user_id = (select auth.uid()) and b.user_id = p_other
      and a.status = 'active' and b.status = 'active'
      and public.mr_member_trusted(a.group_id, a.user_id));
$$;

-- Alertes SOS des groupes : même règle
drop policy if exists sos_select on public.sos_alerts;
create policy sos_select on public.sos_alerts for select to authenticated
  using (user_id = (select auth.uid()) or (
    created_at > now() - interval '24 hours' and exists (
      select 1 from public.group_members m
      where m.group_id = sos_alerts.group_id and m.user_id = (select auth.uid())
        and coalesce(m.status, 'active') = 'active'
        and public.mr_member_trusted(m.group_id, m.user_id))));

-- Vérification : doit afficher 1 fonction et 1 règle
select (select count(*) from pg_proc where proname = 'mr_member_trusted') as fonction,
       (select count(*) from pg_policies where tablename = 'sos_alerts' and policyname = 'sos_select') as regle;
