-- MotoRoute – sécurité et confidentialité du 31/10/2026 (bilan, partie B : B2, B3, B4, B6, B7, B8, B9)
-- À coller dans Supabase > SQL Editor, puis « Run ». Rejouable sans risque : tout est « if not exists » /
-- « create or replace » / « drop … if exists ». Tout passe en UNE SEULE transaction : si une ligne échoue,
-- rien n'est changé (sauf l'activation de pg_cron, voir section 7, qui est protégée et ne bloque jamais le reste).
--
-- Préparé à partir de la base réelle (lecture seule, 31/10 au soir) : noms de tables, colonnes, règles RLS,
-- index et conseiller Supabase (51 alertes « auth_rls_initplan », 14 « unindexed_foreign_keys »).
--
-- Ce que fait ce script :
--  B2) prénom affiché TOUJOURS pris sur le profil par le serveur : discussion de groupe (group_messages),
--      carte en direct (ride_positions), playlists de groupe (group_tracks.added_by), et « author » des annonces
--      et bonnes adresses aussi quand on les MODIFIE (avant : seulement à la création). Le talkie
--      (talkie_messages.first_name) le faisait déjà (talkie.sql) ;
--  B3) sirène SOS : dans un groupe PUBLIC et OUVERT À TOUS, il faut être membre depuis plus de 24 h
--      (le chef, les groupes privés et les groupes « sur validation » ne sont pas concernés) ;
--      la date d'adhésion (joined_at) ne peut plus être truquée par le téléphone ;
--  B4) quotas par membre et par 24 h : 20 photos de bonnes adresses, 24 photos d'annonces (chaque photo = 2 fichiers,
--      la photo + sa miniature « -t.jpg »), 300 messages vocaux ;
--  B6) code ange gardien : 5 essais ratés par 15 minutes et 20 par 24 h au maximum, et possibilité de le changer ;
--  B7) effacements automatiques réels (pg_cron, toutes les 30 min) : positions en direct après 8 h, alertes SOS
--      et journal des sirènes après 7 jours, annonces expirées depuis plus de 7 jours (+ leurs photos et miniatures
--      mises dans la file mr_storage_purge) ;
--  B8) lien WhatsApp des groupes contrôlé par le serveur : vide ou https://chat.whatsapp.com/… ;
--  B9) règles RLS : auth.uid() remplacé par (select auth.uid()) (calculé une fois par requête au lieu d'une fois
--      par ligne), 14 index manquants sur les clés étrangères, et nettoyage de droits inutiles.
--
-- Depuis le 30/10, Supabase ne donne plus de droits automatiques : tous les GRANT / REVOKE sont écrits ici.
-- Messages d'erreur : en français, avec un préfixe technique « mr-… » que l'application peut reconnaître.

begin;

-- =====================================================================================
-- 0) VÉRIFICATION : les colonnes dont on a besoin existent bien (sinon message clair, rien n'est modifié)
-- =====================================================================================
do $$
declare
  need text[][] := array[
    ['profiles','first_name'], ['groups','owner_id'], ['groups','is_private'], ['groups','requires_approval'],
    ['groups','whatsapp_link'], ['group_members','joined_at'], ['group_members','status'],
    ['group_messages','first_name'], ['group_messages','user_id'], ['ride_positions','first_name'],
    ['ride_positions','updated_at'], ['group_tracks','added_by'], ['annonces','author'], ['annonces','photos'],
    ['annonces','expires_at'], ['places','author'], ['sos_alerts','client_id'], ['sos_push_log','at'],
    ['guardian_codes','code'], ['talkie_messages','user_id'], ['mr_storage_purge','bucket_id']];
  i int;
begin
  for i in 1 .. array_length(need, 1) loop
    if not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = need[i][1] and column_name = need[i][2]) then
      raise exception 'securite-31-10.sql : colonne manquante public.%.% (passe d''abord les scripts précédents, dont test-67.sql et talkie.sql). Rien n''a été modifié.',
        need[i][1], need[i][2];
    end if;
  end loop;
end $$;

-- Petite fonction commune : le prénom affiché d'un compte (celui du profil, sinon « Motard »), 40 caractères max.
create or replace function public.mr_display_name(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select left(coalesce((select nullif(btrim(p.first_name), '') from public.profiles p where p.id = p_user), 'Motard'), 40);
$$;
revoke all on function public.mr_display_name(uuid) from public, anon, authenticated;
grant execute on function public.mr_display_name(uuid) to service_role;

-- =====================================================================================
-- B2) PRÉNOM IMPOSÉ PAR LE SERVEUR
-- =====================================================================================

