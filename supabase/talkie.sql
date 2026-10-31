-- MotoRoute : TALKIE-WALKIE de groupe (push-to-talk) – 29/10/2026
-- À coller UNE FOIS dans Supabase > SQL Editor, puis « Run ». Rejouable sans risque :
-- tout est « if not exists » / « create or replace » / « drop … if exists », et tout passe en UNE SEULE
-- transaction : si une ligne échoue, rien n'est changé.
--
-- Ce que fait ce script :
--  1) un canal par groupe ET par sortie, réservé aux membres actifs du groupe / participants de la sortie ;
--  2) table talkie_messages : les « messages vocaux instantanés » (mode B, repli du direct) ;
--  3) bucket Storage PRIVÉ « talkie-audio » (dossier = identifiant du groupe ou de la sortie) ;
--  4) règles d'accès Realtime (qui parle / présence) : seulement les membres du canal ;
--  5) table talkie_live : sessions du direct Cloudflare (lue/écrite seulement par la fonction serveur « talkie ») ;
--  6) limite anti-abus : 60 messages par 10 minutes et par membre ; message de 30 s au maximum.
--
-- EFFACEMENT AUTOMATIQUE APRÈS 24 H (deux niveaux, voir aussi la fin du fichier) :
--  a) « logique » : dès 24 h, la ligne et le fichier deviennent ILLISIBLES pour tout le monde (règles RLS
--     sur expires_at). Cela ne dépend d'aucune tâche planifiée ;
--  b) « physique » : la fonction serveur « talkie » (action purge) efface les fichiers via l'API Storage
--     (Supabase interdit d'effacer un fichier en SQL) puis les lignes. Elle est lancée par les téléphones
--     (au plus 1 fois par 30 min chacun, à l'ouverture du canal) et, si tu le veux, par pg_cron (bloc optionnel
--     tout en bas, en commentaire).
--
-- Depuis le 30/10, Supabase ne donne plus de droits automatiques : tous les GRANT / REVOKE sont écrits ici.
-- Les tables existantes ayant des droits très larges pour « anon », on le retire TOUJOURS explicitement.

begin;

-- =====================================================================================
-- 0) VÉRIFICATION : les colonnes dont on a besoin existent bien (sinon message clair, rien n'est modifié)
-- =====================================================================================
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

-- =====================================================================================
-- 1) QUI A LE DROIT D'ENTRER DANS UN CANAL ?
-- =====================================================================================
-- Un canal = un groupe (membre actif ou chef) OU une sortie (participant ou créateur).
-- security definer : la fonction lit group_members / ride_participants quelles que soient leurs propres règles.
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

-- Dossier du bucket (= identifiant du groupe ou de la sortie, texte) : on teste les deux sens
create or replace function public.mr_talkie_can_folder(p_folder text)
returns boolean language sql stable security definer set search_path = public as $$
  select case when p_folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then public.mr_talkie_can(p_folder::uuid, p_folder::uuid)
              else false end;
$$;

-- Sujet Realtime « talkie:g:<uuid> » (groupe) ou « talkie:r:<uuid> » (sortie)
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

-- =====================================================================================
-- 2) MESSAGES VOCAUX (mode B)
-- =====================================================================================
create table if not exists public.talkie_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid,                                            -- canal « groupe »
  ride_id uuid,                                             -- canal « sortie » (l'un OU l'autre)
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  first_name text,                                          -- prénom affiché (pris sur le profil par le serveur)
  path text not null,                                       -- fichier dans le bucket : <group_id|ride_id>/<user_id>_<heure>.<ext>
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

-- Garde-fou à chaque envoi : l'auteur est TOUJOURS le compte connecté, prénom pris sur son profil,
-- chemin de fichier obligatoirement dans le dossier du canal ET au nom de l'auteur, 30 s max,
-- 60 messages par 10 minutes, durée de vie 24 h imposée par le serveur.
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

  -- Chemin : <canal>/<auteur>_quelquechose, sans « .. »
  if chan is null or new.path is null or new.path like '%..%'
     or split_part(new.path, '/', 1) <> chan::text
     or split_part(new.path, '/', 3) <> ''
     or left(split_part(new.path, '/', 2), 37) <> new.user_id::text || '_' then
    raise exception 'mr-talkie-chemin : le fichier doit être rangé dans le dossier du canal, au nom de l''auteur';
  end if;

  -- Format audio accepté
  new.mime := lower(split_part(coalesce(new.mime, ''), ';', 1));
  if new.mime not in ('audio/webm', 'audio/mp4', 'audio/ogg', 'audio/aac', 'audio/mpeg') then
    raise exception 'mr-talkie-format : format audio non accepté (%)', new.mime;
  end if;

  -- 30 s au maximum (marge de 1 s)
  new.duration_ms := least(greatest(coalesce(new.duration_ms, 0), 0), 31000);

  -- Anti-abus : 60 messages par 10 minutes et par membre
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

