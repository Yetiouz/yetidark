-- Generate app dice on the server and reserve direct inserts for clearly
-- labeled, self-reported physical rolls.

create or replace function roll_dice_expression(p_notation text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_clean text := lower(regexp_replace(coalesce(p_notation, ''), '\s+', '', 'g'));
  v_match text[];
  v_sign int;
  v_token text;
  v_count int;
  v_sides int;
  v_roll int;
  v_index int;
  v_subtotal int;
  v_total int := 0;
  v_parts text[] := '{}';
  v_rolls text[];
  v_dice_terms int := 0;
  v_raw_candidate int;
  v_single_positive_d20 boolean := false;
  v_total_dice int := 0;
begin
  if length(v_clean) > 100 or v_clean !~
    '^[+-]?([0-9]*d[0-9]+|[0-9]+)([+-]([0-9]*d[0-9]+|[0-9]+))*$' then
    raise exception 'Bad dice notation.';
  end if;

  for v_match in
    select regexp_matches(v_clean, '([+-]?)([0-9]*d[0-9]+|[0-9]+)', 'g')
  loop
    v_sign := case when v_match[1] = '-' then -1 else 1 end;
    v_token := v_match[2];

    if position('d' in v_token) > 0 then
      v_count := coalesce(nullif(split_part(v_token, 'd', 1), '')::int, 1);
      v_sides := split_part(v_token, 'd', 2)::int;
      if v_count < 1 or v_count > 100 or v_sides < 2 or v_sides > 1000 then
        raise exception 'Dice terms support 1-100 dice with 2-1000 sides.';
      end if;
      v_total_dice := v_total_dice + v_count;
      if v_total_dice > 100 then raise exception 'A roll may contain at most 100 dice.'; end if;

      v_dice_terms := v_dice_terms + 1;
      v_rolls := '{}';
      v_subtotal := 0;
      for v_index in 1..v_count loop
        v_roll := floor(random() * v_sides)::int + 1;
        v_rolls := array_append(v_rolls, v_roll::text);
        v_subtotal := v_subtotal + v_roll;
        if v_count = 1 and v_sides = 20 then
          v_raw_candidate := v_roll;
          v_single_positive_d20 := v_sign > 0;
        end if;
      end loop;
      v_total := v_total + v_sign * v_subtotal;
      v_parts := array_append(
        v_parts,
        (case when v_sign > 0 then '+' else '-' end)
          || v_count || 'd' || v_sides || '[' || array_to_string(v_rolls, ',') || ']'
      );
    else
      v_sides := v_token::int;
      v_total := v_total + v_sign * v_sides;
      v_parts := array_append(
        v_parts, (case when v_sign > 0 then '+' else '-' end) || v_sides
      );
    end if;
  end loop;

  return jsonb_build_object(
    'total', v_total,
    'breakdown', ltrim(array_to_string(v_parts, ' '), '+'),
    'raw_d20', case when v_dice_terms = 1 then v_raw_candidate else null end,
    'is_single_d20', v_dice_terms = 1 and v_single_positive_d20
  );
end;
$$;

create or replace function roll_campaign_dice(
  p_campaign_id uuid,
  p_notation text,
  p_mode text default 'flat',
  p_reason text default null,
  p_roller_name text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_first jsonb;
  v_second jsonb;
  v_kept jsonb;
  v_roll dice_rolls%rowtype;
  v_scene scene_log%rowtype;
  v_roller_user_id uuid;
  v_roller_name text;
  v_reason text := nullif(btrim(p_reason), '');
  v_mode_label text;
  v_flag text;
  v_text text;
begin
  if not is_campaign_member(p_campaign_id) then
    raise exception 'Campaign not found, or you are not a member.';
  end if;
  if p_mode is null or p_mode not in ('flat', 'advantage', 'disadvantage') then
    raise exception 'Unsupported dice mode.';
  end if;
  if length(coalesce(v_reason, '')) > 500 then
    raise exception 'Roll reason is too long.';
  end if;

  if nullif(btrim(p_roller_name), '') is not null then
    if not is_campaign_gm(p_campaign_id) then
      raise exception 'Only the GM can roll for an unowned subject.';
    end if;
    v_roller_user_id := null;
    v_roller_name := btrim(p_roller_name);
  else
    v_roller_user_id := auth.uid();
    select display_name into v_roller_name from profiles where id = auth.uid();
    if nullif(btrim(v_roller_name), '') is null then
      raise exception 'Your profile needs a display name before rolling.';
    end if;
  end if;

  v_first := roll_dice_expression(p_notation);
  if p_mode in ('advantage', 'disadvantage') then
    if not (v_first->>'is_single_d20')::boolean then
      raise exception 'Advantage/disadvantage require one positive d20 plus modifiers.';
    end if;
    v_second := roll_dice_expression(p_notation);
    v_kept := case
      when p_mode = 'advantage'
        and (v_first->>'total')::int >= (v_second->>'total')::int then v_first
      when p_mode = 'disadvantage'
        and (v_first->>'total')::int <= (v_second->>'total')::int then v_first
      else v_second
    end;
    v_kept := jsonb_set(
      v_kept, '{breakdown}',
      to_jsonb('[' || (v_first->>'breakdown') || '] vs ['
        || (v_second->>'breakdown') || ']')
    );
  else
    v_kept := v_first;
  end if;

  insert into dice_rolls (
    campaign_id, roller_user_id, roller_name, notation, mode, reason,
    breakdown, total, raw_d20, is_crit, is_fumble
  ) values (
    p_campaign_id, v_roller_user_id, v_roller_name,
    lower(regexp_replace(p_notation, '\s+', '', 'g')), p_mode, v_reason,
    v_kept->>'breakdown', (v_kept->>'total')::int,
    (v_kept->>'raw_d20')::int,
    coalesce((v_kept->>'raw_d20')::int = 20, false),
    coalesce((v_kept->>'raw_d20')::int = 1, false)
  )
  returning * into v_roll;

  v_mode_label := case
    when p_mode = 'advantage' then ' (advantage)'
    when p_mode = 'disadvantage' then ' (disadvantage)'
    else ''
  end;
  v_flag := case
    when v_roll.is_crit then ' — CRITICAL!'
    when v_roll.is_fumble then ' — fumble!'
    else ''
  end;
  v_text := 'rolled ' || v_roll.notation || v_mode_label || ': '
    || v_roll.total || v_flag
    || case when v_reason is not null then ' — ' || v_reason else '' end;

  insert into scene_log (
    campaign_id, type, sender_user_id, sender_name, text,
    roll_source, dice_roll_id
  ) values (
    p_campaign_id, 'roll', v_roller_user_id, v_roller_name, v_text,
    'app', v_roll.id
  )
  returning * into v_scene;

  return jsonb_build_object('roll', to_jsonb(v_roll), 'scene_entry', to_jsonb(v_scene));
end;
$$;

drop policy if exists "members can log attributed dice rolls" on dice_rolls;
create policy "members can report their own physical dice" on dice_rolls
  for insert
  to authenticated
  with check (
    is_campaign_member(campaign_id)
    and roller_user_id = auth.uid()
    and roller_name = (
      select p.display_name from profiles p where p.id = auth.uid()
    )
    and mode = 'self'
    and breakdown = 'self-reported'
  );

drop policy if exists "members can post attributed scene entries" on scene_log;
create policy "members can post attributed scene entries" on scene_log
  for insert
  to authenticated
  with check (
    is_campaign_member(campaign_id)
    and (
      (
        type = 'chat'
        and sender_user_id = auth.uid()
        and sender_name = (
          select p.display_name from profiles p where p.id = auth.uid()
        )
        and dice_roll_id is null
        and roll_source is null
      )
      or (
        type = 'roll'
        and sender_user_id = auth.uid()
        and sender_name = (
          select p.display_name from profiles p where p.id = auth.uid()
        )
        and roll_source = 'self'
        and exists (
          select 1 from dice_rolls d
          where d.id = scene_log.dice_roll_id
            and d.campaign_id = scene_log.campaign_id
            and d.roller_user_id = auth.uid()
            and d.mode = 'self'
        )
      )
      or (
        is_campaign_gm(campaign_id)
        and type in ('gm', 'narration')
        and sender_user_id = auth.uid()
        and sender_name = (
          select p.display_name from profiles p where p.id = auth.uid()
        )
      )
    )
  );

revoke all on function roll_dice_expression(text) from public;
revoke all on function roll_campaign_dice(uuid, text, text, text, text) from public;
grant execute on function roll_campaign_dice(uuid, text, text, text, text) to authenticated;