-- a) Discussion de groupe et carte en direct : l'auteur est le compte connecté, le prénom vient du profil.
--    (Sans compte connecté = SQL Editor ou fonction serveur : on garde user_id tel quel, mais le prénom vient
--    quand même du profil.)
create or replace function public.mr_force_first_name() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if uid is not null then new.user_id := uid; end if;
  else
    new.user_id := old.user_id;                       -- personne ne peut « déplacer » une ligne vers un autre compte
  end if;
  if new.user_id is null then
    raise exception 'mr-auteur-absent : impossible d''enregistrer sans compte connecté';
  end if;
  new.first_name := public.mr_display_name(new.user_id);
  if tg_table_name = 'ride_positions' then
    new.updated_at := now();                          -- heure du serveur : une position « dans le futur » échapperait à l'effacement après 8 h
  elsif tg_table_name = 'group_messages' and tg_op = 'INSERT' then
    new.created_at := now();
  end if;
  return new;
end $$;
revoke all on function public.mr_force_first_name() from public, anon, authenticated;

drop trigger if exists group_messages_first_name on public.group_messages;
create trigger group_messages_first_name before insert or update on public.group_messages
  for each row execute function public.mr_force_first_name();

drop trigger if exists ride_positions_first_name on public.ride_positions;
create trigger ride_positions_first_name before insert or update on public.ride_positions
  for each row execute function public.mr_force_first_name();

-- b) Playlists de groupe : « ajouté par … » = prénom du profil de l'auteur
create or replace function public.mr_track_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if uid is not null then new.user_id := uid; end if;
  else
    new.user_id := old.user_id;
  end if;
  if new.user_id is not null then new.added_by := public.mr_display_name(new.user_id); end if;
  return new;
end $$;
revoke all on function public.mr_track_guard() from public, anon, authenticated;

drop trigger if exists group_tracks_added_by on public.group_tracks;
create trigger group_tracks_added_by before insert or update on public.group_tracks
  for each row execute function public.mr_track_guard();

-- c) Annonces : à la MODIFICATION aussi, le propriétaire ne change pas, le prénom est celui de son profil, et le
--    téléphone ne peut plus remettre à zéro les signalements ni se « dé-masquer » tout seul.
--    Fonction « security invoker » (exprès) : current_user vaut alors « authenticated » pour une modification
--    venue directement de l'application, et « postgres » quand elle vient des fonctions serveur
--    (mr_annonce_report / mr_annonce_unhide), qui ne sont donc pas bloquées. L'app ne modifie que « sold » et
--    « expires_at », qui restent libres. Reprend l'ancienne fonction (date de mise à jour, expiration plafonnée à 60 jours).
create or replace function public.mr_annonce_before_update() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at := now();
  if new.expires_at > now() + interval '61 days' then new.expires_at := now() + interval '60 days'; end if;
  new.user_id := old.user_id;
  if current_user = 'authenticated' and not public.mr_is_admin() then
    -- (le propriétaire lit toujours son propre profil, règle profiles_select)
    new.author := coalesce((select nullif(btrim(p.first_name), '') from public.profiles p where p.id = new.user_id), old.author, '');
    new.reports := old.reports;
    new.hidden := old.hidden;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
revoke all on function public.mr_annonce_before_update() from public, anon, authenticated;

-- d) Bonnes adresses : même chose à la modification (avant, aucune vérification sur une modification)
create or replace function public.mr_place_before_update() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at := now();
  new.user_id := old.user_id;
  if current_user = 'authenticated' and not public.mr_is_admin() then
    new.author := coalesce((select nullif(btrim(p.first_name), '') from public.profiles p where p.id = new.user_id), old.author, '');
    new.likes := old.likes;            -- les 👍 passent par mr_place_like (rôle postgres), jamais en direct
    new.reports := old.reports;
    new.hidden := old.hidden;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
revoke all on function public.mr_place_before_update() from public, anon, authenticated;

drop trigger if exists places_before_update on public.places;
create trigger places_before_update before update on public.places
  for each row execute function public.mr_place_before_update();

-- Rappel : sur le talkie, talkie_messages.first_name est déjà imposé par mr_talkie_guard (talkie.sql). L'indication
-- « X parle » du direct passe par Realtime (broadcast/présence) : son contenu vient du téléphone et ne peut pas être
-- corrigé par un déclencheur SQL (voir compte rendu : à traiter dans l'app / la fonction « talkie »).

-- =====================================================================================
-- B3) SIRÈNE SOS : PAS DE SPAM DANS LES GROUPES PUBLICS
-- =====================================================================================

-- a) La date d'adhésion est fixée par le serveur (avant, le téléphone pouvait envoyer une date ancienne)
create or replace function public.mr_member_joined_at() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.joined_at := now();
  elsif auth.uid() is not null then
    new.joined_at := old.joined_at;   -- même le chef ne peut pas la changer depuis l'application
  end if;
  return new;
end $$;
revoke all on function public.mr_member_joined_at() from public, anon, authenticated;

drop trigger if exists group_members_joined_at on public.group_members;
create trigger group_members_joined_at before insert or update on public.group_members
  for each row execute function public.mr_member_joined_at();

