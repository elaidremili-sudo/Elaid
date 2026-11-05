-- MotoRoute – signaler un message et bloquer un membre (05/11/2026)
-- Deux tables :
--   message_reports : un membre signale un message de la discussion de groupe ; seul lui (et l'administrateur,
--                     depuis le tableau de bord Supabase) peut le lire ; 1 signalement par message, 20 par jour.
--   user_blocks     : un membre en bloque un autre ; chacun ne voit et ne gère que ses propres blocages.
-- Rejouable sans risque.
begin;

create table if not exists public.message_reports (
  id               bigint generated always as identity primary key,
  reporter_id      uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid references auth.users(id) on delete set null,
  group_id         text,
  message_id       text not null,
  excerpt          text,
  reason           text,
  created_at       timestamptz not null default now(),
  unique (reporter_id, message_id)
);
alter table public.message_reports enable row level security;

create table if not exists public.user_blocks (
  user_id    uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_id),
  check (user_id <> blocked_id)
);
alter table public.user_blocks enable row level security;

-- Signalement : auteur = compte connecté, extrait coupé à 300 caractères, 20 signalements par 24 h
create or replace function public.mr_report_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then new.reporter_id := auth.uid(); end if;
  if new.reported_user_id is not null and new.reported_user_id = new.reporter_id then
    raise exception 'mr-signalement : tu ne peux pas te signaler toi-même';
  end if;
  new.excerpt := left(coalesce(new.excerpt, ''), 300);
  new.reason  := left(coalesce(new.reason, ''), 200);
  new.created_at := now();
  if (select count(*) from public.message_reports
      where reporter_id = new.reporter_id and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'mr-signalement : trop de signalements aujourd''hui, réessaie demain';
  end if;
  return new;
end $$;
revoke all on function public.mr_report_guard() from public, anon, authenticated;
drop trigger if exists message_reports_guard on public.message_reports;
create trigger message_reports_guard before insert on public.message_reports
  for each row execute function public.mr_report_guard();

drop policy if exists reports_insert_own on public.message_reports;
create policy reports_insert_own on public.message_reports for insert to authenticated
  with check (reporter_id = (select auth.uid()));
drop policy if exists reports_select_own on public.message_reports;
create policy reports_select_own on public.message_reports for select to authenticated
  using (reporter_id = (select auth.uid()));

drop policy if exists blocks_select_own on public.user_blocks;
create policy blocks_select_own on public.user_blocks for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists blocks_insert_own on public.user_blocks;
create policy blocks_insert_own on public.user_blocks for insert to authenticated
  with check (user_id = (select auth.uid()) and blocked_id <> (select auth.uid()));
drop policy if exists blocks_delete_own on public.user_blocks;
create policy blocks_delete_own on public.user_blocks for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.message_reports, public.user_blocks from anon;
grant select, insert on public.message_reports to authenticated;
grant select, insert, delete on public.user_blocks to authenticated;
create index if not exists user_blocks_blocked_idx on public.user_blocks (blocked_id);
create index if not exists message_reports_reported_idx on public.message_reports (reported_user_id);

commit;
