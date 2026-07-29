-- Close authorization gaps found during the local security audit.

-- Fresh Supabase databases do not automatically grant API roles access to
-- newly-created tables. RLS remains the authorization boundary; these grants
-- merely allow PostgREST to reach and evaluate the policies.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Supabase installs pgcrypto in `extensions`. These security-definer
-- functions previously searched only `public`, so private campaign password
-- checks could fail to resolve crypt()/gen_salt() at runtime.
alter function join_campaign_by_code(text, text)
  set search_path = public, extensions;
alter function set_campaign_privacy(uuid, boolean, text)
  set search_path = public, extensions;

-- Public campaigns are a signed-in directory, not an anonymous data feed.
drop policy if exists "anyone can read public campaigns" on campaigns;
create policy "authenticated users can read public campaigns" on campaigns
  for select
  to authenticated
  using (is_public = true);

-- A caller creating a human-GM campaign must be its recorded GM. AI-GM
-- campaigns intentionally have no human gm_user_id.
drop policy if exists "authenticated users can create campaigns" on campaigns;
create policy "authenticated users can create campaigns" on campaigns
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and (
      (gm_type = 'human' and gm_user_id = auth.uid())
      or (gm_type = 'ai' and gm_user_id is null)
    )
  );

-- Direct public joins may only create a player membership. Without the role
-- check, any signed-in user could self-assign GM and inherit every GM policy.
drop policy if exists "users can add themselves to public campaigns" on campaign_members;
create policy "users can add themselves to public campaigns" on campaign_members
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and role = 'player'
    and exists (
      select 1
      from campaigns c
      where c.id = campaign_members.campaign_id
        and c.is_public = true
    )
  );

-- Map paths are `{campaign_id}/{filename}`. Only that campaign's GM may
-- create or replace objects in the folder.
drop policy if exists "authenticated users can upload map images" on storage.objects;
drop policy if exists "authenticated users can replace map images" on storage.objects;

create policy "campaign gm can upload map images" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'maps'
    and public.is_campaign_gm(
      case
        when (storage.foldername(name))[1] ~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
        else null
      end
    )
  );

create policy "campaign gm can replace map images" on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'maps'
    and public.is_campaign_gm(
      case
        when (storage.foldername(name))[1] ~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
        else null
      end
    )
  )
  with check (
    bucket_id = 'maps'
    and public.is_campaign_gm(
      case
        when (storage.foldername(name))[1] ~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
        else null
      end
    )
  );