-- b) Règle : un membre peut faire sonner un groupe si
--    - il en est le chef, OU
--    - le groupe est privé (entrée par code) ou « sur validation » (le chef a accepté), OU
--    - il est membre actif depuis plus de 24 h.
create or replace function public.mr_sos_can_alert(p_user uuid, p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.groups g where g.id = p_group and g.owner_id = p_user)
      or exists (select 1 from public.group_members m join public.groups g on g.id = m.group_id
                  where m.group_id = p_group and m.user_id = p_user
                    and coalesce(m.status, 'active') = 'active'
                    and (coalesce(g.is_private, false) or coalesce(g.requires_approval, false)
                         or coalesce(m.joined_at, '-infinity'::timestamptz) <= now() - interval '24 hours'));
$$;
revoke all on function public.mr_sos_can_alert(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mr_sos_can_alert(uuid, uuid) to service_role;

-- c) Liste des groupes qu'un motard peut faire sonner : À UTILISER PAR LA FONCTION SERVEUR « sos-push »
--    (c'est elle qui envoie la sirène, en lisant group_members avec la clé de service ; elle ne passe pas par
--    sos_alerts). Réservée au serveur.
create or replace function public.mr_sos_siren_groups(p_user uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.group_id from public.group_members m
   where m.user_id = p_user and coalesce(m.status, 'active') = 'active'
     and public.mr_sos_can_alert(p_user, m.group_id);
$$;
revoke all on function public.mr_sos_siren_groups(uuid) from public, anon, authenticated;
grant execute on function public.mr_sos_siren_groups(uuid) to service_role;

-- d) Garde-fou des alertes SOS (reprend test-67 à l'identique + la nouvelle règle).
--    Un groupe non autorisé est IGNORÉ sans erreur : l'app envoie tous les groupes d'un coup, et une erreur
--    bloquerait aussi l'alerte vers les groupes autorisés.
create or replace function public.mr_sos_alert_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n int;
  nm text;
begin
  if uid is not null then new.user_id := uid; end if;
  if new.user_id is null then raise exception 'mr-sos-sans-auteur : alerte sans compte connecté'; end if;

  if new.created_at is null or new.created_at > now() + interval '1 minute'
     or new.created_at < now() - interval '125 minutes' then
    new.created_at := now();
  end if;

  if new.client_id is not null and exists (
       select 1 from public.sos_alerts a
        where a.user_id = new.user_id and a.group_id = new.group_id and a.client_id = new.client_id) then
    return null;
  end if;

  -- 31/10 (B3) : groupe public ouvert à tous rejoint il y a moins de 24 h -> pas d'alerte vers ce groupe
  if uid is not null and not public.mr_sos_can_alert(new.user_id, new.group_id) then
    return null;
  end if;

  if uid is not null then
    select count(distinct coalesce(a.client_id::text, a.created_at::text)) into n
      from public.sos_alerts a
     where a.user_id = new.user_id and a.created_at > now() - interval '1 hour'
       and coalesce(a.client_id::text, a.created_at::text) is distinct from coalesce(new.client_id::text, new.created_at::text);
    if n >= 5 then raise exception 'mr-sos-trop : 5 alertes par heure au maximum'; end if;
  end if;

  select nullif(trim(p.first_name), '') into nm from public.profiles p where p.id = new.user_id;
  new.first_name := left(coalesce(nm, nullif(trim(new.first_name), ''), 'Motard'), 40);
  new.kind := case when new.kind = 'sos' then 'sos' else 'chute' end;
  new.msg := left(coalesce(new.msg, ''), 500);
  if new.lat is not null and (new.lat not between -90 and 90 or new.lng is null or new.lng not between -180 and 180) then
    new.lat := null; new.lng := null;
  end if;
  return new;
end $$;
revoke all on function public.mr_sos_alert_guard() from public, anon, authenticated;

drop trigger if exists sos_alert_guard on public.sos_alerts;
create trigger sos_alert_guard before insert on public.sos_alerts
  for each row execute function public.mr_sos_alert_guard();

-- =====================================================================================
-- B4) QUOTAS D'ENVOI PAR MEMBRE ET PAR 24 H (photos et messages vocaux)
-- =====================================================================================
-- Les valeurs sont regroupées ici pour être faciles à changer (nombre de FICHIERS : 1 photo = photo + miniature).
create or replace function public.mr_quota(p_kind text)
returns int language sql immutable set search_path = '' as $$
  select case p_kind
    when 'place-photos'   then 120   -- 60 photos = les 15 adresses/24 h permises, 4 photos chacune (photo + miniature)
    when 'annonce-photos' then 80    -- 40 photos = les 10 annonces/24 h permises, 4 photos chacune (photo + miniature)
    when 'talkie-audio'   then 320   -- fichiers vocaux (un peu de marge pour les envois ratés puis refaits)
    when 'talkie-msg'     then 300   -- messages vocaux (en plus de la limite de 60 par 10 minutes de talkie.sql)
    else 0 end;
