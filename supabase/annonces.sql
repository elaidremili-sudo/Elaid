-- MotoRoute – Annonces des membres sur le serveur + demandes de vitrine partenaire (24/10/2026, test-57)
-- Avant : les annonces (vente/achat de motos et pièces) restaient sur le téléphone de celui qui les publiait,
-- donc l'annonce de la GSX-R faite sur le compte d'Ali n'apparaissait pas sur le téléphone d'Elaid.
-- Maintenant : table « annonces » partagée, visible par tous les membres connectés, sans validation
-- (comme les Bonnes adresses). Garde-fous : « Signaler » (3 membres différents = annonce masquée),
-- l'auteur ou l'administrateur supprime, 10 annonces maximum par membre et par 24 h,
-- expiration automatique après 60 jours (l'auteur peut la prolonger), bouton « Vendu ».
-- Partenaires : un commerce peut DEMANDER sa vitrine depuis l'app (table partner_requests) ;
-- l'administrateur accepte → la vitrine est créée et le demandeur la gère tout de suite (plus besoin de code).
-- Rejouable sans risque.

-- ---------- Annonces ----------
create table if not exists public.annonces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  author text not null default '',
  ty text not null check (ty in ('sell','buy')),
  cat text not null check (cat in ('moto','part','gear')),
  title text not null check (char_length(btrim(title)) between 2 and 80),
  descr text not null default '' check (char_length(descr) <= 800),
  price bigint not null default 0 check (price >= 0 and price <= 100000000000),
  city text not null default '' check (char_length(city) <= 60),
  phone text not null default '' check (char_length(phone) <= 25),
  year int check (year is null or year between 1950 and 2100),
  km int check (km is null or km between 0 and 2000000),
  papers text not null default '' check (papers in ('','clean','issue','none')),
  papers_note text not null default '' check (char_length(papers_note) <= 300),
  photos text[] not null default '{}' check (cardinality(photos) <= 4),
  sold boolean not null default false,
  reports int not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 days'
);
create index if not exists annonces_recent on public.annonces (created_at desc);
create index if not exists annonces_user on public.annonces (user_id, created_at desc);
alter table public.annonces enable row level security;

drop policy if exists annonces_read on public.annonces;
create policy annonces_read on public.annonces for select to authenticated
  using ((not hidden and expires_at > now()) or user_id = auth.uid() or public.mr_is_admin());
drop policy if exists annonces_insert on public.annonces;
create policy annonces_insert on public.annonces for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists annonces_update on public.annonces;
create policy annonces_update on public.annonces for update to authenticated
  using (user_id = auth.uid() or public.mr_is_admin())
  with check (user_id = auth.uid() or public.mr_is_admin());
drop policy if exists annonces_delete on public.annonces;
create policy annonces_delete on public.annonces for delete to authenticated
  using (user_id = auth.uid() or public.mr_is_admin());

-- Droits explicites : les compteurs (reports, hidden) et l'auteur ne sont modifiables que par le serveur.
revoke all on public.annonces from anon, authenticated;
grant select, delete on public.annonces to authenticated;
grant insert (ty, cat, title, descr, price, city, phone, year, km, papers, papers_note, photos)
  on public.annonces to authenticated;
grant update (ty, cat, title, descr, price, city, phone, year, km, papers, papers_note, photos, sold, updated_at, expires_at)
  on public.annonces to authenticated;

create or replace function public.mr_annonce_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from annonces where user_id = new.user_id and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'Limite atteinte : 10 annonces par 24 h.' using errcode = 'P0001';
  end if;
  new.author := coalesce((select nullif(btrim(first_name), '') from profiles where id = new.user_id), '');
  new.reports := 0; new.hidden := false; new.sold := false;
  new.created_at := now(); new.updated_at := now(); new.expires_at := now() + interval '60 days';
  return new;
end $$;
drop trigger if exists annonces_before_insert on public.annonces;
create trigger annonces_before_insert before insert on public.annonces
  for each row execute function public.mr_annonce_before_insert();

-- Prolongation : 60 jours maximum à partir d'aujourd'hui (impossible de mettre une date lointaine)
create or replace function public.mr_annonce_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.expires_at > now() + interval '61 days' then new.expires_at := now() + interval '60 days'; end if;
  return new;
end $$;
drop trigger if exists annonces_before_update on public.annonces;
create trigger annonces_before_update before update on public.annonces
  for each row execute function public.mr_annonce_before_update();

-- ---------- Signalements (3 membres différents = annonce masquée) ----------
create table if not exists public.annonce_reports (
  annonce_id uuid not null references public.annonces on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  primary key (annonce_id, user_id)
);
alter table public.annonce_reports enable row level security;
drop policy if exists annonce_reports_read on public.annonce_reports;
create policy annonce_reports_read on public.annonce_reports for select to authenticated
  using (user_id = auth.uid() or public.mr_is_admin());
revoke all on public.annonce_reports from anon, authenticated;
grant select on public.annonce_reports to authenticated;

