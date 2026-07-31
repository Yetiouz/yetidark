-- Dying, stabilizing, and monster morale -- the last three Milestone 1
-- combat mechanics named in docs/ROADMAP.md, mechanics pulled verbatim
-- from the table's own reference (gm-brain/_TOOLS/GM_QUICK_REFERENCE.md,
-- "Death" + "Morale" sections):
--
--   Death: 0 HP = unconscious and dying. Death timer = 1d4 + CON mod
--   (min 1) rounds; roll a d20 each subsequent turn, natural 20 = rise
--   with 1 HP. Stabilize: DC 15 INT check at close range (target stays
--   unconscious but stops dying). Perishing = character retired.
--
--   Morale: enemies reduced to half their number (or half HP for a solo
--   enemy) flee on a failed DC 15 WIS check.
--
-- Dying/stabilizing is PC-only -- monsters have no death timer, they just
-- die at 0 HP the way resolve_attack_roll already handles them. Morale is
-- monster-side only, doesn't touch HP or the death-timer state machine,
-- and is a GM-triggered roll-and-narrate check: this app doesn't try to
-- auto-detect "half the group" or force a check, since that's a judgment
-- call the GM makes about the specific encounter.

-- Small standard-table helper, mirrors src/game/rules/character.js
-- abilityModifier() exactly so server-side rolls (CON for death timers)
-- match client-side character sheet math.
create or replace function ability_modifier(p_score int)
returns int
language sql
immutable
as $$
  select case
    when p_score >= 18 then 4
    when p_score >= 16 then 3
    when p_score >= 14 then 2
    when p_score >= 12 then 1
    when p_score >= 10 then 0
    when p_score >= 8 then -1
    when p_score >= 6 then -2
    when p_score >= 4 then -3
    else -4
  end;
$$;

alter table characters
  add column if not exists status text not null default 'alive'
    check (status in ('alive', 'dying', 'stable', 'dead')),
  add column if not exists death_timer int;