$$;
revoke all on function public.mr_quota(text) from public, anon;
grant execute on function public.mr_quota(text) to authenticated, service_role;

-- a) Photos (bonnes adresses, annonces) : comptées dans le dossier du membre (<son identifiant>/…).
--    Lève une erreur claire au lieu du message anglais « row-level security ».
create or replace function public.mr_photo_quota_ok(p_bucket text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); lim int := public.mr_quota(p_bucket); n int;
begin
  if uid is null then return false; end if;
  if lim <= 0 then return true; end if;
  select count(*) into n from storage.objects o
   where o.bucket_id = p_bucket and o.name like uid::text || '/%'
     and o.created_at > now() - interval '24 hours';
  if n >= lim then
    raise exception 'mr-photos-trop : % photos par 24 heures au maximum pour ce type de publication. Réessaie demain.', lim / 2
      using errcode = 'P0001';
  end if;
  return true;
end $$;
revoke all on function public.mr_photo_quota_ok(text) from public, anon;
grant execute on function public.mr_photo_quota_ok(text) to authenticated, service_role;

-- Règles d'envoi des photos : identiques à avant (dossier à son nom) + quota
drop policy if exists place_photos_insert on storage.objects;
create policy place_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'place-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.mr_photo_quota_ok('place-photos'));

drop policy if exists annonce_photos_insert on storage.objects;
create policy annonce_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'annonce-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.mr_photo_quota_ok('annonce-photos'));

-- b) Fichiers vocaux (bucket privé talkie-audio)
create or replace function public.mr_voice_file_quota_ok()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); lim int := public.mr_quota('talkie-audio'); n int;
begin
  if uid is null then return false; end if;
  select count(*) into n from storage.objects o
   where o.bucket_id = 'talkie-audio' and o.owner_id = uid::text
     and o.created_at > now() - interval '24 hours';
  if n >= lim then
    raise exception 'mr-talkie-trop : % messages vocaux par jour au maximum. Réessaie demain.', public.mr_quota('talkie-msg')
      using errcode = 'P0001';
  end if;
  return true;
end $$;
revoke all on function public.mr_voice_file_quota_ok() from public, anon;
grant execute on function public.mr_voice_file_quota_ok() to authenticated, service_role;

drop policy if exists talkie_audio_insert on storage.objects;
create policy talkie_audio_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'talkie-audio'
    and public.mr_talkie_can_folder((storage.foldername(name))[1])
    and left(storage.filename(name), 37) = (select auth.uid())::text || '_'
    and public.mr_voice_file_quota_ok());

-- Lecture et effacement des fichiers vocaux : mêmes règles qu'avant, avec (select auth.uid())
drop policy if exists talkie_audio_select on storage.objects;
create policy talkie_audio_select on storage.objects for select to authenticated
  using (bucket_id = 'talkie-audio' and (
    owner_id = (select auth.uid())::text
    or exists (select 1 from public.talkie_messages m
                where m.path = name and m.expires_at > now() and public.mr_talkie_can(m.group_id, m.ride_id))));

drop policy if exists talkie_audio_delete on storage.objects;
create policy talkie_audio_delete on storage.objects for delete to authenticated
  using (bucket_id = 'talkie-audio' and owner_id = (select auth.uid())::text);

-- Effacement des photos : mêmes règles qu'avant, avec (select auth.uid())
drop policy if exists place_photos_delete on storage.objects;
create policy place_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'place-photos' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.mr_is_admin()));

drop policy if exists annonce_photos_delete on storage.objects;
create policy annonce_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'annonce-photos' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.mr_is_admin()));

-- c) Messages vocaux (lignes de talkie_messages) : 300 par 24 h et par membre.
--    Déclencheur séparé (le garde-fou mr_talkie_guard de talkie.sql n'est pas modifié) ; il passe avant lui
--    (ordre alphabétique : talkie_daily_quota < talkie_guard).
create or replace function public.mr_talkie_daily_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then return new; end if;
  select count(*) into n from public.talkie_messages x
   where x.user_id = uid and x.created_at > now() - interval '24 hours';
  if n >= public.mr_quota('talkie-msg') then
    raise exception 'mr-talkie-trop : % messages vocaux par jour au maximum. Réessaie demain.', public.mr_quota('talkie-msg');
  end if;
  return new;
end $$;
revoke all on function public.mr_talkie_daily_quota() from public, anon, authenticated;

drop trigger if exists talkie_daily_quota on public.talkie_messages;
create trigger talkie_daily_quota before insert on public.talkie_messages
  for each row execute function public.mr_talkie_daily_quota();

-- =====================================================================================
-- B6) CODE ANGE GARDIEN : ESSAIS LIMITÉS ET CODE MODIFIABLE
-- =====================================================================================
create table if not exists public.guardian_code_tries (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('fail', 'ok', 'reset')),
  at timestamptz not null default now()
);
create index if not exists guardian_code_tries_user_idx on public.guardian_code_tries (user_id, at desc);
alter table public.guardian_code_tries enable row level security;
-- Personne côté application (aucune règle RLS) : seulement les fonctions ci-dessous et le serveur.
revoke all on public.guardian_code_tries from public, anon, authenticated;
grant select, insert, update, delete on public.guardian_code_tries to service_role;
do $$
declare s text := pg_get_serial_sequence('public.guardian_code_tries', 'id');
begin
  execute format('revoke all on sequence %s from public, anon, authenticated', s);
  execute format('grant usage, select on sequence %s to service_role', s);
