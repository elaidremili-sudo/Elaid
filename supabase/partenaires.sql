-- MotoRoute – Vitrines partenaires avec comptes partenaires et validation (22/10/2026, test-51)
-- Chaque partenaire (Simou Cycle, Planète Moto, Iyade Moto…) a un code d'accès : il l'entre dans MotoRoute
-- (Annonces → Espace annonceur) et devient gestionnaire de SA vitrine. Ses publications et ses changements
-- d'informations restent « en attente » jusqu'à la validation d'un administrateur (Elaid).

-- ---------- Administrateurs ----------
create table if not exists public.app_admins (user_id uuid primary key references auth.users on delete cascade);
alter table public.app_admins enable row level security;
insert into public.app_admins (user_id)
  select id from auth.users where email in ('elaidremili@gmail.com', 'elaidremilipro@gmail.com')
  on conflict do nothing;

create or replace function public.mr_is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from app_admins where user_id = auth.uid()) $$;

-- ---------- Partenaires ----------
create table if not exists public.partners (
  id text primary key,
  name text not null,
  kind text not null default 'Showroom moto',
  city text not null default '',
  about text not null default '',
  phone text not null default '',
  addr text not null default '',
  hours text not null default '',
  active boolean not null default true,
  sort int not null default 0,
  owner_id uuid references auth.users on delete set null,
  invite_code text unique not null default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)),
  pending jsonb,               -- changements d'informations proposés par le partenaire, en attente
  pending_at timestamptz,
  info_note text not null default '',
  created_at timestamptz not null default now()
);
alter table public.partners enable row level security;

create or replace function public.mr_partner_owner(pid text) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from partners where id = pid and owner_id = auth.uid()) $$;

drop policy if exists partners_read on public.partners;
create policy partners_read on public.partners for select
  using (active or owner_id = auth.uid() or public.mr_is_admin());
drop policy if exists partners_admin_write on public.partners;
create policy partners_admin_write on public.partners for all
  using (public.mr_is_admin()) with check (public.mr_is_admin());

-- le code d'accès n'est lisible par personne directement (seulement via mr_partner_admin_list)
revoke select on public.partners from anon, authenticated;
grant select (id, name, kind, city, about, phone, addr, hours, active, sort, owner_id, pending, pending_at, info_note, created_at)
  on public.partners to anon, authenticated;
grant insert, update, delete on public.partners to authenticated;

insert into public.partners (id, name, kind, city, phone, sort) values
  ('simou', 'Simou Cycle', 'Showroom moto', 'Alger', '+213550318368', 1),
  ('planete', 'Planète Moto', 'Showroom moto', 'Blida', '', 2),
  ('iyade', 'Iyade Moto', 'Showroom moto', 'Oran', '', 3)
on conflict (id) do nothing;

-- ---------- Publications ----------
create table if not exists public.partner_items (
  id uuid primary key default gen_random_uuid(),
  partner_id text not null references public.partners on delete cascade,
  kind text not null check (kind in ('promo', 'news', 'prod')),
  title text not null check (char_length(title) between 1 and 80),
  descr text not null default '' check (char_length(descr) <= 400),
  price int not null default 0,
  old_price int not null default 0,
  until date,
  img text not null default '',
  feat boolean not null default false,
  ex boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);
create index if not exists partner_items_pid on public.partner_items (partner_id, status);
alter table public.partner_items enable row level security;

drop policy if exists items_read on public.partner_items;
create policy items_read on public.partner_items for select using (
  (status = 'approved' and exists (select 1 from public.partners p where p.id = partner_id and p.active))
  or public.mr_partner_owner(partner_id) or public.mr_is_admin());
drop policy if exists items_insert on public.partner_items;
create policy items_insert on public.partner_items for insert to authenticated
  with check (public.mr_partner_owner(partner_id) or public.mr_is_admin());
drop policy if exists items_update on public.partner_items;
create policy items_update on public.partner_items for update to authenticated
  using (public.mr_partner_owner(partner_id) or public.mr_is_admin())
  with check (public.mr_partner_owner(partner_id) or public.mr_is_admin());
