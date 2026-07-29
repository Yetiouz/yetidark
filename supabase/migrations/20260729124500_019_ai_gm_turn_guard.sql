-- Serialize AI-GM turns per campaign and bound successful generation starts.
-- The Edge Function holds a short database lease while Gemini is running.

create table ai_gm_turn_state (
  campaign_id uuid primary key references campaigns(id) on delete cascade,
  active_claim_token uuid,
  active_input_id uuid references scene_log(id) on delete set null,
  active_until timestamptz,
  last_completed_input_id uuid references scene_log(id) on delete set null,
  has_completed_turn boolean not null default false,
  minute_window_started_at timestamptz not null default now(),
  minute_window_count integer not null default 0 check (minute_window_count >= 0),
  updated_at timestamptz not null default now()
);

alter table ai_gm_turn_state enable row level security;
revoke all on table ai_gm_turn_state from anon, authenticated;

create or replace function claim_ai_gm_turn(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_state ai_gm_turn_state%rowtype;
  v_input_id uuid;
  v_input_at timestamptz;
  v_latest_ai_at timestamptz;
  v_claim_token uuid;
  v_retry_after integer;
begin
  if v_user_id is null then
    raise exception 'Not signed in.';
  end if;

  if not exists (
    select 1
    from campaign_members
    where campaign_id = p_campaign_id
      and user_id = v_user_id
  ) then
    raise exception 'Campaign not found, or you are not a member.';
  end if;

  if not exists (
    select 1
    from campaigns
    where id = p_campaign_id
      and gm_type = 'ai'
  ) then
    raise exception 'This campaign does not use the AI GM.';
  end if;

  insert into ai_gm_turn_state (campaign_id)
  values (p_campaign_id)
  on conflict (campaign_id) do nothing;

  select *
  into v_state
  from ai_gm_turn_state
  where campaign_id = p_campaign_id
  for update;

  select id, created_at
  into v_input_id, v_input_at
  from scene_log
  where campaign_id = p_campaign_id
    and sender_user_id is not null
    and type in ('chat', 'roll')
  order by created_at desc, id desc
  limit 1;

  select created_at
  into v_latest_ai_at
  from scene_log
  where campaign_id = p_campaign_id
    and type = 'ai_gm'
  order by created_at desc, id desc
  limit 1;

  -- Seed state safely for campaigns that already had AI narration before this
  -- migration. Do not generate again unless a player has acted since it.
  if not v_state.has_completed_turn
     and v_latest_ai_at is not null
     and (v_input_at is null or v_input_at <= v_latest_ai_at) then
    update ai_gm_turn_state
    set has_completed_turn = true,
        last_completed_input_id = v_input_id,
        updated_at = v_now
    where campaign_id = p_campaign_id;

    return jsonb_build_object('status', 'skipped');
  end if;

  if v_state.has_completed_turn
     and v_input_id is not distinct from v_state.last_completed_input_id then
    return jsonb_build_object('status', 'skipped');
  end if;

  if v_state.active_claim_token is not null
     and v_state.active_until > v_now then
    v_retry_after := greatest(1, ceil(extract(epoch from (v_state.active_until - v_now)))::integer);
    return jsonb_build_object(
      'status', 'busy',
      'retry_after_seconds', v_retry_after
    );
  end if;

  if v_state.minute_window_started_at <= v_now - interval '1 minute' then
    v_state.minute_window_started_at := v_now;
    v_state.minute_window_count := 0;
  end if;

  if v_state.minute_window_count >= 4 then
    v_retry_after := greatest(
      1,
      ceil(extract(epoch from (v_state.minute_window_started_at + interval '1 minute' - v_now)))::integer
    );
    return jsonb_build_object(
      'status', 'rate_limited',
      'retry_after_seconds', v_retry_after
    );
  end if;

  v_claim_token := gen_random_uuid();

  update ai_gm_turn_state
  set active_claim_token = v_claim_token,
      active_input_id = v_input_id,
      active_until = v_now + interval '5 minutes',
      minute_window_started_at = v_state.minute_window_started_at,
      minute_window_count = v_state.minute_window_count + 1,
      updated_at = v_now
  where campaign_id = p_campaign_id;

  return jsonb_build_object(
    'status', 'claimed',
    'claim_token', v_claim_token,
    'claimed_at', v_now,
    'input_id', v_input_id
  );
end;
$$;

create or replace function complete_ai_gm_turn(
  p_campaign_id uuid,
  p_claim_token uuid,
  p_sender_name text,
  p_text text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state ai_gm_turn_state%rowtype;
begin
  select *
  into v_state
  from ai_gm_turn_state
  where campaign_id = p_campaign_id
  for update;

  if not found or v_state.active_claim_token is distinct from p_claim_token then
    return false;
  end if;

  insert into scene_log (campaign_id, type, sender_name, text)
  values (p_campaign_id, 'ai_gm', p_sender_name, p_text);

  update ai_gm_turn_state
  set active_claim_token = null,
      active_input_id = null,
      active_until = null,
      last_completed_input_id = v_state.active_input_id,
      has_completed_turn = true,
      updated_at = clock_timestamp()
  where campaign_id = p_campaign_id;

  return true;
end;
$$;

create or replace function release_ai_gm_turn(
  p_campaign_id uuid,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update ai_gm_turn_state
  set active_claim_token = null,
      active_input_id = null,
      active_until = null,
      updated_at = clock_timestamp()
  where campaign_id = p_campaign_id
    and active_claim_token = p_claim_token;

  return found;
end;
$$;

revoke all on function claim_ai_gm_turn(uuid) from public, anon;
grant execute on function claim_ai_gm_turn(uuid) to authenticated;

revoke all on function complete_ai_gm_turn(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function complete_ai_gm_turn(uuid, uuid, text, text) to service_role;

revoke all on function release_ai_gm_turn(uuid, uuid) from public, anon, authenticated;
grant execute on function release_ai_gm_turn(uuid, uuid) to service_role;