end $$;

-- Combien de minutes encore bloqué (0 = pas bloqué) : 5 essais ratés en 15 min -> 15 min ; 20 en 24 h -> jusqu'au lendemain
create or replace function public.mr_guard_locked_minutes(p_user uuid)
returns int language plpgsql stable security definer set search_path = '' as $$
declare n15 int; n24 int; t timestamptz;
begin
  select count(*) filter (where at > now() - interval '15 minutes'), count(*)
    into n15, n24
    from public.guardian_code_tries where user_id = p_user and kind = 'fail' and at > now() - interval '24 hours';
  if n24 >= 20 then
    select min(at) into t from (select at from public.guardian_code_tries
      where user_id = p_user and kind = 'fail' and at > now() - interval '24 hours' order by at desc limit 20) x;
    return greatest(1, ceil(extract(epoch from (t + interval '24 hours' - now())) / 60)::int);
  end if;
  if n15 >= 5 then
    select min(at) into t from (select at from public.guardian_code_tries
      where user_id = p_user and kind = 'fail' and at > now() - interval '15 minutes' order by at desc limit 5) x;
    return greatest(1, ceil(extract(epoch from (t + interval '15 minutes' - now())) / 60)::int);
  end if;
  return 0;
end $$;
revoke all on function public.mr_guard_locked_minutes(uuid) from public, anon, authenticated;
grant execute on function public.mr_guard_locked_minutes(uuid) to service_role;

