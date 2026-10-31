-- MotoRoute talkie-walkie, morceau 2/4 messages vocaux
create table if not exists public.talkie_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid,
  ride_id uuid,
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  first_name text,
  path text not null,
  mime text not null,
  duration_ms int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint talkie_un_seul_canal check (num_nonnulls(group_id, ride_id) = 1)
);
create index if not exists talkie_messages_group_idx on public.talkie_messages (group_id, created_at desc);
create index if not exists talkie_messages_ride_idx on public.talkie_messages (ride_id, created_at desc);
create index if not exists talkie_messages_user_idx on public.talkie_messages (user_id, created_at desc);
create index if not exists talkie_messages_exp_idx on public.talkie_messages (expires_at);
alter table public.talkie_messages enable row level security;
create or replace function public.mr_talkie_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  chan uuid := coalesce(new.group_id, new.ride_id);
  n int;
  nm text;
begin
  if uid is not null then new.user_id := uid; end if;
  if new.user_id is null then raise exception 'mr-talkie-sans-auteur'; end if;
  if chan is null or new.path is null or new.path like '%..%'
     or split_part(new.path, '/', 1) <> chan::text
     or split_part(new.path, '/', 3) <> ''
     or left(split_part(new.path, '/', 2), 37) <> new.user_id::text || '_' then
    raise exception 'mr-talkie-chemin : le fichier doit être rangé dans le dossier du canal, au nom de l''auteur';
  end if;
  new.mime := lower(split_part(coalesce(new.mime, ''), ';', 1));
  if new.mime not in ('audio/webm', 'audio/mp4', 'audio/ogg', 'audio/aac', 'audio/mpeg') then
    raise exception 'mr-talkie-format : format audio non accepté (%)', new.mime;
  end if;
  new.duration_ms := least(greatest(coalesce(new.duration_ms, 0), 0), 31000);
  if uid is not null then
    select count(*) into n from public.talkie_messages x
     where x.user_id = uid and x.created_at > now() - interval '10 minutes';
    if n >= 60 then raise exception 'mr-talkie-trop : 60 messages par 10 minutes au maximum'; end if;
  end if;
  select nullif(trim(p.first_name), '') into nm from public.profiles p where p.id = new.user_id;
  new.first_name := left(coalesce(nm, 'Motard'), 40);
  new.created_at := now();
  new.expires_at := now() + interval '24 hours';
  return new;
end $$;
revoke all on function public.mr_talkie_guard() from public, anon, authenticated;
drop trigger if exists talkie_guard on public.talkie_messages;
create trigger talkie_guard before insert on public.talkie_messages
  for each row execute function public.mr_talkie_guard();
revoke all on public.talkie_messages from public, anon, authenticated;
grant select on public.talkie_messages to authenticated;
grant insert (group_id, ride_id, path, mime, duration_ms) on public.talkie_messages to authenticated;
grant all on public.talkie_messages to service_role;
drop policy if exists talkie_msg_select on public.talkie_messages;
create policy talkie_msg_select on public.talkie_messages for select to authenticated
  using (expires_at > now() and public.mr_talkie_can(group_id, ride_id));
drop policy if exists talkie_msg_insert on public.talkie_messages;
create policy talkie_msg_insert on public.talkie_messages for insert to authenticated
  with check (user_id = auth.uid() and public.mr_talkie_can(group_id, ride_id));
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'talkie_messages') then
    execute 'alter publication supabase_realtime add table public.talkie_messages';
  end if;
end $$;
