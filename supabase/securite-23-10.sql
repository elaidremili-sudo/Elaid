-- MotoRoute – sécurité du 23/10/2026 (relecture avant Google Play)
-- 1) Journal des sirènes : type d'envoi (real / test / self) pour limiter les vraies alertes à 5 par heure.
-- 2) Codes partenaires : 10 caractères tirés au hasard de façon sûre (avant : 6, faciles à deviner en boucle).
-- 3) Fonctions internes : plus appelables sans être connecté.
-- Script rejouable sans risque.

-- 1) Journal des sirènes
alter table public.sos_push_log add column if not exists kind text not null default 'real';

-- 2) Codes partenaires et codes anges gardiens
create extension if not exists pgcrypto with schema extensions;

create or replace function public.mr_rand_code(n int)
returns text language plpgsql volatile set search_path = public, extensions as $$
declare a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea := extensions.gen_random_bytes(n); c text := ''; i int;
begin
  for i in 0..n-1 loop c := c || substr(a, 1 + (get_byte(b, i) % 32), 1); end loop;
  return c;
end $$;
revoke execute on function public.mr_rand_code(int) from public, anon;
grant execute on function public.mr_rand_code(int) to authenticated, service_role; -- valeur par défaut de partners.invite_code

alter table public.partners alter column invite_code set default public.mr_rand_code(10);
-- Nouveaux codes pour les partenaires pas encore réclamés (les anciens codes à 6 caractères ne marchent plus)
update public.partners set invite_code = public.mr_rand_code(10) where owner_id is null;

create or replace function public.mr_partner_reset_code(pid text)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not public.mr_is_admin() then raise exception 'interdit'; end if;
  c := public.mr_rand_code(10);
  update partners set invite_code = c, owner_id = null where id = pid;
  return c;
end $$;

-- Code ange gardien : toujours 6 caractères (l'app attend ce format), mais tirage sûr
create or replace function public.mr_my_guard_code()
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if auth.uid() is null then raise exception 'non-connecte'; end if;
  select code into c from guardian_codes where rider_id = auth.uid();
  if c is not null then return c; end if;
  loop
    c := public.mr_rand_code(6);
    begin
      insert into guardian_codes(rider_id, code) values (auth.uid(), c);
      return c;
    exception when unique_violation then
      select code into c from guardian_codes where rider_id = auth.uid();
      if c is not null then return c; end if;
    end;
  end loop;
end $$;

-- 3) Fonctions réservées aux membres connectés
-- (mr_is_admin et mr_partner_owner restent ouvertes : les règles de lecture des vitrines s'en servent)
do $$
declare f text;
begin
  foreach f in array array[
    'is_group_leader(uuid)', 'is_group_member(uuid)', 'mr_is_group_member(uuid)', 'mr_is_ride_participant(uuid)',
    'shares_group(uuid)', 'mr_items_guard()', 'mr_partner_admin_list()', 'mr_partner_claim(text)',
    'mr_partner_info_decide(text, boolean, text)', 'mr_partner_reset_code(text)', 'mr_partner_stats(text)',
    'mr_partner_submit_info(text, jsonb)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