-- NOUVELLE fonction à utiliser par l'app : ne lève PAS d'erreur pour un mauvais code (sinon l'essai raté serait
-- annulé avec la transaction et ne compterait pas). Réponse JSON :
--   {"ok":true,"name":"Karim"}
--   {"ok":false,"why":"code-inconnu","msg":"Code inconnu.","left":3}
--   {"ok":false,"why":"son-propre-code","msg":"…"}
--   {"ok":false,"why":"trop-essais","msg":"…","minutes":12}
create or replace function public.mr_guard_join_v2(p_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r uuid; c text := upper(btrim(coalesce(p_code, ''))); m int; n15 int;
begin
  if uid is null then raise exception 'non-connecte : connecte-toi pour veiller sur un motard'; end if;
  m := public.mr_guard_locked_minutes(uid);
  if m > 0 then
    return jsonb_build_object('ok', false, 'why', 'trop-essais', 'minutes', m,
      'msg', format('Trop d''essais avec un mauvais code. Réessaie dans %s minute(s).', m));
  end if;
  if c ~ '^[A-Z2-9]{6}$' then
    select g.rider_id into r from public.guardian_codes g where g.code = c;
  end if;
  if r is null then
    insert into public.guardian_code_tries (user_id, kind) values (uid, 'fail');
    select count(*) into n15 from public.guardian_code_tries
     where user_id = uid and kind = 'fail' and at > now() - interval '15 minutes';
    return jsonb_build_object('ok', false, 'why', 'code-inconnu', 'left', greatest(0, 5 - n15),
      'msg', 'Code inconnu. Vérifie les 6 caractères.');
  end if;
  if r = uid then
    return jsonb_build_object('ok', false, 'why', 'son-propre-code', 'msg', 'C''est ton propre code : donne-le à tes proches.');
  end if;
  insert into public.guardians (rider_id, guardian_id) values (r, uid) on conflict do nothing;
  insert into public.guardian_code_tries (user_id, kind) values (uid, 'ok');
  return jsonb_build_object('ok', true, 'name', public.mr_display_name(r));
end $$;
revoke all on function public.mr_guard_join_v2(text) from public, anon;
grant execute on function public.mr_guard_join_v2(text) to authenticated, service_role;

-- ANCIENNE fonction (encore appelée par l'app actuelle) : même comportement (erreurs « code-inconnu » /
-- « son-propre-code »), mais refusée si le compte est bloqué, et 1 seconde d'attente après un mauvais code.
-- Attention : avec elle, un essai raté ne peut pas être COMPTÉ (l'erreur annule tout). Dès que l'app utilise
-- mr_guard_join_v2, retirer l'ancienne : « revoke execute on function public.mr_guard_join(text) from authenticated; »
create or replace function public.mr_guard_join(p_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r uuid; m int;
begin
  if uid is null then raise exception 'non-connecte : connecte-toi pour veiller sur un motard'; end if;
  m := public.mr_guard_locked_minutes(uid);
  if m > 0 then raise exception 'trop-essais : réessaie dans % minute(s)', m; end if;
  select g.rider_id into r from public.guardian_codes g where g.code = upper(btrim(coalesce(p_code, '')));
  if r is null then
    perform pg_sleep(1);
    raise exception 'code-inconnu : vérifie les 6 caractères';
  end if;
  if r = uid then raise exception 'son-propre-code : donne ce code à tes proches'; end if;
  insert into public.guardians (rider_id, guardian_id) values (r, uid) on conflict do nothing;
  return public.mr_display_name(r);
end $$;
revoke all on function public.mr_guard_join(text) from public, anon;
grant execute on function public.mr_guard_join(text) to authenticated, service_role;

-- Changer son code (par exemple s'il a circulé). p_retirer_anges = true retire aussi tous ceux qui veillent
-- déjà sur moi (ils devront ressaisir le nouveau code). 3 changements par 24 h au maximum. Renvoie le nouveau code.
create or replace function public.mr_guard_code_reset(p_retirer_anges boolean default false)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := auth.uid(); n int; c text; i int := 0;
begin
  if uid is null then raise exception 'non-connecte : connecte-toi pour changer ton code'; end if;
  select count(*) into n from public.guardian_code_tries
   where user_id = uid and kind = 'reset' and at > now() - interval '24 hours';
  if n >= 3 then raise exception 'mr-code-trop : 3 changements de code par 24 heures au maximum. Réessaie demain.'; end if;
  loop
    i := i + 1;
    c := public.mr_rand_code(6);
    exit when not exists (select 1 from public.guardian_codes where code = c);
    if i > 20 then raise exception 'mr-code-indisponible : réessaie dans un instant'; end if;
  end loop;
  insert into public.guardian_codes (rider_id, code) values (uid, c)
  on conflict (rider_id) do update set code = excluded.code;
  if p_retirer_anges then delete from public.guardians where rider_id = uid; end if;
  insert into public.guardian_code_tries (user_id, kind) values (uid, 'reset');
  return c;
end $$;
revoke all on function public.mr_guard_code_reset(boolean) from public, anon;
grant execute on function public.mr_guard_code_reset(boolean) to authenticated, service_role;

-- =====================================================================================
-- B8) LIEN WHATSAPP DES GROUPES CONTRÔLÉ PAR LE SERVEUR
-- =====================================================================================
-- Message clair en français avant la contrainte (la contrainte reste comme filet de sécurité)
create or replace function public.mr_group_whatsapp_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.whatsapp_link := nullif(btrim(coalesce(new.whatsapp_link, '')), '');
  if new.whatsapp_link is not null and (char_length(new.whatsapp_link) > 200
     or new.whatsapp_link !~ '^https://chat\.whatsapp\.com/[A-Za-z0-9_-]{6,64}/?(\?[A-Za-z0-9=&._-]*)?$') then
    raise exception 'mr-whatsapp-lien : lien WhatsApp invalide. Il doit commencer par https://chat.whatsapp.com/ (lien d''invitation du groupe).'
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.mr_group_whatsapp_guard() from public, anon, authenticated;

drop trigger if exists groups_whatsapp_guard on public.groups;
create trigger groups_whatsapp_guard before insert or update of whatsapp_link on public.groups
  for each row execute function public.mr_group_whatsapp_guard();

-- Contrainte (remplace l'ancienne, qui acceptait n'importe quel lien https://). Ajoutée « not valid » puis
-- validée si les lignes existantes sont conformes (le 31/10 : aucun groupe n'a de lien).
alter table public.groups drop constraint if exists groups_whatsapp_link_check;
alter table public.groups add constraint groups_whatsapp_link_check check (
  whatsapp_link is null or whatsapp_link = ''
  or (char_length(whatsapp_link) <= 200
      and whatsapp_link ~ '^https://chat\.whatsapp\.com/[A-Za-z0-9_-]{6,64}/?(\?[A-Za-z0-9=&._-]*)?$')) not valid;
do $$
begin
  alter table public.groups validate constraint groups_whatsapp_link_check;
exception when check_violation then
  raise notice 'securite-31-10.sql : des groupes ont déjà un lien WhatsApp non conforme ; il reste affiché, mais tout nouveau lien est contrôlé.';
end $$;

-- =====================================================================================
-- B9) OPTIMISATION : (select auth.uid()) DANS LES RÈGLES, INDEX MANQUANTS, DROITS INUTILES
-- =====================================================================================

-- a) Toutes les règles RLS du schéma public qui appellent auth.uid() « nu » sont réécrites avec
--    (select auth.uid()) : même logique, mais calculé une seule fois par requête. Rejouable : une règle déjà
--    réécrite contient « SELECT auth.uid() » et n'est plus touchée.
do $$
declare
  p record; q text; c text; sql text; n int := 0;
  re constant text := '(?<!SELECT )auth\.uid\(\)';
begin
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies
            where schemaname = 'public'
              and (coalesce(qual, '') ~* re or coalesce(with_check, '') ~* re) loop
    q := regexp_replace(p.qual, re, '(select auth.uid())', 'gi');
    c := regexp_replace(p.with_check, re, '(select auth.uid())', 'gi');
    sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if q is not null then sql := sql || ' using (' || q || ')'; end if;
    if c is not null then sql := sql || ' with check (' || c || ')'; end if;
    execute sql;
    n := n + 1;
  end loop;
  raise notice 'securite-31-10.sql : % règles RLS réécrites avec (select auth.uid()).', n;
end $$;

-- b) Vitrines partenaires : la règle d'écriture « pour tout » (FOR ALL) doublait la règle de lecture
--    (alerte « multiple permissive policies »). Même droit, découpé par action, réservé aux comptes connectés.
drop policy if exists partners_admin_write on public.partners;
drop policy if exists partners_admin_insert on public.partners;
drop policy if exists partners_admin_update on public.partners;
drop policy if exists partners_admin_delete on public.partners;
create policy partners_admin_insert on public.partners for insert to authenticated with check (public.mr_is_admin());
create policy partners_admin_update on public.partners for update to authenticated
  using (public.mr_is_admin()) with check (public.mr_is_admin());
create policy partners_admin_delete on public.partners for delete to authenticated using (public.mr_is_admin());

-- c) Les 14 index manquants sur les clés étrangères (conseiller Supabase du 31/10)
create index if not exists annonce_reports_user_id_idx  on public.annonce_reports (user_id);
create index if not exists group_messages_user_id_idx   on public.group_messages (user_id);
create index if not exists group_tracks_user_id_idx     on public.group_tracks (user_id);
create index if not exists groups_owner_id_idx          on public.groups (owner_id);
create index if not exists guardians_guardian_id_idx    on public.guardians (guardian_id);
create index if not exists partner_requests_partner_idx on public.partner_requests (partner_id);
create index if not exists partner_requests_user_idx    on public.partner_requests (user_id);
create index if not exists partners_owner_id_idx        on public.partners (owner_id);
create index if not exists place_likes_user_id_idx      on public.place_likes (user_id);
create index if not exists place_reports_user_id_idx    on public.place_reports (user_id);
create index if not exists ride_participants_user_idx   on public.ride_participants (user_id);
create index if not exists ride_positions_user_id_idx   on public.ride_positions (user_id);
create index if not exists rides_creator_id_idx         on public.rides (creator_id);
create index if not exists talkie_usage_user_id_idx     on public.talkie_usage (user_id);
-- et deux index pour les effacements automatiques (section 7)
create index if not exists ride_positions_updated_idx   on public.ride_positions (updated_at);
create index if not exists annonces_expires_idx         on public.annonces (expires_at);

-- d) Fonctions de déclencheur : elles n'ont pas besoin d'être appelables depuis l'API (un déclencheur s'exécute
--    sans ce droit). On retire l'accès « authenticated » signalé par le conseiller.
revoke all on function public.mr_annonce_before_insert() from public, anon, authenticated;
revoke all on function public.mr_place_before_insert() from public, anon, authenticated;
revoke all on function public.mr_items_guard() from public, anon, authenticated;
grant execute on function public.mr_annonce_before_insert(), public.mr_place_before_insert(),
  public.mr_items_guard(), public.mr_annonce_before_update(), public.mr_place_before_update() to service_role;

