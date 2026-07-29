-- Delve — Character portrait (chunk 3 of the GM-brain integration)
-- Run this in the Supabase SQL editor after 003_character_sheet.sql.
--
-- Lets a player upload a picture of what their character looks like.
-- Mirrors the existing "maps" storage bucket pattern, but scoped tighter:
-- only the character's owner (not the campaign GM) can upload or replace
-- a portrait -- it's a personal touch, not something the GM manages like
-- the shared map image.

alter table characters add column avatar_url text;

-- ---------------------------------------------------------------------
-- Storage: a public "avatars" bucket holds uploaded character portraits.
-- Public read, same reasoning as "maps" -- URLs aren't guessable and
-- portraits aren't sensitive. Uploads are scoped to the object path
-- `{character_id}/...`, checked against characters.owner_user_id so only
-- the owning player can write to their own character's folder.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "anyone can view character avatars" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "character owner can upload their avatar" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and exists (
      select 1 from characters c
      where c.id::text = (storage.foldername(name))[1]
        and c.owner_user_id = auth.uid()
    )
  );

create policy "character owner can replace their avatar" on storage.objects
  for update using (
    bucket_id = 'avatars'
    and exists (
      select 1 from characters c
      where c.id::text = (storage.foldername(name))[1]
        and c.owner_user_id = auth.uid()
    )
  );
