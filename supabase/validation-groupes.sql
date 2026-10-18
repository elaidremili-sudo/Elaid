-- MotoRoute : groupes avec validation par le chef
-- À coller une seule fois dans Supabase > SQL Editor, puis « Run ». Peut être relancé sans risque.

-- 1) Le statut d'un membre peut être « active » ou « pending » (demande en attente)
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.group_members'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%status%' loop
    execute format('alter table public.group_members drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.group_members
  add constraint group_members_status_check check (status in ('active', 'pending')) not valid;

-- 2) Demander à rejoindre un groupe public (directement, ou en attente si le groupe est « sur validation »)
create or replace function public.request_join_group(p_group uuid)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); g record; st text;
begin
  if uid is null then raise exception 'Connexion requise.'; end if;
  select is_private, requires_approval into g from public.groups where id = p_group;
  if not found then raise exception 'Groupe introuvable.'; end if;
  select status into st from public.group_members where group_id = p_group and user_id = uid;
  if found then return st; end if;
  if g.is_private then raise exception 'Groupe privé : utilise le code d’invitation.'; end if;
  st := case when coalesce(g.requires_approval, false) then 'pending' else 'active' end;
  insert into public.group_members (group_id, user_id, role, status) values (p_group, uid, 'member', st);
  return st;
end $$;

-- 3) Le chef accepte ou refuse une demande
create or replace function public.decide_member(p_group uuid, p_user uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Connexion requise.'; end if;
  if not exists (select 1 from public.groups where id = p_group and owner_id = uid) then
    raise exception 'Seul le chef du groupe peut accepter ou refuser.';
  end if;
  if p_accept then
    update public.group_members set status = 'active'
     where group_id = p_group and user_id = p_user and status = 'pending';
  else
    delete from public.group_members
     where group_id = p_group and user_id = p_user and status = 'pending';
  end if;
end $$;

revoke all on function public.request_join_group(uuid) from public, anon;
revoke all on function public.decide_member(uuid, uuid, boolean) from public, anon;
grant execute on function public.request_join_group(uuid) to authenticated;
grant execute on function public.decide_member(uuid, uuid, boolean) to authenticated;