-- Droits : un membre lit (24 h) et envoie ; personne ne modifie ni n'efface depuis l'application
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

-- Temps réel : les membres reçoivent le message tout de suite (postgres_changes, filtré par les règles ci-dessus)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'talkie_messages') then
    execute 'alter publication supabase_realtime add table public.talkie_messages';
  end if;
end $$;

-- =====================================================================================
-- 3) BUCKET PRIVÉ « talkie-audio » (dossier = identifiant du groupe ou de la sortie)
-- =====================================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('talkie-audio', 'talkie-audio', false, 1048576,
        array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/aac', 'audio/mpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 1048576,
      allowed_mime_types = array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/aac', 'audio/mpeg'];

-- Envoyer : seulement dans le dossier d'un canal dont on est membre, avec un nom de fichier commençant par son identifiant
drop policy if exists talkie_audio_insert on storage.objects;
create policy talkie_audio_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'talkie-audio'
    and public.mr_talkie_can_folder((storage.foldername(name))[1])
    and left(storage.filename(name), 37) = auth.uid()::text || '_');

-- Lire : ses propres fichiers, ou ceux d'un message encore valable (< 24 h) d'un canal dont on est membre
drop policy if exists talkie_audio_select on storage.objects;
create policy talkie_audio_select on storage.objects for select to authenticated
  using (bucket_id = 'talkie-audio' and (
    owner_id = auth.uid()::text
    or exists (select 1 from public.talkie_messages m
                where m.path = name and m.expires_at > now() and public.mr_talkie_can(m.group_id, m.ride_id))));

-- Effacer : seulement son propre fichier (si l'envoi de la ligne a échoué, le téléphone nettoie)
drop policy if exists talkie_audio_delete on storage.objects;
create policy talkie_audio_delete on storage.objects for delete to authenticated
  using (bucket_id = 'talkie-audio' and owner_id = auth.uid()::text);

-- =====================================================================================
-- 4) REALTIME PRIVÉ : « qui parle » (broadcast) et « qui est là » (présence) réservés aux membres
-- =====================================================================================
-- Si ta base n'autorise pas la création de ces règles, le reste du script s'applique quand même et l'application
-- se contente des messages vocaux (mode B) sans l'indicateur « qui parle » en direct.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists talkie_rt_select on realtime.messages';
    execute 'create policy talkie_rt_select on realtime.messages for select to authenticated
             using (realtime.messages.extension in (''broadcast'', ''presence'') and public.mr_talkie_can_topic(realtime.topic()))';
    execute 'drop policy if exists talkie_rt_insert on realtime.messages';
    execute 'create policy talkie_rt_insert on realtime.messages for insert to authenticated
             with check (realtime.messages.extension in (''broadcast'', ''presence'') and public.mr_talkie_can_topic(realtime.topic()))';
  end if;
exception when others then
  raise notice 'talkie.sql : règles Realtime non créées (%). Le mode « messages vocaux » fonctionne quand même.', sqlerrm;
end $$;

-- =====================================================================================
-- 5) SESSIONS DU DIRECT CLOUDFLARE (mode A) : réservé à la fonction serveur « talkie »
-- =====================================================================================
create table if not exists public.talkie_live (
  session_id text primary key,                 -- identifiant de session renvoyé par Cloudflare Realtime SFU
  channel text not null,                       -- « g:<uuid> » ou « r:<uuid> »
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists talkie_live_user_idx on public.talkie_live (user_id, created_at desc);
create index if not exists talkie_live_chan_idx on public.talkie_live (channel, created_at desc);
alter table public.talkie_live enable row level security;
revoke all on public.talkie_live from public, anon, authenticated;
grant all on public.talkie_live to service_role;

commit;

-- =====================================================================================
-- OPTIONNEL – effacement physique planifié (pg_cron + pg_net), SEULEMENT si ces deux extensions sont activées
-- (Dashboard > Database > Extensions) et si tu mets la clé de service dans le coffre (Vault). À lancer à part :
--
--   select cron.schedule('talkie-purge', '17 * * * *', $$
--     select net.http_post(
--       url := 'https://ixtqlxltwuktpdznbhnx.supabase.co/functions/v1/talkie',
--       headers := jsonb_build_object('Content-Type', 'application/json',
--                  'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'talkie_cron_key')),
--       body := '{"action":"purge"}'::jsonb) $$);
--
-- Sans cela, la purge physique se fait quand les téléphones ouvrent un canal (voir plus haut) ; entre-temps les
-- messages restent illisibles dès 24 h.