drop policy if exists items_delete on public.partner_items;
create policy items_delete on public.partner_items for delete to authenticated
  using (public.mr_partner_owner(partner_id) or public.mr_is_admin());

-- Règle de validation : un partenaire ne peut jamais publier directement.
-- Toute création ou modification de contenu par un partenaire repasse « en attente ».
-- Mettre / retirer « À la une » ne demande pas de nouvelle validation.
create or replace function public.mr_items_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare adm boolean := public.mr_is_admin();
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if adm then
      if new.status is null or new.status = 'pending' then new.status := 'approved'; new.decided_at := now(); new.decided_by := auth.uid(); end if;
    elsif auth.uid() is not null then  -- (sans utilisateur = script d'installation : on garde le statut donné)
      new.status := 'pending'; new.note := ''; new.decided_at := null; new.decided_by := null; new.ex := false;
    end if;
    return new;
  end if;
  -- UPDATE
  if new.partner_id <> old.partner_id then raise exception 'partenaire-fixe'; end if;
  if not adm then
    new.ex := old.ex; new.created_by := old.created_by; new.created_at := old.created_at;
    if (new.kind, new.title, new.descr, new.price, new.old_price, new.until, new.img)
       is distinct from (old.kind, old.title, old.descr, old.price, old.old_price, old.until, old.img) then
      new.status := 'pending'; new.note := ''; new.decided_at := null; new.decided_by := null;
    else
      new.status := old.status; new.note := old.note; new.decided_at := old.decided_at; new.decided_by := old.decided_by;
    end if;
  elsif new.status is distinct from old.status then
    new.decided_at := now(); new.decided_by := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists mr_items_guard on public.partner_items;
create trigger mr_items_guard before insert or update on public.partner_items
  for each row execute function public.mr_items_guard();

-- Exemples visibles tant que Simou n'a rien publié (marqués « Exemple », il peut les supprimer)
insert into public.partner_items (partner_id, kind, title, descr, price, old_price, until, feat, ex, status)
select 'simou', x.kind, x.title, x.descr, x.price, x.old_price, x.until, x.feat, true, 'approved'
from (values
  ('promo', 'Révision complète', 'Vidange, filtres, chaîne et freins contrôlés. Offre réservée aux membres MotoRoute.', 6500, 8500, (current_date + 14), true),
  ('news', 'Nouvel arrivage de casques', 'Casques intégraux et modulables homologués, toutes tailles.', 0, 0, null::date, true),
  ('prod', 'Gants été ventilés', '', 4500, 0, null::date, false),
  ('prod', 'Kit chaîne + pignons', '', 12000, 0, null::date, false)
) as x(kind, title, descr, price, old_price, until, feat)
where not exists (select 1 from public.partner_items where partner_id = 'simou');

-- ---------- Statistiques (vues, appels, WhatsApp, itinéraires, « intéressé ») ----------
create table if not exists public.partner_events (
  id bigint generated always as identity primary key,
  partner_id text not null references public.partners on delete cascade,
  kind text not null check (kind in ('view', 'call', 'wa', 'route', 'int')),
  item_id uuid,
  user_id uuid default auth.uid(),
  at timestamptz not null default now()
);
create index if not exists partner_events_pid on public.partner_events (partner_id, at);
alter table public.partner_events enable row level security;
drop policy if exists events_insert on public.partner_events;
create policy events_insert on public.partner_events for insert to authenticated with check (user_id = auth.uid());

create or replace function public.mr_partner_stats(pid text) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.mr_partner_owner(pid) or public.mr_is_admin()) then raise exception 'interdit'; end if;
  return (select json_build_object(
    'views', count(*) filter (where kind = 'view'), 'call', count(*) filter (where kind = 'call'),
    'wa', count(*) filter (where kind = 'wa'), 'route', count(*) filter (where kind = 'route'),
    'int', count(*) filter (where kind = 'int'),
    'views30', count(*) filter (where kind = 'view' and at > now() - interval '30 days'),
    'people', count(distinct user_id))
    from partner_events where partner_id = pid);
