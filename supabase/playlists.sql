-- MotoRoute : playlists de club (bibliothèque musicale partagée par groupe)
-- À coller une seule fois dans Supabase > SQL Editor, puis « Run ». Peut être relancé sans risque.
-- On ne stocke que des liens (morceaux Audius, radios, liens MP3) : aucun fichier audio n'est envoyé sur le serveur.

create table if not exists public.group_tracks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  added_by text,
  title text not null check (char_length(title) between 1 and 120),
  info text,
  url text not null check (url like 'https://%'),
  live boolean not null default false,
  created_at timestamptz not null default now(),
  unique (group_id, url)
);

alter table public.group_tracks enable row level security;

-- Seuls les membres actifs du groupe voient et ajoutent des morceaux
drop policy if exists group_tracks_read on public.group_tracks;
create policy group_tracks_read on public.group_tracks for select to authenticated
  using (exists (select 1 from public.group_members m where m.group_id = group_tracks.group_id and m.user_id = auth.uid() and coalesce(m.status, 'active') = 'active'));

drop policy if exists group_tracks_insert on public.group_tracks;
create policy group_tracks_insert on public.group_tracks for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.group_members m where m.group_id = group_tracks.group_id and m.user_id = auth.uid() and coalesce(m.status, 'active') = 'active'));

-- On retire ses propres ajouts ; le chef du groupe peut tout retirer
drop policy if exists group_tracks_delete on public.group_tracks;
create policy group_tracks_delete on public.group_tracks for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.groups g where g.id = group_tracks.group_id and g.owner_id = auth.uid()));
