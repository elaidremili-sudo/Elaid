-- MotoRoute talkie-walkie, morceau 4/4 temps réel + direct
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
create table if not exists public.talkie_live (
  session_id text primary key,
  channel text not null,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists talkie_live_user_idx on public.talkie_live (user_id, created_at desc);
create index if not exists talkie_live_chan_idx on public.talkie_live (channel, created_at desc);
alter table public.talkie_live enable row level security;
revoke all on public.talkie_live from public, anon, authenticated;
grant all on public.talkie_live to service_role;
