-- Persist talent-roll provenance and model the per-rest spell lifecycle.

alter table character_talents
  add column roll_formula text,
  add column roll_total int,
  add column rules_version text not null default 'legacy-unversioned';

alter table character_spells
  add column succeeded_since_rest boolean not null default false,
  add column last_check_natural int,
  add column last_check_total int,
  add column last_check_succeeded boolean,
  add column last_check_at timestamptz;

alter table character_spells
  add constraint character_spells_last_check_natural_range
    check (last_check_natural is null or last_check_natural between 1 and 20);

-- A full rest is one atomic action: consume a ration, restore HP, reset
-- daily feature uses, and begin a fresh spell cycle.
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

  update characters
  set hp = max_hp
  where id = p_character_id;

  update character_features
  set uses_current = uses_max
  where character_id = p_character_id
    and uses_max is not null;

  update character_spells
  set lost = false,
      succeeded_since_rest = false,
      last_check_natural = null,
      last_check_total = null,
      last_check_succeeded = null,
      last_check_at = null
  where character_id = p_character_id;

  return jsonb_build_object(
    'character_id', p_character_id,
    'hp', v_character.max_hp,
    'rations_remaining', v_rations_remaining
  );
end;
$$;

revoke all on function complete_character_rest(uuid) from public;
grant execute on function complete_character_rest(uuid) to authenticated;
