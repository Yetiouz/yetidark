-- Create a complete character and its starting records in one transaction.

drop policy if exists "owners can write their own characters" on characters;

create or replace function create_character(
  p_campaign_id uuid,
  p_character jsonb,
  p_gear jsonb default '[]'::jsonb,
  p_talents jsonb default '[]'::jsonb,
  p_features jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character characters%rowtype;
begin
  if auth.uid() is null or not is_campaign_member(p_campaign_id) then
    raise exception 'Campaign not found, or you are not a member.';
  end if;

  if jsonb_typeof(p_character) <> 'object'
    or nullif(btrim(p_character->>'name'), '') is null
    or nullif(btrim(p_character->>'ancestry'), '') is null
    or nullif(btrim(p_character->>'class'), '') is null
    or jsonb_typeof(p_character->'stats') <> 'object'
  then
    raise exception 'Character name, ancestry, class, and stats are required.';
  end if;

  if jsonb_typeof(p_gear) <> 'array'
    or jsonb_typeof(p_talents) <> 'array'
    or jsonb_typeof(p_features) <> 'array'
  then
    raise exception 'Character gear, talents, and features must be arrays.';
  end if;

  insert into characters (
    campaign_id, owner_user_id, name, ancestry, class, level, stats,
    hp, max_hp, ac, alignment, background, xp, coin,
    rules_version, creation_rolls
  )
  values (
    p_campaign_id,
    auth.uid(),
    btrim(p_character->>'name'),
    btrim(p_character->>'ancestry'),
    btrim(p_character->>'class'),
    1,
    p_character->'stats',
    (p_character->>'hp')::int,
    (p_character->>'max_hp')::int,
    coalesce((p_character->>'ac')::int, 10),
    nullif(btrim(p_character->>'alignment'), ''),
    nullif(btrim(p_character->>'background'), ''),
    coalesce((p_character->>'xp')::int, 0),
    coalesce((p_character->>'coin')::numeric, 0),
    coalesce(nullif(p_character->>'rules_version', ''), 'legacy-unversioned'),
    coalesce(p_character->'creation_rolls', '{}'::jsonb)
  )
  returning * into v_character;

  insert into character_gear (
    character_id, name, slots, equipped, quantity, notes,
    base_ac, dex_applies, is_shield
  )
  select
    v_character.id,
    btrim(item.name),
    coalesce(item.slots, 1),
    coalesce(item.equipped, false),
    coalesce(item.quantity, 1),
    nullif(btrim(item.notes), ''),
    item.base_ac,
    coalesce(item.dex_applies, true),
    coalesce(item.is_shield, false)
  from jsonb_to_recordset(p_gear) as item(
    name text,
    slots numeric,
    equipped boolean,
    quantity int,
    notes text,
    base_ac int,
    dex_applies boolean,
    is_shield boolean
  );

  insert into character_talents (
    character_id, source, description, roll_formula, roll_total, rules_version
  )
  select
    v_character.id,
    btrim(talent.source),
    btrim(talent.description),
    nullif(btrim(talent.roll_formula), ''),
    talent.roll_total,
    coalesce(nullif(talent.rules_version, ''), v_character.rules_version)
  from jsonb_to_recordset(p_talents) as talent(
    source text,
    description text,
    roll_formula text,
    roll_total int,
    rules_version text
  );

  insert into character_features (
    character_id, source, name, description, uses_max, uses_current
  )
  select
    v_character.id,
    btrim(feature.source),
    btrim(feature.name),
    btrim(feature.description),
    feature.uses_max,
    feature.uses_current
  from jsonb_to_recordset(p_features) as feature(
    source text,
    name text,
    description text,
    uses_max int,
    uses_current int
  );

  insert into campaign_events (
    campaign_id, actor_user_id, event_type, entity_type, entity_id, payload
  )
  values (
    p_campaign_id,
    auth.uid(),
    'character.created',
    'character',
    v_character.id,
    jsonb_build_object(
      'character', to_jsonb(v_character),
      'gear_count', jsonb_array_length(p_gear),
      'talent_count', jsonb_array_length(p_talents),
      'feature_count', jsonb_array_length(p_features)
    )
  );

  return to_jsonb(v_character);
end;
$$;

revoke all on function create_character(uuid, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function create_character(uuid, jsonb, jsonb, jsonb, jsonb) to authenticated;
