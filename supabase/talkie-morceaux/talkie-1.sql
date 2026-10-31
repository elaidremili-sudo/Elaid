-- MotoRoute talkie-walkie, morceau 1/4 vérification + droits d'accès
do $$
declare
  need text[][] := array[
    ['groups','id','uuid'], ['groups','owner_id','uuid'],
    ['group_members','group_id','uuid'], ['group_members','user_id','uuid'], ['group_members','status','text'],
    ['rides','id','uuid'], ['rides','creator_id','uuid'],
    ['ride_participants','ride_id','uuid'], ['ride_participants','user_id','uuid'],
    ['profiles','id','uuid'], ['profiles','first_name','text']];
  i int; t text; c text; ty text; got text;
begin
  for i in 1 .. array_length(need, 1) loop
    t := need[i][1]; c := need[i][2]; ty := need[i][3];
    select data_type into got from information_schema.columns
     where table_schema = 'public' and table_name = t and column_name = c;
    if got is null then
      raise exception 'talkie.sql : colonne manquante public.%.% (le script attend un type %). Rien n''a été modifié.', t, c, ty;
    end if;
    if got <> ty and not (ty = 'text' and got in ('character varying', 'text')) then
      raise exception 'talkie.sql : public.%.% est de type % (attendu %). Rien n''a été modifié.', t, c, got, ty;
    end if;
  end loop;
end $$;
create or replace function public.mr_talkie_can(p_group uuid, p_ride uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    (p_group is not null and (
        exists (select 1 from public.group_members m
                 where m.group_id = p_group and m.user_id = auth.uid() and coalesce(m.status, 'active') = 'active')
     or exists (select 1 from public.groups g where g.id = p_group and g.owner_id = auth.uid())))
    or
    (p_ride is not null and (
        exists (select 1 from public.ride_participants rp where rp.ride_id = p_ride and rp.user_id = auth.uid())
     or exists (select 1 from public.rides r where r.id = p_ride and r.creator_id = auth.uid())))
  );
$$;
create or replace function public.mr_talkie_can_folder(p_folder text)
returns boolean language sql stable security definer set search_path = public as $$
  select case when p_folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then public.mr_talkie_can(p_folder::uuid, p_folder::uuid)
              else false end;
$$;
create or replace function public.mr_talkie_can_topic(p_topic text)
returns boolean language sql stable security definer set search_path = public as $$
  select case when p_topic ~* '^talkie:[gr]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then public.mr_talkie_can(
                     case when substr(p_topic, 8, 1) = 'g' then substr(p_topic, 10)::uuid end,
                     case when substr(p_topic, 8, 1) = 'r' then substr(p_topic, 10)::uuid end)
              else false end;
$$;
revoke all on function public.mr_talkie_can(uuid, uuid), public.mr_talkie_can_folder(text),
  public.mr_talkie_can_topic(text) from public, anon;
grant execute on function public.mr_talkie_can(uuid, uuid), public.mr_talkie_can_folder(text),
  public.mr_talkie_can_topic(text) to authenticated, service_role;
