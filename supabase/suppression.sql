-- MotoRoute : suppression d'une sortie, d'un groupe et du compte
-- À coller une seule fois dans Supabase > SQL Editor, puis « Run ».
-- On peut le relancer sans risque (il remplace les fonctions existantes).

-- 1) Fonctions internes (non appelables depuis l'application)

create or replace function public.mr_purge_ride(p_ride text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if to_regclass('public.ride_positions') is not null then
    execute 'delete from public.ride_positions where ride_id::text = $1' using p_ride;
  end if;
  delete from public.ride_participants where ride_id::text = p_ride;
  delete from public.rides where id::text = p_ride;
end $$;

create or replace function public.mr_purge_group(p_group text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id::text as id from public.rides where group_id::text = p_group loop
    perform public.mr_purge_ride(r.id);
  end loop;
  if to_regclass('public.group_messages') is not null then
    execute 'delete from public.group_messages where group_id::text = $1' using p_group;
  end if;
  delete from public.group_members where group_id::text = p_group;
  delete from public.groups where id::text = p_group;
end $$;

revoke all on function public.mr_purge_ride(text) from public, anon, authenticated;
revoke all on function public.mr_purge_group(text) from public, anon, authenticated;

-- 2) Supprimer une sortie : le créateur de la sortie ou le chef du groupe

create or replace function public.delete_ride(p_ride text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Connexion requise.'; end if;
  if not exists (
    select 1 from public.rides r
    left join public.groups g on g.id = r.group_id
    where r.id::text = p_ride
      and (r.creator_id::text = uid::text or g.owner_id::text = uid::text)
  ) then
    raise exception 'Seul le créateur de la sortie (ou le chef du groupe) peut la supprimer.';
  end if;
  perform public.mr_purge_ride(p_ride);
end $$;

-- 3) Supprimer un groupe : seulement son chef (créateur)

create or replace function public.delete_group(p_group text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Connexion requise.'; end if;
  if not exists (
    select 1 from public.groups where id::text = p_group and owner_id::text = uid::text
  ) then
    raise exception 'Seul le chef du groupe peut le supprimer.';
  end if;
  perform public.mr_purge_group(p_group);
end $$;

-- 4) Supprimer mon compte et toutes mes données

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r record;
begin
  if uid is null then raise exception 'Connexion requise.'; end if;
  for r in select id::text as id from public.groups where owner_id::text = uid::text loop
    perform public.mr_purge_group(r.id);
  end loop;
  for r in select id::text as id from public.rides where creator_id::text = uid::text loop
    perform public.mr_purge_ride(r.id);
  end loop;
  delete from public.ride_participants where user_id::text = uid::text;
  delete from public.group_members where user_id::text = uid::text;
  if to_regclass('public.ride_positions') is not null then
    execute 'delete from public.ride_positions where user_id::text = $1' using uid::text;
  end if;
  if to_regclass('public.group_messages') is not null then
    execute 'delete from public.group_messages where user_id::text = $1' using uid::text;
  end if;
  delete from public.emergency_cards where user_id::text = uid::text;
  delete from public.profiles where id::text = uid::text;
  delete from auth.users where id = uid;
end $$;

revoke all on function public.delete_ride(text) from public, anon;
revoke all on function public.delete_group(text) from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_ride(text) to authenticated;
grant execute on function public.delete_group(text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
