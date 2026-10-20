-- MotoRoute : alertes sonores d'urgence (notifications) et « anges gardiens » – 20/10/2026
-- Déjà appliqué par Claude via le connecteur Supabase. Peut être relancé sans risque.

-- 1) Jeton de notification de chaque téléphone (un par compte, le dernier connu)
create table if not exists public.push_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text not null check (char_length(token) between 20 and 4096),
  lang text not null default 'fr' check (lang in ('fr','ar','en')),
  updated_at timestamptz not null default now()
);
alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon;
grant select, insert, update, delete on public.push_tokens to authenticated;
drop policy if exists pt_own on public.push_tokens;
create policy pt_own on public.push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2) Code personnel à partager avec ses proches
create table if not exists public.guardian_codes (
  rider_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z2-9]{6}$')
);
alter table public.guardian_codes enable row level security;
revoke all on public.guardian_codes from anon, authenticated;

-- 3) Qui veille sur qui
create table if not exists public.guardians (
  rider_id uuid not null references auth.users(id) on delete cascade,
  guardian_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (rider_id, guardian_id),
  check (rider_id <> guardian_id)
);
alter table public.guardians enable row level security;
revoke all on public.guardians from anon;
grant select, delete on public.guardians to authenticated;
drop policy if exists g_select on public.guardians;
create policy g_select on public.guardians for select to authenticated
  using (rider_id = auth.uid() or guardian_id = auth.uid());
drop policy if exists g_delete on public.guardians;
create policy g_delete on public.guardians for delete to authenticated
  using (rider_id = auth.uid() or guardian_id = auth.uid());

-- Mon code (créé au premier appel)
create or replace function public.mr_my_guard_code() returns text
language plpgsql security definer set search_path = public as $$
declare c text; a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if auth.uid() is null then raise exception 'non-connecte'; end if;
  select code into c from guardian_codes where rider_id = auth.uid();
  if c is not null then return c; end if;
  loop
    c := '';
    for i in 1..6 loop c := c || substr(a, 1 + floor(random() * length(a))::int, 1); end loop;
    begin
      insert into guardian_codes(rider_id, code) values (auth.uid(), c);
      return c;
    exception when unique_violation then
      select code into c from guardian_codes where rider_id = auth.uid();
      if c is not null then return c; end if;
    end;
  end loop;
end $$;

-- Veiller sur un motard grâce à son code ; renvoie son prénom
create or replace function public.mr_guard_join(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare r uuid; n text;
begin
  if auth.uid() is null then raise exception 'non-connecte'; end if;
  select rider_id into r from guardian_codes where code = upper(trim(p_code));
  if r is null then raise exception 'code-inconnu'; end if;
  if r = auth.uid() then raise exception 'son-propre-code'; end if;
  insert into guardians(rider_id, guardian_id) values (r, auth.uid()) on conflict do nothing;
  select coalesce(nullif(first_name,''),'Motard') into n from profiles where id = r;
  return coalesce(n, 'Motard');
end $$;

-- Mes liens : ceux qui veillent sur moi (kind = 'g') et ceux sur qui je veille (kind = 'r')
create or replace function public.mr_guard_list() returns table(kind text, other_id uuid, first_name text)
language sql security definer set search_path = public as $$
  select 'g', g.guardian_id, coalesce(p.first_name,'Motard') from guardians g left join profiles p on p.id = g.guardian_id where g.rider_id = auth.uid()
  union all
  select 'r', g.rider_id, coalesce(p.first_name,'Motard') from guardians g left join profiles p on p.id = g.rider_id where g.guardian_id = auth.uid();
$$;

revoke all on function public.mr_my_guard_code() from public, anon;
revoke all on function public.mr_guard_join(text) from public, anon;
revoke all on function public.mr_guard_list() from public, anon;
grant execute on function public.mr_my_guard_code() to authenticated;
grant execute on function public.mr_guard_join(text) to authenticated;
grant execute on function public.mr_guard_list() to authenticated;

-- 4) Journal des alertes sonores (anti-abus : 6 alertes max par 10 minutes), lu seulement par le serveur
create table if not exists public.sos_push_log (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  sent int not null default 0,
  at timestamptz not null default now()
);
create index if not exists sos_push_log_user_at on public.sos_push_log (user_id, at desc);
alter table public.sos_push_log enable row level security;
revoke all on public.sos_push_log from anon, authenticated;