-- Fires on every write to characters.hp regardless of how it got there
-- (resolve_attack_roll, a GM's manual HP nudge, a future heal command),
-- so "hit 0, start dying" can never be missed by only hooking one path.
create or replace function handle_character_hp_zero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_con_mod int;
  v_timer_roll jsonb;
  v_timer int;
begin
  if new.hp = 0 and old.hp > 0 and new.status = 'alive' then
    v_con_mod := ability_modifier(coalesce((new.stats->>'con')::int, 10));
    v_timer_roll := roll_dice_expression('1d4');
    v_timer := greatest(1, (v_timer_roll->>'total')::int + v_con_mod);
    new.status := 'dying';
    new.death_timer := v_timer;

    insert into scene_log (campaign_id, type, sender_name, text)
    values (
      new.campaign_id, 'narration', 'System',
      new.name || ' drops to 0 HP and is dying. Death timer: ' || v_timer || ' round' || case when v_timer = 1 then '' else 's' end || '.'
    );
  elsif new.hp > 0 and old.status in ('dying', 'stable') then
    -- HP restored by any means while dying/stable clears the timer and
    -- wakes the character back up. The house rule only specifies the
    -- natural-20 recovery path; treating any HP-above-0 write the same
    -- way is the obvious extension rather than a new invented rule.
    new.status := 'alive';
    new.death_timer := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_character_hp_zero on characters;
create trigger trg_character_hp_zero
  before update of hp on characters
  for each row
  execute function handle_character_hp_zero();

-- Stabilize: DC 15 INT check against a dying character at Close range.
-- Success stops the death timer (target stays unconscious, stops dying);
-- failure just costs the attempt. Deliberate simplification: this checks
-- the *target's* zone is Close, not which specific character is making
-- the attempt -- the house rule only constrains the target's position.
create or replace function resolve_stabilize_check(
  p_campaign_id uuid,
  p_healer_name text,
  p_target_character_id uuid,
  p_int_notation text default '1d20'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_target characters%rowtype;
  v_roll jsonb;
  v_success boolean;
  v_text text;
  v_scene scene_log%rowtype;
begin
  if not is_campaign_member(p_campaign_id) then
    raise exception 'Campaign not found, or you are not a member.';
  end if;
  if length(coalesce(btrim(p_healer_name), '')) = 0 or length(p_healer_name) > 80 then
    raise exception 'Healer name is required.';
  end if;

  select * into v_target from characters where id = p_target_character_id and campaign_id = p_campaign_id;
  if v_target.id is null then
    raise exception 'Target character not found in this campaign.';
  end if;
  if v_target.status <> 'dying' then
    raise exception '% is not dying.', v_target.name;
  end if;
  if coalesce(v_target.zone, 'near') <> 'close' then
    raise exception '% must be at Close range to stabilize.', v_target.name;
  end if;

  v_roll := roll_dice_expression(p_int_notation);
  v_success := (v_roll->>'total')::int >= 15;

  insert into dice_rolls (
    campaign_id, roller_user_id, roller_name, notation, mode, reason,
    breakdown, total, raw_d20, is_crit, is_fumble
  ) values (
    p_campaign_id, auth.uid(), btrim(p_healer_name),
    lower(regexp_replace(p_int_notation, '\s+', '', 'g')), 'flat',
    'stabilize ' || v_target.name,
    v_roll->>'breakdown', (v_roll->>'total')::int,
    (v_roll->>'raw_d20')::int, coalesce((v_roll->>'raw_d20')::int = 20, false), coalesce((v_roll->>'raw_d20')::int = 1, false)
  );

  if v_success then
    update characters set status = 'stable', death_timer = null where id = p_target_character_id;
  end if;

  v_text := btrim(p_healer_name) || ' attempts to stabilize ' || v_target.name || ': '
    || (v_roll->>'total') || ' vs DC 15 — '
    || case when v_success then 'success. ' || v_target.name || ' is stable.' else 'failure.' end;

  insert into scene_log (campaign_id, type, sender_user_id, sender_name, text, roll_source)
  values (p_campaign_id, 'roll', auth.uid(), btrim(p_healer_name), v_text, 'app')
  returning * into v_scene;

  return jsonb_build_object(
    'success', v_success,
    'total', (v_roll->>'total')::int,
    'target_status', (select status from characters where id = p_target_character_id),
    'scene_entry', to_jsonb(v_scene)
  );
end;
$$;

revoke all on function resolve_stabilize_check(uuid, text, uuid, text) from public;
grant execute on function resolve_stabilize_check(uuid, text, uuid, text) to authenticated;

-- Death check: rolled on a dying character's subsequent turn. Natural 20
-- rises with 1 HP; otherwise the death timer ticks down, and hitting 0
-- means the character perishes (status = 'dead', a retired character per
-- the house rule -- this app doesn't delete or otherwise special-case
-- that row, it just stops being playable).
create or replace function resolve_dying_turn(
  p_campaign_id uuid,
  p_character_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_target characters%rowtype;
  v_roll jsonb;
  v_nat int;
  v_text text;
  v_scene scene_log%rowtype;
  v_next_timer int;
begin
  if not is_campaign_member(p_campaign_id) then
    raise exception 'Campaign not found, or you are not a member.';
  end if;

  select * into v_target from characters where id = p_character_id and campaign_id = p_campaign_id;
  if v_target.id is null then
    raise exception 'Character not found in this campaign.';
  end if;
  if v_target.status <> 'dying' then
    raise exception '% is not dying.', v_target.name;
  end if;

  v_roll := roll_dice_expression('1d20');
  v_nat := (v_roll->>'raw_d20')::int;

  insert into dice_rolls (
    campaign_id, roller_user_id, roller_name, notation, mode, reason,
    breakdown, total, raw_d20, is_crit, is_fumble
  ) values (
    p_campaign_id, auth.uid(), v_target.name, '1d20', 'flat', v_target.name || ' — death check',
    v_roll->>'breakdown', (v_roll->>'total')::int, v_nat, v_nat = 20, v_nat = 1
  );

  if v_nat = 20 then
    update characters set status = 'alive', hp = 1, death_timer = null where id = p_character_id;
    v_text := v_target.name || ' rolls a natural 20 on their death check and claws back to consciousness with 1 HP!';
  else
    v_next_timer := greatest(0, coalesce(v_target.death_timer, 1) - 1);
    if v_next_timer <= 0 then
      update characters set status = 'dead', death_timer = 0 where id = p_character_id;
      v_text := v_target.name || '''s death timer runs out. ' || v_target.name || ' has perished.';
    else
      update characters set death_timer = v_next_timer where id = p_character_id;
      v_text := v_target.name || ' is still dying (rolled ' || (v_roll->>'total') || '). Death timer: '
        || v_next_timer || ' round' || case when v_next_timer = 1 then '' else 's' end || ' remaining.';
    end if;
  end if;

  insert into scene_log (campaign_id, type, sender_user_id, sender_name, text, roll_source)
  values (p_campaign_id, 'roll', auth.uid(), v_target.name, v_text, 'app')
  returning * into v_scene;

  return jsonb_build_object(
    'status', (select status from characters where id = p_character_id),
    'death_timer', (select death_timer from characters where id = p_character_id),
    'nat20', v_nat = 20,
    'scene_entry', to_jsonb(v_scene)
  );
end;
$$;

revoke all on function resolve_dying_turn(uuid, uuid) from public;
grant execute on function resolve_dying_turn(uuid, uuid) to authenticated;

-- Morale: GM-triggered DC 15 WIS check for a monster group. Pass holds,
-- fail flees. GM supplies the modifier via notation (e.g. '1d20+1') same
-- as every other roll in this app -- no automatic "half the group" HP
-- detection, that threshold call stays with the GM.
create or replace function resolve_morale_check(
  p_campaign_id uuid,
  p_group_label text,
  p_wis_notation text default '1d20'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_roll jsonb;
  v_success boolean;
  v_text text;
  v_scene scene_log%rowtype;
begin
  if not is_campaign_gm(p_campaign_id) then
    raise exception 'Only the GM can call a morale check.';
  end if;
  if length(coalesce(btrim(p_group_label), '')) = 0 or length(p_group_label) > 80 then
    raise exception 'Group label is required.';
  end if;

  v_roll := roll_dice_expression(p_wis_notation);
  v_success := (v_roll->>'total')::int >= 15;

  insert into dice_rolls (
    campaign_id, roller_user_id, roller_name, notation, mode, reason,
    breakdown, total, raw_d20, is_crit, is_fumble
  ) values (
    p_campaign_id, auth.uid(), btrim(p_group_label),
    lower(regexp_replace(p_wis_notation, '\s+', '', 'g')), 'flat', 'morale check',
    v_roll->>'breakdown', (v_roll->>'total')::int, (v_roll->>'raw_d20')::int,
    coalesce((v_roll->>'raw_d20')::int = 20, false), coalesce((v_roll->>'raw_d20')::int = 1, false)
  );

  v_text := btrim(p_group_label) || ' morale check: ' || (v_roll->>'total') || ' vs DC 15 — '
    || case when v_success then 'holds.' else 'breaks and flees!' end;

  insert into scene_log (campaign_id, type, sender_user_id, sender_name, text, roll_source)
  values (p_campaign_id, 'roll', auth.uid(), btrim(p_group_label), v_text, 'app')
  returning * into v_scene;

  return jsonb_build_object(
    'success', v_success,
    'total', (v_roll->>'total')::int,
    'scene_entry', to_jsonb(v_scene)
  );
end;
$$;

revoke all on function resolve_morale_check(uuid, text, text) from public;
grant execute on function resolve_morale_check(uuid, text, text) to authenticated;
