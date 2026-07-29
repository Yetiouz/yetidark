-- Authoritative gear and spell commands with campaign event history.

-- Initial character construction still inserts gear and spells after the
-- character row exists. Later updates and deletes must use the commands below.
drop policy if exists "owner or gm can write a character's gear" on character_gear;
create policy "owner or gm can add a character's gear" on character_gear
  for insert
  to authenticated
  with check (
    exists (
      select 1 from characters c
      where c.id = character_gear.character_id
        and (c.owner_user_id = auth.uid() or is_campaign_gm(c.campaign_id))
    )
  );

drop policy if exists "owner or gm can write a character's spells" on character_spells;
create policy "owner or gm can add a character's spells" on character_spells
  for insert
  to authenticated
  with check (
    exists (
      select 1 from characters c
      where c.id = character_spells.character_id
        and (c.owner_user_id = auth.uid() or is_campaign_gm(c.campaign_id))
    )
  );

create or replace function add_character_gear(
  p_character_id uuid,
  p_name text,
  p_slots numeric default 1,
  p_quantity int default 1,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character characters%rowtype;
  v_item character_gear%rowtype;
begin
  select * into v_character from characters where id = p_character_id;
  if not found or not (
    v_character.owner_user_id = auth.uid()
    or is_campaign_gm(v_character.campaign_id)
  ) then
    raise exception 'Character not found, or you cannot manage this character.';
  end if;
  if nullif(btrim(p_name), '') is null
    or p_slots is null or p_slots < 0
    or p_quantity is null or p_quantity < 1 then
    raise exception 'Gear requires a name, non-negative slots, and positive quantity.';
  end if;

  insert into character_gear (character_id, name, slots, quantity, notes, equipped)
  values (
    p_character_id, btrim(p_name), p_slots, p_quantity,
    nullif(btrim(p_notes), ''), false
  )
  returning * into v_item;

  insert into campaign_events (
    campaign_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_character.campaign_id, auth.uid(), 'character.gear_added',
    'character_gear', v_item.id, jsonb_build_object('item', to_jsonb(v_item))
  );

  return to_jsonb(v_item);
end;
$$;

create or replace function set_character_gear_equipped(
  p_gear_id uuid,
  p_equipped boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item character_gear%rowtype;
  v_character characters%rowtype;
  v_dex int;
  v_dex_mod int;
  v_armor character_gear%rowtype;
  v_has_shield boolean;
  v_ac int;
begin
  select g.* into v_item
  from character_gear g
  where g.id = p_gear_id
  for update;

  if not found then raise exception 'Gear not found.'; end if;
  select * into v_character
  from characters
  where id = v_item.character_id
  for update;
  if not (
    v_character.owner_user_id = auth.uid()
    or is_campaign_gm(v_character.campaign_id)
  ) then
    raise exception 'Gear not found, or you cannot manage it.';
  end if;

  update character_gear set equipped = p_equipped where id = p_gear_id
  returning * into v_item;

  v_dex := coalesce((v_character.stats->>'dex')::int, 10);
  v_dex_mod := case
    when v_dex >= 18 then 4 when v_dex >= 16 then 3
    when v_dex >= 14 then 2 when v_dex >= 12 then 1
    when v_dex >= 10 then 0 when v_dex >= 8 then -1
    when v_dex >= 6 then -2 when v_dex >= 4 then -3 else -4
  end;

  select * into v_armor
  from character_gear
  where character_id = v_character.id
    and equipped and base_ac is not null and not is_shield
  order by created_at
  limit 1;
  select exists (
    select 1 from character_gear
    where character_id = v_character.id and equipped and is_shield
  ) into v_has_shield;

  v_ac := case
    when v_armor.id is null then 10 + v_dex_mod
    else v_armor.base_ac + case when v_armor.dex_applies then v_dex_mod else 0 end
  end + case when v_has_shield then 2 else 0 end;
  update characters set ac = v_ac where id = v_character.id;

  insert into campaign_events (
    campaign_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_character.campaign_id, auth.uid(), 'character.gear_equipped',
    'character_gear', v_item.id,
    jsonb_build_object('name', v_item.name, 'equipped', p_equipped, 'ac_after', v_ac)
  );

  return to_jsonb(v_item) || jsonb_build_object('character_ac', v_ac);
end;
$$;

create or replace function remove_character_gear(p_gear_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item character_gear%rowtype;
  v_character characters%rowtype;
begin
  select g.* into v_item from character_gear g where g.id = p_gear_id for update;
  if not found then raise exception 'Gear not found.'; end if;
  select * into v_character from characters where id = v_item.character_id;
  if not (
    v_character.owner_user_id = auth.uid()
    or is_campaign_gm(v_character.campaign_id)
  ) then
    raise exception 'Gear not found, or you cannot manage it.';
  end if;

  delete from character_gear where id = p_gear_id;
  insert into campaign_events (
    campaign_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_character.campaign_id, auth.uid(), 'character.gear_removed',
    'character_gear', v_item.id, jsonb_build_object('item', to_jsonb(v_item))
  );
  return to_jsonb(v_item);
end;
$$;

create or replace function add_character_spell(
  p_character_id uuid,
  p_name text,
  p_tier int default 1,
  p_range text default null,
  p_duration text default null,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_character characters%rowtype;
  v_spell character_spells%rowtype;
begin
  select * into v_character from characters where id = p_character_id;
  if not found or not (
    v_character.owner_user_id = auth.uid()
    or is_campaign_gm(v_character.campaign_id)
  ) then
    raise exception 'Character not found, or you cannot manage this character.';
  end if;
  if nullif(btrim(p_name), '') is null or p_tier is null or p_tier < 1 then
    raise exception 'A spell requires a name and positive tier.';
  end if;

  insert into character_spells (
    character_id, name, tier, range, duration, description, prepared, lost
  ) values (
    p_character_id, btrim(p_name), p_tier, nullif(btrim(p_range), ''),
    nullif(btrim(p_duration), ''), nullif(btrim(p_description), ''), false, false
  )
  returning * into v_spell;

  insert into campaign_events (
    campaign_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_character.campaign_id, auth.uid(), 'character.spell_added',
    'character_spell', v_spell.id, jsonb_build_object('spell', to_jsonb(v_spell))
  );
  return to_jsonb(v_spell);
end;
$$;

create or replace function set_character_spell_prepared(
  p_spell_id uuid,
  p_prepared boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spell character_spells%rowtype;
  v_character characters%rowtype;
begin
  select s.* into v_spell from character_spells s where s.id = p_spell_id for update;
  if not found then raise exception 'Spell not found.'; end if;
  select * into v_character from characters where id = v_spell.character_id;
  if not (
    v_character.owner_user_id = auth.uid()
    or is_campaign_gm(v_character.campaign_id)
  ) then
    raise exception 'Spell not found, or you cannot manage it.';
  end if;

  update character_spells set prepared = p_prepared where id = p_spell_id
  returning * into v_spell;
  insert into campaign_events (
    campaign_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_character.campaign_id, auth.uid(), 'character.spell_prepared',
    'character_spell', v_spell.id,
    jsonb_build_object('name', v_spell.name, 'prepared', p_prepared)
  );
  return to_jsonb(v_spell);
end;
$$;

create or replace function record_character_spell_check(
  p_spell_id uuid,
  p_natural_roll int,
  p_total int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spell character_spells%rowtype;
  v_character characters%rowtype;
  v_dc int;
  v_mishap boolean;
  v_succeeded boolean;
  v_locked boolean;
begin
  if p_natural_roll not between 1 and 20 then
    raise exception 'Natural spell check roll must be from 1 to 20.';
  end if;
  if p_total is null then
    raise exception 'Spell check total is required.';
  end if;

  select s.* into v_spell from character_spells s where s.id = p_spell_id for update;
  if not found then raise exception 'Spell not found.'; end if;
  select * into v_character from characters where id = v_spell.character_id;
  if not (
    v_character.owner_user_id = auth.uid()
    or is_campaign_gm(v_character.campaign_id)
  ) then
    raise exception 'Spell not found, or you cannot manage it.';
  end if;

  v_dc := 10 + v_spell.tier;
  v_mishap := p_natural_roll = 1;
  v_succeeded := not v_mishap and p_total >= v_dc;
  v_locked := not v_succeeded and v_spell.succeeded_since_rest;

  update character_spells
  set lost = v_locked,
      succeeded_since_rest = succeeded_since_rest or v_succeeded,
      last_check_natural = p_natural_roll,
      last_check_total = p_total,
      last_check_succeeded = v_succeeded,
      last_check_at = now()
  where id = p_spell_id
  returning * into v_spell;

  insert into campaign_events (
    campaign_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_character.campaign_id, auth.uid(), 'character.spell_check_recorded',
    'character_spell', v_spell.id,
    jsonb_build_object(
      'name', v_spell.name, 'tier', v_spell.tier, 'dc', v_dc,
      'natural_roll', p_natural_roll, 'total', p_total,
      'succeeded', v_succeeded, 'mishap', v_mishap, 'locked', v_locked
    )
  );
  return to_jsonb(v_spell)
    || jsonb_build_object('dc', v_dc, 'mishap', v_mishap, 'locked', v_locked);
end;
$$;

create or replace function remove_character_spell(p_spell_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spell character_spells%rowtype;
  v_character characters%rowtype;
begin
  select s.* into v_spell from character_spells s where s.id = p_spell_id for update;
  if not found then raise exception 'Spell not found.'; end if;
  select * into v_character from characters where id = v_spell.character_id;
  if not (
    v_character.owner_user_id = auth.uid()
    or is_campaign_gm(v_character.campaign_id)
  ) then
    raise exception 'Spell not found, or you cannot manage it.';
  end if;

  delete from character_spells where id = p_spell_id;
  insert into campaign_events (
    campaign_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_character.campaign_id, auth.uid(), 'character.spell_removed',
    'character_spell', v_spell.id, jsonb_build_object('spell', to_jsonb(v_spell))
  );
  return to_jsonb(v_spell);
end;
$$;

revoke all on function add_character_gear(uuid, text, numeric, int, text) from public;
revoke all on function set_character_gear_equipped(uuid, boolean) from public;
revoke all on function remove_character_gear(uuid) from public;
revoke all on function add_character_spell(uuid, text, int, text, text, text) from public;
revoke all on function set_character_spell_prepared(uuid, boolean) from public;
revoke all on function record_character_spell_check(uuid, int, int) from public;
revoke all on function remove_character_spell(uuid) from public;

grant execute on function add_character_gear(uuid, text, numeric, int, text) to authenticated;
grant execute on function set_character_gear_equipped(uuid, boolean) to authenticated;
grant execute on function remove_character_gear(uuid) to authenticated;
grant execute on function add_character_spell(uuid, text, int, text, text, text) to authenticated;
grant execute on function set_character_spell_prepared(uuid, boolean) to authenticated;
grant execute on function record_character_spell_check(uuid, int, int) to authenticated;
grant execute on function remove_character_spell(uuid) to authenticated;
