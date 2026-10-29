-- MotoRoute – test-67 (29/10/2026) : sécurité des alertes SOS et suppression complète du compte
-- À coller dans Supabase > SQL Editor, puis « Run ». Rejouable sans risque (tout est « if not exists » /
-- « create or replace » / « drop … if exists »). Tout passe en une seule transaction : si une ligne
-- échoue, rien n'est changé.
--
-- 1) Alertes SOS aux groupes (table sos_alerts) :
--    - l'expéditeur est TOUJOURS le compte connecté (user_id forcé à auth.uid()), le prénom affiché vient
--      de son profil (on ne peut plus envoyer une « chute » au nom d'un autre) ;
--    - identifiant d'alerte client_id : une alerte renvoyée par la file d'attente du téléphone n'est
--      jamais enregistrée deux fois ;
--    - 5 alertes au maximum par heure et par motard (une alerte = tous ses groupes d'un coup) ;
--    - plus de modification ni de vidage de la table depuis l'application.
-- 2) Journal des sirènes (sos_push_log) : identifiant d'alerte pour que la fonction sos-push
--    ne fasse pas sonner deux fois les mêmes téléphones.
-- 3) « Supprimer mon compte » : efface aussi les photos (Bonnes adresses, annonces, vitrines) et
--    les lignes qui y renvoient. Les fichiers eux-mêmes sont effacés par la fonction serveur
--    « delete-account » (Supabase interdit de les effacer en SQL) : le SQL les met dans une file
--    mr_storage_purge que cette fonction vide.

begin;

-- =====================================================================================
-- 0) VILLE DU GROUPE (l'app l'envoyait mais la colonne n'existait pas)
-- =====================================================================================
alter table public.groups add column if not exists city text;

-- =====================================================================================
-- 1) ALERTES SOS AUX GROUPES
-- =====================================================================================

-- Identifiant d'alerte créé par le téléphone (le même pour tous les groupes d'une alerte)
alter table public.sos_alerts add column if not exists client_id uuid;

-- Filet de sécurité anti-doublon (même motard, même groupe, même alerte)
create unique index if not exists sos_alerts_client_uniq
  on public.sos_alerts (user_id, group_id, client_id) where client_id is not null;
-- Pour compter vite les alertes de la dernière heure
create index if not exists sos_alerts_user_time_idx on public.sos_alerts (user_id, created_at desc);

create or replace function public.mr_sos_alert_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n int;
  nm text;
