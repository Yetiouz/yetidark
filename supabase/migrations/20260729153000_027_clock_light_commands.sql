-- Authoritative campaign clocks and active-play light tracking.

drop policy if exists "gm writes campaign clocks" on campaign_clocks;
drop policy if exists "owner or gm can write light sources" on campaign_light_sources;

create or replace function add_campaign_clock(
  p_campaign_id uuid,
  p_name text,
  p_segments_total int default 4
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clock campaign_clocks%rowtype;
begin
  if not is_campaign_gm(p_campaign_id) then
    raise exception 'Campaign not found, or you are not its GM.';
  end if;
  if nullif(btrim(p_name), '') is null or p_segments_total < 1 then
    raise exception 'A clock requires a name and at least one segment.';
  end if;

  insert into campaign_clocks (campaign_id, name, segments_total)
  values (p_campaign_id, btrim(p_name), p_segments_total)
  returning * into v_clock;

  insert into campaign_events (
    campaign_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    p_campaign_id, auth.uid(), 'campaign.clock_added', 'campaign_clock',
    v_clock.id, jsonb_build_object('clock', to_jsonb(v_clock))
  );
  return to_jsonb(v_clock);
end;
$$;

create or replace function adjust_campaign_clock(
  p_clock_id uuid,
  p_delta int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clock campaign_clocks%rowtype;
  v_before int;
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'Clock adjustment must be non-zero.';
  end if;
  select * into v_clock from campaign_clocks where id = p_clock_id for update;
  if not found or not is_campaign_gm(v_clock.campaign_id) then
    raise exception 'Clock not found, or you are not its GM.';
  end if;

  v_before := v_clock.segments_filled;
  update campaign_clocks
  set segments_filled = greatest(
    0, least(segments_total, segments_filled + p_delta)
  )
  where id = p_clock_id
  returning * into v_clock;

  insert into campaign_events (
    campaign_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_clock.campaign_id, auth.uid(), 'campaign.clock_adjusted',
    'campaign_clock', v_clock.id,
    jsonb_build_object(
      'name', v_clock.name, 'before', v_before,
      'after', v_clock.segments_filled, 'requested_delta', p_delta,
      'applied_delta', v_clock.segments_filled - v_before
    )
  );
  return to_jsonb(v_clock);
end;
$$;

create or replace function remove_campaign_clock(p_clock_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clock campaign_clocks%rowtype;
begin
  select * into v_clock from campaign_clocks where id = p_clock_id for update;
  if not found or not is_campaign_gm(v_clock.campaign_id) then
    raise exception 'Clock not found, or you are not its GM.';
  end if;

  delete from campaign_clocks where id = p_clock_id;
  insert into campaign_events (
    campaign_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_clock.campaign_id, auth.uid(), 'campaign.clock_removed',
    'campaign_clock', v_clock.id, jsonb_build_object('clock', to_jsonb(v_clock))
  );
  return to_jsonb(v_clock);
end;
$$;

create or replace function add_campaign_light_source(
  p_campaign_id uuid,
  p_character_id uuid,
  p_name text,
  p_total_minutes int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source campaign_light_sources%rowtype;
begin
  if not is_campaign_gm(p_campaign_id) then
    raise exception 'Campaign not found, or you are not its GM.';
  end if;
  if nullif(btrim(p_name), '') is null or p_total_minutes < 1 then
    raise exception 'A light source requires a name and positive burn time.';
  end if;
  if p_character_id is not null and not exists (
    select 1 from characters
    where id = p_character_id and campaign_id = p_campaign_id
  ) then
    raise exception 'Assigned character must belong to this campaign.';
  end if;

  insert into campaign_light_sources (
    campaign_id, character_id, name, total_minutes, remaining_minutes
  ) values (
    p_campaign_id, p_character_id, btrim(p_name),
    p_total_minutes, p_total_minutes
  )
  returning * into v_source;

  insert into campaign_events (
    campaign_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    p_campaign_id, auth.uid(), 'campaign.light_added',
    'campaign_light_source', v_source.id,
    jsonb_build_object('light_source', to_jsonb(v_source))
  );
  return to_jsonb(v_source);
end;
$$;

create or replace function set_campaign_light_lit(
  p_source_id uuid,
  p_lit boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source campaign_light_sources%rowtype;
  v_session_active boolean;
  v_can_manage boolean;
  v_remaining numeric;
begin
  select * into v_source
  from campaign_light_sources
  where id = p_source_id
  for update;
  if not found then raise exception 'Light source not found.'; end if;

  v_can_manage := is_campaign_gm(v_source.campaign_id) or (
    v_source.character_id is not null and exists (
      select 1 from characters c
      where c.id = v_source.character_id
        and c.campaign_id = v_source.campaign_id
        and c.owner_user_id = auth.uid()
    )
  );
  if not v_can_manage then
    raise exception 'Light source not found, or you cannot manage it.';
  end if;

  select session_active into v_session_active
  from campaigns where id = v_source.campaign_id;
  v_remaining := case
    when v_source.lit and v_source.lit_at is not null
      then greatest(
        0, v_source.remaining_minutes
          - extract(epoch from (clock_timestamp() - v_source.lit_at)) / 60
      )
    else v_source.remaining_minutes
  end;

  update campaign_light_sources
  set lit = p_lit,
      remaining_minutes = v_remaining,
      lit_at = case when p_lit and v_session_active then clock_timestamp() else null end
  where id = p_source_id
  returning * into v_source;

  insert into campaign_events (
    campaign_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_source.campaign_id, auth.uid(), 'campaign.light_changed',
    'campaign_light_source', v_source.id,
    jsonb_build_object(
      'name', v_source.name, 'lit', p_lit,
      'remaining_minutes', v_source.remaining_minutes,
      'session_active', v_session_active
    )
  );
  return to_jsonb(v_source);
end;
$$;

create or replace function remove_campaign_light_source(p_source_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source campaign_light_sources%rowtype;
begin
  select * into v_source
  from campaign_light_sources
  where id = p_source_id
  for update;
  if not found or not is_campaign_gm(v_source.campaign_id) then
    raise exception 'Light source not found, or you are not its GM.';
  end if;

  delete from campaign_light_sources where id = p_source_id;
  insert into campaign_events (
    campaign_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_source.campaign_id, auth.uid(), 'campaign.light_removed',
    'campaign_light_source', v_source.id,
    jsonb_build_object('light_source', to_jsonb(v_source))
  );
  return to_jsonb(v_source);
end;
$$;

create or replace function set_campaign_session_active(
  p_campaign_id uuid,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign campaigns%rowtype;
  v_now timestamptz := clock_timestamp();
  v_affected int;
begin
  select * into v_campaign
  from campaigns where id = p_campaign_id
  for update;
  if not found or not (
    is_campaign_gm(p_campaign_id)
    or (
      v_campaign.gm_type = 'ai'
      and p_active
      and is_campaign_member(p_campaign_id)
    )
  ) then
    raise exception 'Campaign not found, or you are not its GM.';
  end if;

  if p_active then
    update campaign_light_sources
    set lit_at = v_now
    where campaign_id = p_campaign_id and lit and lit_at is null;
  else
    update campaign_light_sources
    set remaining_minutes = greatest(
          0, remaining_minutes - extract(epoch from (v_now - lit_at)) / 60
        ),
        lit_at = null
    where campaign_id = p_campaign_id and lit and lit_at is not null;
  end if;
  get diagnostics v_affected = row_count;

  update campaigns set session_active = p_active where id = p_campaign_id;
  insert into campaign_events (
    campaign_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    p_campaign_id, auth.uid(), 'campaign.session_activity_changed',
    'campaign', p_campaign_id,
    jsonb_build_object(
      'before', v_campaign.session_active, 'after', p_active,
      'light_sources_updated', v_affected
    )
  );
  return jsonb_build_object(
    'campaign_id', p_campaign_id, 'session_active', p_active,
    'light_sources_updated', v_affected
  );
end;
$$;

revoke all on function add_campaign_clock(uuid, text, int) from public;
revoke all on function adjust_campaign_clock(uuid, int) from public;
revoke all on function remove_campaign_clock(uuid) from public;
revoke all on function add_campaign_light_source(uuid, uuid, text, int) from public;
revoke all on function set_campaign_light_lit(uuid, boolean) from public;
revoke all on function remove_campaign_light_source(uuid) from public;
revoke all on function set_campaign_session_active(uuid, boolean) from public;

grant execute on function add_campaign_clock(uuid, text, int) to authenticated;
grant execute on function adjust_campaign_clock(uuid, int) to authenticated;
grant execute on function remove_campaign_clock(uuid) to authenticated;
grant execute on function add_campaign_light_source(uuid, uuid, text, int) to authenticated;
grant execute on function set_campaign_light_lit(uuid, boolean) to authenticated;
grant execute on function remove_campaign_light_source(uuid) to authenticated;
grant execute on function set_campaign_session_active(uuid, boolean) to authenticated;
