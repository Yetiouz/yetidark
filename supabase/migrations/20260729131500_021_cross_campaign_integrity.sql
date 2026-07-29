-- Prevent authenticated users from moving otherwise-owned records across
-- campaign boundaries that they are not authorized to access.

drop policy if exists "owners and gm can update characters" on characters;
create policy "owners and gm can update characters" on characters
  for update
  to authenticated
  using (
    (
      owner_user_id = auth.uid()
      and is_campaign_member(campaign_id)
    )
    or is_campaign_gm(campaign_id)
  )
  with check (
    (
      owner_user_id = auth.uid()
      and is_campaign_member(campaign_id)
    )
    or is_campaign_gm(campaign_id)
  );

drop policy if exists "members can change their own vote" on votes;
create policy "members can change their own vote" on votes
  for update
  to authenticated
  using (
    voter_user_id = auth.uid()
    and is_campaign_member(campaign_id)
  )
  with check (
    voter_user_id = auth.uid()
    and is_campaign_member(campaign_id)
  );

drop policy if exists "owner or gm can write light sources" on campaign_light_sources;
create policy "owner or gm can write light sources" on campaign_light_sources
  for all
  to authenticated
  using (
    is_campaign_gm(campaign_id)
    or (
      character_id is not null
      and exists (
        select 1
        from characters c
        where c.id = campaign_light_sources.character_id
          and c.campaign_id = campaign_light_sources.campaign_id
          and c.owner_user_id = auth.uid()
      )
    )
  )
  with check (
    is_campaign_gm(campaign_id)
    or (
      character_id is not null
      and exists (
        select 1
        from characters c
        where c.id = campaign_light_sources.character_id
          and c.campaign_id = campaign_light_sources.campaign_id
          and c.owner_user_id = auth.uid()
      )
    )
  );

-- Qualify the object path inside the character subquery. The original
-- unqualified `name` bound to characters.name, which denied legitimate
-- uploads. An explicit WITH CHECK also prevents update-based path changes.
drop policy if exists "character owner can upload their avatar" on storage.objects;
create policy "character owner can upload their avatar" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and exists (
      select 1
      from characters c
      where c.id::text = (storage.foldername(storage.objects.name))[1]
        and c.owner_user_id = auth.uid()
    )
  );

drop policy if exists "character owner can replace their avatar" on storage.objects;
create policy "character owner can replace their avatar" on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and exists (
      select 1
      from characters c
      where c.id::text = (storage.foldername(storage.objects.name))[1]
        and c.owner_user_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'avatars'
    and exists (
      select 1
      from characters c
      where c.id::text = (storage.foldername(storage.objects.name))[1]
        and c.owner_user_id = auth.uid()
    )
  );