create or replace function public.mr_annonce_report(p_annonce uuid, p_reason text default '') returns json
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n int; h boolean;
begin
  if uid is null then raise exception 'Connexion requise'; end if;
  if exists (select 1 from annonces where id = p_annonce and user_id = uid) then
    raise exception 'Tu ne peux pas signaler ta propre annonce';
  end if;
  if not exists (select 1 from annonces where id = p_annonce and not hidden) then raise exception 'Annonce introuvable'; end if;
  insert into annonce_reports (annonce_id, user_id, reason) values (p_annonce, uid, left(coalesce(p_reason, ''), 200))
    on conflict (annonce_id, user_id) do nothing;
  select count(*) into n from annonce_reports where annonce_id = p_annonce;
  update annonces set reports = n, hidden = (n >= 3) where id = p_annonce returning hidden into h;
  return json_build_object('reports', n, 'hidden', h);
end $$;

create or replace function public.mr_annonce_unhide(p_annonce uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.mr_is_admin() then raise exception 'Réservé à l''administrateur'; end if;
  delete from annonce_reports where annonce_id = p_annonce;
  update annonces set reports = 0, hidden = false where id = p_annonce;
end $$;

revoke execute on function public.mr_annonce_report(uuid, text), public.mr_annonce_unhide(uuid),
  public.mr_annonce_before_insert(), public.mr_annonce_before_update() from public, anon;
grant execute on function public.mr_annonce_report(uuid, text), public.mr_annonce_unhide(uuid) to authenticated;

-- ---------- Photos des annonces (dossier = identifiant du membre) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('annonce-photos', 'annonce-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists annonce_photos_insert on storage.objects;
create policy annonce_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'annonce-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists annonce_photos_delete on storage.objects;
create policy annonce_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'annonce-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.mr_is_admin()));

-- ---------- Demandes de vitrine partenaire ----------
create table if not exists public.partner_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  shop text not null check (char_length(btrim(shop)) between 2 and 60),
  kind text not null default '' check (char_length(kind) <= 40),
  city text not null default '' check (char_length(city) <= 40),
  phone text not null default '' check (char_length(phone) <= 25),
  message text not null default '' check (char_length(message) <= 400),
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  note text not null default '' check (char_length(note) <= 200),
  partner_id text references public.partners on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists partner_requests_status on public.partner_requests (status, created_at desc);
alter table public.partner_requests enable row level security;
drop policy if exists partner_requests_read on public.partner_requests;
create policy partner_requests_read on public.partner_requests for select to authenticated
  using (user_id = auth.uid() or public.mr_is_admin());
revoke all on public.partner_requests from anon, authenticated;
grant select on public.partner_requests to authenticated;

-- Envoi d'une demande (une seule demande en attente par membre ; 3 par jour maximum)
create or replace function public.mr_partner_request(p_shop text, p_kind text, p_city text, p_phone text, p_message text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); rid uuid;
begin
  if uid is null then raise exception 'non-connecte'; end if;
  if exists (select 1 from partners where owner_id = uid) then raise exception 'deja-partenaire'; end if;
  if (select count(*) from partner_requests where user_id = uid and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'trop-de-demandes';
  end if;
  update partner_requests set status = 'rejected', note = 'Remplacée par une nouvelle demande', decided_at = now()
    where user_id = uid and status = 'pending';
  insert into partner_requests (user_id, shop, kind, city, phone, message)
  values (uid, left(btrim(p_shop), 60), left(btrim(coalesce(p_kind, '')), 40), left(btrim(coalesce(p_city, '')), 40),
          left(btrim(coalesce(p_phone, '')), 25), left(btrim(coalesce(p_message, '')), 400))
  returning id into rid;
  return rid;
end $$;

-- Administrateur : accepter (crée la vitrine, le demandeur en devient le gestionnaire) ou refuser
create or replace function public.mr_partner_request_decide(p_req uuid, ok boolean, p_note text default '')
returns json language plpgsql security definer set search_path = public as $$
declare r partner_requests; pid text; base text; i int := 1;
begin
  if not public.mr_is_admin() then raise exception 'Réservé à l''administrateur'; end if;
  select * into r from partner_requests where id = p_req for update;
  if not found or r.status <> 'pending' then raise exception 'Demande introuvable ou déjà traitée'; end if;
  if not ok then
    update partner_requests set status = 'rejected', note = left(coalesce(p_note, ''), 200), decided_at = now() where id = p_req;
    return json_build_object('ok', false);
  end if;
  base := nullif(trim(both '-' from regexp_replace(lower(translate(r.shop,
          'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ', 'aaaaaaceeeeiiiinooooouuuuyyaaaaaaceeeeiiiinooooouuuuy')),
          '[^a-z0-9]+', '-', 'g')), '');
  base := left(coalesce(base, 'partenaire'), 30); pid := base;
  while exists (select 1 from partners where id = pid) loop i := i + 1; pid := base || '-' || i; end loop;
  insert into partners (id, name, kind, city, phone, owner_id, active, sort)
  values (pid, r.shop, coalesce(nullif(r.kind, ''), 'Magasin moto'), r.city, r.phone, r.user_id, true,
          coalesce((select max(sort) from partners), 0) + 1);
  update partner_requests set status = 'accepted', partner_id = pid, note = left(coalesce(p_note, ''), 200), decided_at = now()
    where id = p_req;
  return json_build_object('ok', true, 'id', pid, 'name', r.shop);
end $$;

revoke execute on function public.mr_partner_request(text, text, text, text, text),
  public.mr_partner_request_decide(uuid, boolean, text) from public, anon;
grant execute on function public.mr_partner_request(text, text, text, text, text),
  public.mr_partner_request_decide(uuid, boolean, text) to authenticated;