-- =====================================================================================
-- B7) EFFACEMENTS AUTOMATIQUES RÉELS
-- =====================================================================================
-- Une seule fonction de ménage, lancée toutes les 30 minutes par pg_cron. Renvoie ce qui a été effacé.
-- Les fichiers ne peuvent pas être effacés en SQL (Supabase l'interdit) : les photos des annonces purgées sont
-- mises dans la file mr_storage_purge, vidée par la fonction serveur « delete-account » (voir la fin du fichier).
create or replace function public.mr_purge_auto()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare n_pos int; n_sos int; n_log int; n_ann int; n_files int; n_try int;
begin
  -- Positions de la carte en direct : 8 h au maximum
  delete from public.ride_positions where updated_at < now() - interval '8 hours';
  get diagnostics n_pos = row_count;

  -- Alertes SOS et journal des sirènes : 7 jours
  delete from public.sos_alerts where created_at < now() - interval '7 days';
  get diagnostics n_sos = row_count;
  delete from public.sos_push_log where at < now() - interval '7 days';
  get diagnostics n_log = row_count;

  -- Annonces expirées depuis plus de 7 jours (le vendeur a une semaine pour la prolonger) :
  -- d'abord leurs photos ET miniatures dans la file d'effacement, puis les lignes (signalements effacés en cascade)
  with old as (
    select a.id, a.photos from public.annonces a where a.expires_at < now() - interval '7 days'
  ), paths as (
    select split_part(split_part(u, '/annonce-photos/', 2), '?', 1) as p
      from old, unnest(old.photos) as u
     where u like '%/annonce-photos/%'
  ), all_paths as (
    select p from paths where p <> ''
    union
    select regexp_replace(p, '\.jpg$', '-t.jpg', 'i') from paths where p ~* '\.jpg$' and p !~* '-t\.jpg$'
  )
  insert into public.mr_storage_purge (bucket_id, name)
  select 'annonce-photos', p from all_paths
  on conflict (bucket_id, name) do nothing;
  get diagnostics n_files = row_count;
  delete from public.annonces where expires_at < now() - interval '7 days';
  get diagnostics n_ann = row_count;

  -- Journal des essais de code ange gardien : 7 jours
  delete from public.guardian_code_tries where at < now() - interval '7 days';
  get diagnostics n_try = row_count;

  return jsonb_build_object('positions', n_pos, 'alertes', n_sos, 'journal_sirenes', n_log,
                            'annonces', n_ann, 'fichiers_en_file', n_files, 'essais_code', n_try);
end $$;
revoke all on function public.mr_purge_auto() from public, anon, authenticated;
grant execute on function public.mr_purge_auto() to service_role;

-- Ancien ménage « à chaque nouvelle alerte » (sos-alertes.sql) : remplacé par mr_purge_auto, on le garde quand même
-- (il ne coûte presque rien et sert de secours si pg_cron n'est pas activé).

-- Planification avec pg_cron. Le 31/10, l'extension est DISPONIBLE mais PAS ENCORE ACTIVÉE sur le projet :
-- on essaie de l'activer ; si ce n'est pas permis, un message s'affiche et le reste du script s'applique quand même.
-- (Activation manuelle possible : Dashboard > Database > Extensions > pg_cron.)
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
      begin
        create extension if not exists pg_cron;
      exception when others then
        raise notice 'securite-31-10.sql : pg_cron n''a pas pu être activé ici (%). Active-le dans Dashboard > Database > Extensions puis relance ce script.', sqlerrm;
      end;
    else
      raise notice 'securite-31-10.sql : pg_cron n''est pas disponible sur ce projet. Le ménage peut être lancé à la main : select public.mr_purge_auto();';
    end if;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      -- cron.schedule avec un nom remplace la tâche du même nom : rejouable sans doublon
      execute $q$select cron.schedule('mr-purge-auto', '*/30 * * * *', 'select public.mr_purge_auto()')$q$;
      raise notice 'securite-31-10.sql : tâche « mr-purge-auto » planifiée toutes les 30 minutes.';
    exception when others then
      raise notice 'securite-31-10.sql : planification pg_cron impossible (%). Le ménage peut être lancé à la main : select public.mr_purge_auto();', sqlerrm;
    end;
  end if;
end $$;

commit;

-- =====================================================================================
-- VÉRIFICATIONS (facultatif, après « Run »)
-- =====================================================================================
-- select public.mr_purge_auto();                                    -- ménage immédiat, renvoie les nombres effacés
-- select jobname, schedule, command, active from cron.job;          -- la tâche « mr-purge-auto » doit apparaître
-- select tablename, policyname from pg_policies where schemaname = 'public'
--    and (qual ~ '(?<!SELECT )auth\.uid\(\)' or with_check ~ '(?<!SELECT )auth\.uid\(\)');   -- doit être vide
-- select tgname, tgrelid::regclass from pg_trigger where not tgisinternal and tgname in
--    ('group_messages_first_name','ride_positions_first_name','group_tracks_added_by','places_before_update',
--     'group_members_joined_at','talkie_daily_quota','groups_whatsapp_guard');

-- =====================================================================================
-- OPTIONNEL – vider aussi la file des photos automatiquement (pg_cron + pg_net), comme pour le talkie :
-- nécessite l'extension pg_net et la clé de service dans le coffre (Vault) sous le nom « purge_cron_key ».
-- À lancer à part :
--
--   select cron.schedule('mr-storage-purge', '41 * * * *', $$
--     select net.http_post(
--       url := 'https://ixtqlxltwuktpdznbhnx.supabase.co/functions/v1/delete-account',
--       headers := jsonb_build_object('Content-Type', 'application/json',
--                  'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'purge_cron_key')),
--       body := '{}'::jsonb) $$);
--
-- Sans cela, la file mr_storage_purge est vidée à la prochaine suppression de compte (ou par un appel manuel de
-- delete-account avec la clé service_role). Les annonces purgées ne sont de toute façon plus affichées.
