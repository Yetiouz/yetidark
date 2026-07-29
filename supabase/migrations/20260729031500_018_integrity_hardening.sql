-- Protect campaign history, dice attribution, and GM-owned rules resources
-- from identity spoofing by ordinary campaign members.

create or replace function is_current_user_gm()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from campaign_members
    where user_id = auth.uid()
      and role = 'gm'
  );
$$;

-- A player may only record their own rolls under their current profile name.
-- Human GMs may additionally record unowned rolls for monsters and initiative.
-- AI-GM rolls are written by the validated Edge Function with service_role.
drop policy if exists "members can log dice rolls" on dice_rolls;
create policy "members can log attributed dice rolls" on dice_rolls
  for insert
  to authenticated
  with check (
    is_campaign_member(campaign_id)
    and (
      (
        roller_user_id = auth.uid()
        and roller_name = (
          select p.display_name
          from profiles p
          where p.id = auth.uid()
        )
      )
      or (
        is_campaign_gm(campaign_id)
        and roller_user_id is null
      )
    )
  );

-- Player-authored log entries must be chat or a roll linked to their own
-- attributed dice row. GM narration and unowned initiative/monster rolls
-- remain available only to the campaign GM. AI-GM entries are server-only.
drop policy if exists "members can post to the scene log" on scene_log;
create policy "members can post attributed scene entries" on scene_log
  for insert
  to authenticated
  with check (
    is_campaign_member(campaign_id)
    and (
      (
        type = 'chat'
        and sender_user_id = auth.uid()
        and sender_name = (
          select p.display_name
          from profiles p
          where p.id = auth.uid()
        )
        and dice_roll_id is null
        and roll_source is null
      )
      or (
        type = 'roll'
        and sender_user_id = auth.uid()
        and sender_name = (
          select p.display_name
          from profiles p
          where p.id = auth.uid()
        )
        and exists (
          select 1
          from dice_rolls d
          where d.id = scene_log.dice_roll_id
            and d.campaign_id = scene_log.campaign_id
            and d.roller_user_id = auth.uid()
        )
      )
      or (
        is_campaign_gm(campaign_id)
        and type in ('gm', 'narration')
        and sender_user_id = auth.uid()
        and sender_name = (
          select p.display_name
          from profiles p
          where p.id = auth.uid()
        )
      )
      or (
        is_campaign_gm(campaign_id)
        and type = 'roll'
        and sender_user_id is null
        and exists (
          select 1
          from dice_rolls d
          where d.id = scene_log.dice_roll_id
            and d.campaign_id = scene_log.campaign_id
            and d.roller_user_id is null
        )
      )
    )
  );

-- Rules libraries are GM-owned resources. Folder ownership alone is not
-- sufficient because every authenticated user owns a UUID-named folder.
drop policy if exists "owner manages their rules documents" on rules_documents;
create policy "gm owner manages their rules documents" on rules_documents
  for all
  to authenticated
  using (
    owner_user_id = auth.uid()
    and is_current_user_gm()
  )
  with check (
    owner_user_id = auth.uid()
    and is_current_user_gm()
  );

drop policy if exists "gm uploads their own rules files" on storage.objects;
create policy "gm uploads their own rules files" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'rules'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_current_user_gm()
  );

drop policy if exists "gm deletes their own rules files" on storage.objects;
create policy "gm deletes their own rules files" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'rules'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_current_user_gm()
  );
