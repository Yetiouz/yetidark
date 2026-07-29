-- Delve — Campaign privacy: public directory + password-protected private
-- campaigns (chunk 6 of the GM-brain integration).
--
-- Today every campaign is effectively private (RLS only lets members read
-- a campaign row), but the "join with code" lookup in Lobby.jsx selects a
-- campaign by join_code before the user is a member -- which the existing
-- RLS silently blocks, so that flow has actually never worked. This
-- migration fixes that and adds the public/private + password model.
--
-- Also closes a real gap: campaign_members' insert policy today only
-- checks user_id = auth.uid(), with no check at all on the campaign being
-- joinable -- anyone who learned a campaign's UUID could self-add as a
-- member. The tightened policy below restricts direct client-side joins
-- to public campaigns only; private campaigns can only be joined through
-- the join_campaign_by_code() function below, which verifies the password
-- server-side before adding the member row.

alter table campaigns add column is_public boolean not null default true;
alter table campaigns add column join_password_hash text;

-- Any signed-in user can browse public campaigns (for the lobby's "Public
-- campaigns" list), on top of the existing membership-scoped read policy.
-- Postgres ORs multiple permissive policies together, so private campaigns
-- are still only visible to their members.
create policy "anyone can read public campaigns" on campaigns
  for select using (is_public = true);

-- Replaces the old unrestricted self-join policy: direct client-side
-- inserts into campaign_members now only succeed for public campaigns.
-- Joining a private campaign has to go through join_campaign_by_code(),
-- which is security definer and bypasses this policy after checking the
-- password.
drop policy if exists "users can add themselves as a member" on campaign_members;
create policy "users can add themselves to public campaigns" on campaign_members
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from campaigns c where c.id = campaign_members.campaign_id and c.is_public = true)
  );

-- ---------------------------------------------------------------------
-- join_campaign_by_code: the one path that can join a private campaign.
-- Looks up by code, checks the password hash server-side (never sent to
-- the client), then adds the caller as a player. Works for public
-- campaigns too (skips the password check), so "Join with code" keeps
-- working for everyone regardless of privacy.
-- ---------------------------------------------------------------------
create or replace function join_campaign_by_code(p_code text, p_password text default null)
returns table (id uuid, name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign campaigns%rowtype;
begin
  select * into v_campaign from campaigns where join_code = upper(trim(p_code));

  if not found then
    raise exception 'No campaign found with that code.';
  end if;

  if not v_campaign.is_public and v_campaign.join_password_hash is not null then
    if p_password is null or v_campaign.join_password_hash <> crypt(p_password, v_campaign.join_password_hash) then
      raise exception 'Incorrect password.';
    end if;
  end if;

  insert into campaign_members (campaign_id, user_id, role)
  values (v_campaign.id, auth.uid(), 'player')
  on conflict (campaign_id, user_id) do nothing;

  return query select v_campaign.id, v_campaign.name;
end;
$$;

revoke all on function join_campaign_by_code(text, text) from public;
grant execute on function join_campaign_by_code(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- set_campaign_privacy: GM-only. Flipping to public just clears the flag.
-- Flipping to private requires either a new password (hashed here, never
-- stored in plaintext) or an already-set one from a prior save.
-- ---------------------------------------------------------------------
create or replace function set_campaign_privacy(p_campaign_id uuid, p_is_public boolean, p_password text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_campaign_gm(p_campaign_id) then
    raise exception 'Only the GM can change campaign privacy.';
  end if;

  if p_is_public then
    update campaigns set is_public = true where id = p_campaign_id;
    return;
  end if;

  if p_password is not null and length(p_password) > 0 then
    update campaigns set is_public = false, join_password_hash = crypt(p_password, gen_salt('bf')) where id = p_campaign_id;
  else
    update campaigns set is_public = false where id = p_campaign_id and join_password_hash is not null;
    if not found then
      raise exception 'A password is required to make this campaign private.';
    end if;
  end if;
end;
$$;

revoke all on function set_campaign_privacy(uuid, boolean, text) from public;
grant execute on function set_campaign_privacy(uuid, boolean, text) to authenticated;