end $$;

-- ---------- Accès partenaire par code ----------
create or replace function public.mr_partner_claim(p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare p partners;
begin
  if auth.uid() is null then raise exception 'non-connecte'; end if;
  select * into p from partners where invite_code = upper(trim(p_code));
  if not found then raise exception 'code-inconnu'; end if;
  if p.owner_id is not null and p.owner_id <> auth.uid() then raise exception 'deja-pris'; end if;
  update partners set owner_id = auth.uid() where id = p.id;
  return json_build_object('id', p.id, 'name', p.name);
end $$;

-- Le partenaire propose de nouvelles informations (présentation, téléphone, adresse, horaires) : en attente
create or replace function public.mr_partner_submit_info(pid text, info jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare clean jsonb;
begin
  if not (public.mr_partner_owner(pid) or public.mr_is_admin()) then raise exception 'interdit'; end if;
  clean := jsonb_build_object(
    'about', left(coalesce(info->>'about', ''), 600), 'phone', left(coalesce(info->>'phone', ''), 30),
    'addr', left(coalesce(info->>'addr', ''), 160), 'hours', left(coalesce(info->>'hours', ''), 80));
  if public.mr_is_admin() then
    update partners set about = clean->>'about', phone = clean->>'phone', addr = clean->>'addr', hours = clean->>'hours',
      pending = null, pending_at = null, info_note = '' where id = pid;
  else
    update partners set pending = clean, pending_at = now(), info_note = '' where id = pid;
  end if;
end $$;

-- Décision de l'administrateur sur les informations proposées
create or replace function public.mr_partner_info_decide(pid text, ok boolean, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.mr_is_admin() then raise exception 'interdit'; end if;
  if ok then
    update partners set about = coalesce(pending->>'about', about), phone = coalesce(pending->>'phone', phone),
      addr = coalesce(pending->>'addr', addr), hours = coalesce(pending->>'hours', hours),
      pending = null, pending_at = null, info_note = '' where id = pid;
  else
    update partners set pending = null, pending_at = null, info_note = left(coalesce(p_note, ''), 200) where id = pid;
  end if;
end $$;

-- Tableau de bord administrateur : codes, gestionnaire, publications en attente
create or replace function public.mr_partner_admin_list() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.mr_is_admin() then raise exception 'interdit'; end if;
  return coalesce((select json_agg(x order by x.sort) from (
    select p.id, p.name, p.city, p.active, p.sort, p.invite_code, p.owner_id,
      (select first_name from profiles where id = p.owner_id) as owner_name,
      (select count(*) from partner_items i where i.partner_id = p.id and i.status = 'pending') as pending_items,
      (p.pending is not null) as pending_info
    from partners p) x), '[]'::json);
end $$;

-- Nouveau code (par exemple si le partenaire change de téléphone ou de gérant) ; retire le gestionnaire actuel
create or replace function public.mr_partner_reset_code(pid text) returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.mr_is_admin() then raise exception 'interdit'; end if;
  c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  update partners set invite_code = c, owner_id = null where id = pid;
  return c;
end $$;

revoke execute on function public.mr_partner_stats(text), public.mr_partner_claim(text), public.mr_partner_submit_info(text, jsonb),
  public.mr_partner_info_decide(text, boolean, text), public.mr_partner_admin_list(), public.mr_partner_reset_code(text) from anon;

-- ---------- Photos des publications ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('partner-photos', 'partner-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists partner_photos_insert on storage.objects;
create policy partner_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'partner-photos' and (public.mr_is_admin() or public.mr_partner_owner((storage.foldername(name))[1])));
drop policy if exists partner_photos_delete on storage.objects;
create policy partner_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'partner-photos' and (public.mr_is_admin() or public.mr_partner_owner((storage.foldername(name))[1])));