begin
  -- Connecté depuis l'application : l'auteur est forcé au compte connecté, jamais au nom d'un autre.
  -- (Le rôle « anon » n'a pas le droit d'écrire ; sans compte = serveur ou SQL Editor, qui doit donner user_id.)
  if uid is not null then new.user_id := uid; end if;
  if new.user_id is null then raise exception 'mr-sos-sans-auteur'; end if;

  -- Heure : celle du téléphone si l'alerte a attendu dans la file (réseau coupé), mais seulement
  -- dans la fenêtre de 2 h de la file ; sinon l'heure du serveur
  if new.created_at is null or new.created_at > now() + interval '1 minute'
     or new.created_at < now() - interval '125 minutes' then
    new.created_at := now();
  end if;

  -- Renvoi d'une alerte déjà reçue : on l'ignore sans erreur (la ligne n'est pas ajoutée)
  if new.client_id is not null and exists (
       select 1 from public.sos_alerts a
        where a.user_id = new.user_id and a.group_id = new.group_id and a.client_id = new.client_id) then
    return null;
  end if;

  -- Limite : 5 alertes par heure (les lignes d'une même alerte vers plusieurs groupes comptent pour 1)
  if uid is not null then
    select count(distinct coalesce(a.client_id::text, a.created_at::text)) into n
      from public.sos_alerts a
     where a.user_id = new.user_id and a.created_at > now() - interval '1 hour'
       and coalesce(a.client_id::text, a.created_at::text) is distinct from coalesce(new.client_id::text, new.created_at::text);
    if n >= 5 then raise exception 'mr-sos-trop : 5 alertes par heure au maximum'; end if;
  end if;

  -- Prénom affiché chez les autres : celui du profil (le texte envoyé par le téléphone ne compte plus)
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

-- Règle d'envoi stricte (inchangée sur le fond, réécrite pour être sûre qu'elle est en place)
drop policy if exists sos_insert on public.sos_alerts;
create policy sos_insert on public.sos_alerts for insert to authenticated
  with check (user_id = auth.uid() and exists (
    select 1 from public.group_members m
     where m.group_id = sos_alerts.group_id and m.user_id = auth.uid() and coalesce(m.status, 'active') = 'active'));

-- Droits : lire, envoyer, effacer ses alertes (annulation d'une fausse alerte). Plus de modification
-- ni de TRUNCATE (le vidage de table n'est pas protégé par les règles RLS).
revoke all on public.sos_alerts from anon, authenticated;
grant select, insert, delete on public.sos_alerts to authenticated;
grant all on public.sos_alerts to service_role;

-- =====================================================================================
-- 2) JOURNAL DES SIRÈNES (fonction sos-push)
-- =====================================================================================
alter table public.sos_push_log add column if not exists client_id uuid;
alter table public.sos_push_log add column if not exists recipients int;
alter table public.sos_push_log add column if not exists done boolean not null default true;
create unique index if not exists sos_push_log_client_uniq
  on public.sos_push_log (user_id, client_id) where client_id is not null;
-- Lu et écrit seulement par le serveur
revoke all on public.sos_push_log from anon, authenticated;
grant all on public.sos_push_log to service_role;
revoke all on sequence public.sos_push_log_id_seq from anon, authenticated;
grant usage, select on sequence public.sos_push_log_id_seq to service_role;

-- =====================================================================================
-- 3) SUPPRESSION DU COMPTE : PHOTOS ET LIGNES QUI LES RÉFÉRENCENT
-- =====================================================================================

-- File des fichiers à effacer du stockage (vidée par la fonction serveur « delete-account »)
create table if not exists public.mr_storage_purge (
  id bigint generated always as identity primary key,
  bucket_id text not null,
  name text not null,
  queued_at timestamptz not null default now(),
  tries int not null default 0,
  last_error text
);
create unique index if not exists mr_storage_purge_uniq on public.mr_storage_purge (bucket_id, name);
alter table public.mr_storage_purge enable row level security;
-- Depuis le 30/10, Supabase ne donne plus de droits automatiques : on les écrit ici.
-- Personne côté application ; seulement le serveur.
revoke all on public.mr_storage_purge from public, anon, authenticated;
grant select, insert, update, delete on public.mr_storage_purge to service_role;
do $$
declare s text := pg_get_serial_sequence('public.mr_storage_purge', 'id');
begin
  execute format('revoke all on sequence %s from public, anon, authenticated', s);
  execute format('grant usage, select on sequence %s to service_role', s);
end $$;

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r record; pl uuid[]; an uuid[];
begin
  if uid is null then raise exception 'Connexion requise.'; end if;

  -- a) Photos de l'utilisateur à effacer du stockage :
  --    Bonnes adresses et annonces : rangées dans un dossier à son nom (uid/…) ;
  --    vitrines partenaires : rangées au nom de la vitrine, on prend celles qu'il a envoyées (owner_id).
  insert into public.mr_storage_purge (bucket_id, name)
  select o.bucket_id, o.name from storage.objects o
   where o.name is not null and (
         (o.bucket_id in ('place-photos', 'annonce-photos')
            and ((storage.foldername(o.name))[1] = uid::text or o.owner_id = uid::text or o.owner = uid))
      or (o.bucket_id = 'partner-photos' and (o.owner_id = uid::text or o.owner = uid)))
  on conflict (bucket_id, name) do nothing;

  -- b) Lignes qui affichent ces photos
  --    vitrines : l'article garde son texte mais perd la photo (et repasse en validation si besoin)
  update public.partner_items i set img = ''
   where i.img <> '' and exists (
     select 1 from public.mr_storage_purge q
      where q.bucket_id = 'partner-photos' and i.img like '%/partner-photos/' || q.name);
  delete from public.places where user_id = uid;
  delete from public.annonces where user_id = uid;
  delete from public.partner_requests where user_id = uid;

  -- c) Ses « j'aime » et signalements sur les adresses / annonces des autres : on les retire
  --    et on recalcule les compteurs de ces adresses / annonces
  pl := array(select place_id from public.place_likes where user_id = uid
               union select place_id from public.place_reports where user_id = uid);
  an := array(select annonce_id from public.annonce_reports where user_id = uid);
  delete from public.place_likes where user_id = uid;
  delete from public.place_reports where user_id = uid;
  delete from public.annonce_reports where user_id = uid;
  update public.places p set
    likes = (select count(*) from public.place_likes l where l.place_id = p.id),
    reports = (select count(*) from public.place_reports x where x.place_id = p.id)
   where p.id = any(pl);
  update public.annonces a set reports = (select count(*) from public.annonce_reports x where x.annonce_id = a.id)
   where a.id = any(an);

  -- d) Statistiques des vitrines : on garde le nombre de visites mais plus le compte (anonymisé)
  update public.partner_events set user_id = null where user_id = uid;

  -- e) Groupes, sorties, positions, messages (comme avant)
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

  -- f) SOS, sirènes, anges gardiens, trajets, musique, parrainage
  delete from public.sos_alerts where user_id = uid;
  delete from public.sos_push_log where user_id = uid;
  delete from public.push_tokens where user_id = uid;
  delete from public.guardians where rider_id = uid or guardian_id = uid;
  delete from public.guardian_codes where rider_id = uid;
  delete from public.trajets where user_id = uid;
  delete from public.group_tracks where user_id = uid;
  delete from public.referrals where referred_id = uid;
  update public.partners set owner_id = null where owner_id = uid;

  -- g) Fiche d'urgence, profil, compte
  delete from public.emergency_cards where user_id::text = uid::text;
  delete from public.profiles where id::text = uid::text;
  delete from auth.users where id = uid;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

commit;

-- Vérification (facultatif, après « Run ») :
-- select tgname from pg_trigger where tgrelid = 'public.sos_alerts'::regclass and not tgisinternal;
-- select column_name from information_schema.columns where table_name in ('sos_alerts','sos_push_log') and column_name in ('client_id','recipients','done');
-- select count(*) from public.mr_storage_purge;   -- doit revenir à 0 après chaque suppression de compte
