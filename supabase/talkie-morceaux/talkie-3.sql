-- MotoRoute talkie-walkie, morceau 3/4 stockage audio
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('talkie-audio', 'talkie-audio', false, 1048576,
        array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/aac', 'audio/mpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 1048576,
      allowed_mime_types = array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/aac', 'audio/mpeg'];
drop policy if exists talkie_audio_insert on storage.objects;
create policy talkie_audio_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'talkie-audio'
    and public.mr_talkie_can_folder((storage.foldername(name))[1])
    and left(storage.filename(name), 37) = auth.uid()::text || '_');
drop policy if exists talkie_audio_select on storage.objects;
create policy talkie_audio_select on storage.objects for select to authenticated
  using (bucket_id = 'talkie-audio' and (
    owner_id = auth.uid()::text
    or exists (select 1 from public.talkie_messages m
                where m.path = name and m.expires_at > now() and public.mr_talkie_can(m.group_id, m.ride_id))));
drop policy if exists talkie_audio_delete on storage.objects;
create policy talkie_audio_delete on storage.objects for delete to authenticated
  using (bucket_id = 'talkie-audio' and owner_id = auth.uid()::text);
