-- MotoRoute – Bonnes adresses sur la route (24/10/2026, test-53)
-- Tout membre connecté peut ajouter un lieu utile aux motards (hébergement / motard hôte, resto-café,
-- station, mécanicien, point de vue, autre) avec sa position GPS et jusqu'à 4 photos.
-- Décision d'Elaid : PAS de validation, le lieu est visible tout de suite par les autres membres.
-- Garde-fous : 👍 (un par membre), « Signaler » (3 signalements de membres différents = lieu masqué),
-- l'auteur peut modifier/supprimer son lieu, l'administrateur (app_admins) peut tout supprimer ou réafficher,
-- 15 ajouts maximum par membre et par 24 h.
-- Rejouable sans risque.

-- ---------- Lieux ----------
create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  author text not null default '',
  kind text not null check (kind in ('host','food','fuel','meca','view','other')),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  city text not null default '' check (char_length(city) <= 60),
  note text not null default '' check (char_length(note) <= 600),
  phone text not null default '' check (char_length(phone) <= 25),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  photos text[] not null default '{}' check (cardinality(photos) <= 4),
  likes int not null default 0,
  reports int not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists places_geo on public.places (lat, lng);
create index if not exists places_user on public.places (user_id, created_at desc);
alter table public.places enable row level security;

drop policy if exists places_read on public.places;
create policy places_read on public.places for select to authenticated
  using (not hidden or user_id = auth.uid() or public.mr_is_admin());
drop policy if exists places_insert on public.places;
create policy places_insert on public.places for insert to authenticated
  with check (user_id = auth.uid() and not hidden and likes = 0 and reports = 0);
drop policy if exists places_update on public.places;
create policy places_update on public.places for update to authenticated
  using (user_id = auth.uid() or public.mr_is_admin())
  with check (user_id = auth.uid() or public.mr_is_admin());
drop policy if exists places_delete on public.places;
create policy places_delete on public.places for delete to authenticated
  using (user_id = auth.uid() or public.mr_is_admin());

-- Droits explicites (exigés par Supabase pour les nouvelles tables à partir du 30/10/2026).
-- Les compteurs (likes, reports, hidden) ne sont modifiables que par les fonctions ci-dessous.
revoke all on public.places from anon, authenticated;
grant select, delete on public.places to authenticated;
grant insert (author, kind, name, city, note, phone, lat, lng, photos) on public.places to authenticated;
grant update (kind, name, city, note, phone, lat, lng, photos, updated_at) on public.places to authenticated;

-- 15 ajouts maximum par membre et par 24 h ; nom d'auteur pris dans le profil (pas fourni par le téléphone)
create or replace function public.mr_place_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from places where user_id = new.user_id and created_at > now() - interval '24 hours') >= 15 then
    raise exception 'Limite atteinte : 15 adresses par 24 h.' using errcode = 'P0001';
  end if;
  new.author := coalesce((select nullif(btrim(first_name), '') from profiles where id = new.user_id), '');
  new.likes := 0; new.reports := 0; new.hidden := false;
  new.created_at := now(); new.updated_at := now();
  return new;
end $$;
drop trigger if exists places_before_insert on public.places;
create trigger places_before_insert before insert on public.places
  for each row execute function public.mr_place_before_insert();

-- ---------- 👍 (un par membre) ----------
create table if not exists public.place_likes (
  place_id uuid not null references public.places on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (place_id, user_id)
);
alter table public.place_likes enable row level security;
drop policy if exists place_likes_read on public.place_likes;
create policy place_likes_read on public.place_likes for select to authenticated using (user_id = auth.uid());
revoke all on public.place_likes from anon, authenticated;
grant select on public.place_likes to authenticated;

create or replace function public.mr_place_like(p_place uuid) returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); liked boolean; n int;
begin
  if uid is null then raise exception 'Connexion requise'; end if;
  if not exists (select 1 from places where id = p_place and (not hidden or user_id = uid)) then
    raise exception 'Adresse introuvable';
  end if;
  if exists (select 1 from place_likes where place_id = p_place and user_id = uid) then
    delete from place_likes where place_id = p_place and user_id = uid; liked := false;
  else
    insert into place_likes (place_id, user_id) values (p_place, uid); liked := true;
  end if;
  select count(*) into n from place_likes where place_id = p_place;
  update places set likes = n where id = p_place;
  return json_build_object('liked', liked, 'likes', n);
end $$;

-- ---------- Signalements (3 membres différents = lieu masqué) ----------
create table if not exists public.place_reports (
  place_id uuid not null references public.places on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  primary key (place_id, user_id)
);
alter table public.place_reports enable row level security;
drop policy if exists place_reports_read on public.place_reports;
create policy place_reports_read on public.place_reports for select to authenticated
  using (user_id = auth.uid() or public.mr_is_admin());
revoke all on public.place_reports from anon, authenticated;
grant select on public.place_reports to authenticated;

create or replace function public.mr_place_report(p_place uuid, p_reason text default '') returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n int; h boolean;
begin
  if uid is null then raise exception 'Connexion requise'; end if;
  if exists (select 1 from places where id = p_place and user_id = uid) then
    raise exception 'Tu ne peux pas signaler ta propre adresse';
  end if;
  if not exists (select 1 from places where id = p_place and not hidden) then raise exception 'Adresse introuvable'; end if;
  insert into place_reports (place_id, user_id, reason) values (p_place, uid, left(coalesce(p_reason, ''), 200))
    on conflict (place_id, user_id) do nothing;
  select count(*) into n from place_reports where place_id = p_place;
  update places set reports = n, hidden = (n >= 3) where id = p_place returning hidden into h;
  return json_build_object('reports', n, 'hidden', h);
end $$;

-- Administrateur : réafficher un lieu masqué à tort (efface ses signalements)
create or replace function public.mr_place_unhide(p_place uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.mr_is_admin() then raise exception 'Réservé à l''administrateur'; end if;
  delete from place_reports where place_id = p_place;
  update places set reports = 0, hidden = false where id = p_place;
end $$;

revoke execute on function public.mr_place_like(uuid), public.mr_place_report(uuid, text), public.mr_place_unhide(uuid),
  public.mr_place_before_insert() from public, anon;
grant execute on function public.mr_place_like(uuid), public.mr_place_report(uuid, text), public.mr_place_unhide(uuid)
  to authenticated;

-- ---------- Photos (dossier = identifiant du membre) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('place-photos', 'place-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists place_photos_insert on storage.objects;
create policy place_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'place-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists place_photos_delete on storage.objects;
create policy place_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'place-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.mr_is_admin()));
