-- MotoRoute : sécurité des groupes (20/10/2026)
-- Empêche d'entrer dans un groupe « sur validation » ou privé sans passer par l'accord du chef / le code,
-- et empêche un membre de se donner lui-même le statut « actif » ou le rôle de chef.
-- À coller une seule fois dans Supabase > SQL Editor, puis « Run ». Peut être relancé sans risque.

-- 1) On retire les anciennes règles d'ajout direct (dont members_insert_self, trop large)
do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'group_members' and cmd = 'INSERT' loop
    execute format('drop policy %I on public.group_members', p.policyname);
  end loop;
end $$;

-- 2) Nouvelle règle d'ajout : soi-même seulement, et
--    - le chef peut s'ajouter à son propre groupe (création du groupe),
--    - sinon : groupe public, rôle « member », statut « active » si ouvert à tous, « pending » si sur validation.
--    (Groupes privés : uniquement par le code, via la fonction join_group_by_code.)
create policy members_insert_safe on public.group_members for insert to authenticated
  with check (
    user_id = auth.uid() and (
      exists (select 1 from public.groups g where g.id = group_members.group_id and g.owner_id = auth.uid())
      or (
        coalesce(role, 'member') = 'member' and exists (
          select 1 from public.groups g
           where g.id = group_members.group_id
             and not coalesce(g.is_private, false)
             and (   (not coalesce(g.requires_approval, false) and coalesce(group_members.status, 'active') = 'active')
                  or (coalesce(g.requires_approval, false) and group_members.status = 'pending'))
        )
      )
    )
  );

-- 3) Statut et rôle : seul le chef du groupe peut les changer
create or replace function public.mr_guard_member_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- éditeur SQL / tâches serveur
  if (new.status is distinct from old.status or new.role is distinct from old.role
      or new.user_id is distinct from old.user_id or new.group_id is distinct from old.group_id)
     and not exists (select 1 from public.groups g where g.id = old.group_id and g.owner_id = auth.uid()) then
    raise exception 'Seul le chef du groupe peut changer le statut ou le rôle d’un membre.';
  end if;
  return new;
end $$;
revoke all on function public.mr_guard_member_update() from public, anon, authenticated;
drop trigger if exists guard_member_update on public.group_members;
create trigger guard_member_update before update on public.group_members
  for each row execute function public.mr_guard_member_update();

-- 4) Vérification : liste des règles restantes sur group_members (à regarder dans « Results »)
select policyname as regle, cmd as action, roles
  from pg_policies where schemaname = 'public' and tablename = 'group_members' order by cmd, policyname;
