-- Append-only campaign history and authoritative character resource changes.

create table campaign_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id),
  event_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index campaign_events_campaign_created_idx
  on campaign_events (campaign_id, created_at desc);
create index campaign_events_entity_idx
  on campaign_events (entity_type, entity_id, created_at desc);

alter table campaign_events enable row level security;

create policy "members can read campaign events" on campaign_events
  for select
  to authenticated
  using (is_campaign_member(campaign_id));

-- There are intentionally no client insert, update, or delete policies.
-- Trusted command functions are the only writers.
grant select on campaign_events to authenticated;

create or replace function adjust_character_resource(
  p_character_id uuid,
  p_resource text,
  p_delta numeric,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character characters%rowtype;
  v_before numeric;
  v_after numeric;
begin
  if p_resource not in ('hp', 'xp', 'coin') then
    raise exception 'Unsupported character resource.';
  end if;

  if p_delta is null or p_delta = 0 then
    raise exception 'Resource adjustment must be non-zero.';
  end if;

  if p_resource in ('hp', 'xp') and trunc(p_delta) <> p_delta then
    raise exception 'HP and XP adjustments must be whole numbers.';
  end if;

  select *
  into v_character
  from characters
  where id = p_character_id
  for update;

  if not found or not (
    v_character.owner_user_id = auth.uid()
    or is_campaign_gm(v_character.campaign_id)
  ) then
    raise exception 'Character not found, or you cannot adjust this character.';
  end if;

  v_before := case p_resource
    when 'hp' then v_character.hp
    when 'xp' then v_character.xp
    when 'coin' then v_character.coin
  end;

  v_after := case p_resource
    when 'hp' then greatest(0, least(v_character.max_hp, v_before + p_delta))
    else greatest(0, v_before + p_delta)
  end;

  if p_resource = 'hp' then
    update characters set hp = v_after::int where id = p_character_id;
  elsif p_resource = 'xp' then
    update characters set xp = v_after::int where id = p_character_id;
  else
    update characters set coin = v_after where id = p_character_id;
  end if;

  insert into campaign_events (
    campaign_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_character.campaign_id,
    auth.uid(),
    'character.resource_adjusted',
    'character',
    p_character_id,
    jsonb_build_object(
      'resource', p_resource,
      'before', v_before,
      'after', v_after,
      'requested_delta', p_delta,
      'applied_delta', v_after - v_before,
      'reason', nullif(btrim(p_reason), '')
    )
  );

  return jsonb_build_object(
    'character_id', p_character_id,
    'resource', p_resource,
    'before', v_before,
    'after', v_after,
    'applied_delta', v_after - v_before
  );
end;
$$;

revoke all on function adjust_character_resource(uuid, text, numeric, text) from public;
grant execute on function adjust_character_resource(uuid, text, numeric, text) to authenticated;

-- Extend the existing atomic rest command so rests are also part of the
-- campaign's durable history.
create or replace function complete_character_rest(p_character_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character characters%rowtype;
  v_ration character_gear%rowtype;
  v_rations_remaining int;
begin
  select *
  into v_character
  from characters
  where id = p_character_id
  for update;

  if not found or not (
    v_character.owner_user_id = auth.uid()
    or is_campaign_gm(v_character.campaign_id)
  ) then
    raise exception 'Character not found, or you cannot rest this character.';
  end if;

  select *
  into v_ration
  from character_gear
  where character_id = p_character_id
    and lower(name) in ('ration', 'rations')
    and quantity > 0
  order by created_at
  limit 1
  for update;

  if not found then
    raise exception 'A full rest requires one ration.';
  end if;

  if v_ration.quantity = 1 then
    delete from character_gear where id = v_ration.id;
    v_rations_remaining := 0;
  else
    update character_gear
    set quantity = quantity - 1
    where id = v_ration.id;
    v_rations_remaining := v_ration.quantity - 1;
  end if;

  update characters set hp = max_hp where id = p_character_id;
  update character_features
    set uses_current = uses_max
    where character_id = p_character_id and uses_max is not null;
  update character_spells
    set lost = false,
        succeeded_since_rest = false,
        last_check_natural = null,
        last_check_total = null,
        last_check_succeeded = null,
        last_check_at = null
    where character_id = p_character_id;

  insert into campaign_events (
    campaign_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_character.campaign_id,
    auth.uid(),
    'character.full_rest_completed',
    'character',
    p_character_id,
    jsonb_build_object(
      'hp_before', v_character.hp,
      'hp_after', v_character.max_hp,
      'ration_item_id', v_ration.id,
      'rations_remaining', v_rations_remaining
    )
  );

  return jsonb_build_object(
    'character_id', p_character_id,
    'hp', v_character.max_hp,
    'rations_remaining', v_rations_remaining
  );
end;
$$;

revoke all on function complete_character_rest(uuid) from public;
grant execute on function complete_character_rest(uuid) to authenticated;
