-- Authoritative attack resolution: rolls to hit, compares against the
-- target's AC, and on a hit rolls damage and applies it to the target's
-- HP -- one audited server command, same shape as roll_campaign_dice.
--
-- Simplification, called out deliberately: a natural 20 always hits and a
-- natural 1 always misses (standard OSR house rule), but there is no
-- crit-damage multiplier -- Shadowdark's core rules don't define one, and
-- this isn't the place to invent a house rule that hasn't been decided.

create or replace function resolve_attack_roll(
  p_campaign_id uuid,
  p_attacker_name text,
  p_attack_notation text,
  p_damage_notation text,
  p_target_type text,
  p_target_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_attack jsonb;
  v_damage jsonb;
  v_target_ac int;
  v_target_hp int;
  v_target_max_hp int;
  v_target_name text;
  v_hit boolean;
  v_crit boolean;
  v_fumble boolean;
  v_damage_total int := 0;
  v_next_hp int;
  v_text text;
  v_scene scene_log%rowtype;
  v_attack_roll dice_rolls%rowtype;
begin
  if not is_campaign_member(p_campaign_id) then
    raise exception 'Campaign not found, or you are not a member.';
  end if;
  if p_target_type not in ('character', 'monster') then
    raise exception 'Unsupported target type.';
  end if;
  if length(coalesce(btrim(p_attacker_name), '')) = 0 or length(p_attacker_name) > 80 then
    raise exception 'Attacker name is required.';
  end if;

  if p_target_type = 'character' then
    select ac, hp, max_hp, name into v_target_ac, v_target_hp, v_target_max_hp, v_target_name
    from characters where id = p_target_id and campaign_id = p_campaign_id;
  else
    select ac, hp, max_hp, name into v_target_ac, v_target_hp, v_target_max_hp, v_target_name
    from encounter_monsters where id = p_target_id and campaign_id = p_campaign_id;
  end if;
  if v_target_name is null then
    raise exception 'Target not found in this campaign.';
  end if;

  v_attack := roll_dice_expression(p_attack_notation);
  v_crit := coalesce((v_attack->>'raw_d20')::int = 20, false);
  v_fumble := coalesce((v_attack->>'raw_d20')::int = 1, false);
  v_hit := v_crit or (not v_fumble and (v_attack->>'total')::int >= v_target_ac);

  insert into dice_rolls (
    campaign_id, roller_user_id, roller_name, notation, mode, reason,
    breakdown, total, raw_d20, is_crit, is_fumble
  ) values (
    p_campaign_id, auth.uid(), btrim(p_attacker_name),
    lower(regexp_replace(p_attack_notation, '\s+', '', 'g')), 'flat',
    'attack vs ' || v_target_name,
    v_attack->>'breakdown', (v_attack->>'total')::int,
    (v_attack->>'raw_d20')::int, v_crit, v_fumble
  ) returning * into v_attack_roll;

  v_next_hp := v_target_hp;
  if v_hit then
    v_damage := roll_dice_expression(p_damage_notation);
    v_damage_total := greatest(0, (v_damage->>'total')::int);
    v_next_hp := greatest(0, v_target_hp - v_damage_total);

    insert into dice_rolls (
      campaign_id, roller_user_id, roller_name, notation, mode, reason,
      breakdown, total
    ) values (
      p_campaign_id, auth.uid(), btrim(p_attacker_name),
      lower(regexp_replace(p_damage_notation, '\s+', '', 'g')), 'flat',
      'damage vs ' || v_target_name,
      v_damage->>'breakdown', v_damage_total
    );

    if p_target_type = 'character' then
      update characters set hp = v_next_hp where id = p_target_id;
    else
      update encounter_monsters set hp = v_next_hp where id = p_target_id;
    end if;
  end if;

  v_text := btrim(p_attacker_name) || ' attacks ' || v_target_name || ': '
    || (v_attack->>'total') || ' vs AC ' || v_target_ac
    || case
         when v_crit then ' — CRITICAL HIT!'
         when v_fumble then ' — fumble, automatic miss.'
         when v_hit then ' — hit.'
         else ' — miss.'
       end
    || case when v_hit then ' ' || v_damage_total || ' damage (' || v_target_name || ' now '
         || v_next_hp || '/' || v_target_max_hp || ' hp).' else '' end;

  insert into scene_log (
    campaign_id, type, sender_user_id, sender_name, text, roll_source, dice_roll_id
  ) values (
    p_campaign_id, 'roll', auth.uid(), btrim(p_attacker_name), v_text, 'app', v_attack_roll.id
  ) returning * into v_scene;

  return jsonb_build_object(
    'hit', v_hit,
    'crit', v_crit,
    'fumble', v_fumble,
    'attack_total', (v_attack->>'total')::int,
    'target_ac', v_target_ac,
    'damage', v_damage_total,
    'target_hp', v_next_hp,
    'target_max_hp', v_target_max_hp,
    'scene_entry', to_jsonb(v_scene)
  );
end;
$$;

revoke all on function resolve_attack_roll(uuid, text, text, text, text, uuid) from public;
grant execute on function resolve_attack_roll(uuid, text, text, text, text, uuid) to authenticated;
