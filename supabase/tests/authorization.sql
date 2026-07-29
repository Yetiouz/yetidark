begin;

create extension if not exists pgtap with schema extensions;
select plan(120);

-- Stable local-only identities and campaigns.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gm@example.test', crypt('test', gen_salt('bf')), now(), '{}', '{"display_name":"GM"}', now(), now()),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'player@example.test', crypt('test', gen_salt('bf')), now(), '{}', '{"display_name":"Player"}', now(), now()),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@example.test', crypt('test', gen_salt('bf')), now(), '{}', '{"display_name":"Outsider"}', now(), now()),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'unrelated@example.test', crypt('test', gen_salt('bf')), now(), '{}', '{"display_name":"Unrelated"}', now(), now());

alter table campaigns disable trigger on_campaign_created;
insert into campaigns (id, name, gm_type, gm_user_id, join_code, is_public, join_password_hash)
values
  ('10000000-0000-0000-0000-000000000001', 'Private test', 'human', '00000000-0000-0000-0000-000000000001', 'PRIVATE1', false, crypt('secret', gen_salt('bf'))),
  ('10000000-0000-0000-0000-000000000002', 'Public test', 'human', '00000000-0000-0000-0000-000000000001', 'PUBLIC01', true, null),
  ('10000000-0000-0000-0000-000000000003', 'AI test', 'ai', '00000000-0000-0000-0000-000000000001', 'AITEST01', false, null);
alter table campaigns enable trigger on_campaign_created;

insert into campaign_members (campaign_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'gm'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'player'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'gm'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'gm'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'player');

insert into encounter_monsters (campaign_id, name, ac, hp, max_hp, hidden) values
  ('10000000-0000-0000-0000-000000000001', 'Visible', 10, 1, 1, false),
  ('10000000-0000-0000-0000-000000000001', 'Hidden', 10, 1, 1, true);
insert into gm_notes (campaign_id, text, revealed) values
  ('10000000-0000-0000-0000-000000000001', 'Shared', true),
  ('10000000-0000-0000-0000-000000000001', 'Secret', false);

insert into campaign_npcs (id, campaign_id, name, status)
values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'The Warden', 'Alive');
insert into campaign_factions (id, campaign_id, name)
values ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'The Ashen Hand');
insert into campaign_treasure (id, campaign_id, item)
values ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Black Key');

insert into campaign_npc_secrets (npc_id, notes)
values ('30000000-0000-0000-0000-000000000001', 'Secret allegiance');
insert into campaign_faction_secrets (faction_id, goal, notes)
values ('30000000-0000-0000-0000-000000000002', 'Open the gate', 'Unknown patron');
insert into campaign_treasure_secrets (treasure_id, notes)
values ('30000000-0000-0000-0000-000000000003', 'Cursed when carried');

insert into characters (
  id, campaign_id, owner_user_id, name, ancestry, class, stats, hp, max_hp, ac
) values
  (
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    'Player Hero', 'Human', 'Fighter', '{}', 5, 5, 10
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'GM Hero', 'Dwarf', 'Priest', '{}', 6, 6, 12
  );
insert into character_gear (id, character_id, name)
values (
  '50000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'Torch'
);
insert into character_gear (id, character_id, name, quantity)
values (
  '50000000-0000-0000-0000-000000000002',
  '40000000-0000-0000-0000-000000000001',
  'Rations',
  2
);
insert into character_features (
  id, character_id, source, name, description, uses_max, uses_current
) values (
  '50000000-0000-0000-0000-000000000003',
  '40000000-0000-0000-0000-000000000001',
  'ancestry', 'Stealthy', 'Become invisible.', 1, 0
);
insert into character_spells (
  id, character_id, name, tier, lost, succeeded_since_rest,
  last_check_natural, last_check_total, last_check_succeeded, last_check_at
) values (
  '50000000-0000-0000-0000-000000000004',
  '40000000-0000-0000-0000-000000000001',
  'Magic Missile', 1, true, true, 5, 8, false, now()
);
insert into votes (
  id, campaign_id, poll_key, option_key, option_label, voter_user_id
) values (
  '60000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'route', 'north', 'North',
  '00000000-0000-0000-0000-000000000002'
);
insert into campaign_light_sources (
  id, campaign_id, character_id, name, total_minutes, remaining_minutes
) values (
  '70000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'Existing torch', 60, 60
);
insert into storage.objects (bucket_id, name, owner_id)
values
  (
    'maps',
    '10000000-0000-0000-0000-000000000001/private-map.png',
    '00000000-0000-0000-0000-000000000001'
  ),
  (
    'maps',
    '10000000-0000-0000-0000-000000000002/public-campaign-map.png',
    '00000000-0000-0000-0000-000000000001'
  );

select hasnt_column('public', 'campaign_npcs', 'notes', 'NPC secrets are absent from member-readable rows');
select hasnt_column('public', 'campaign_factions', 'goal', 'faction goals are absent from member-readable rows');
select hasnt_column('public', 'campaign_treasure', 'notes', 'treasure secrets are absent from member-readable rows');
select has_column('public', 'characters', 'rules_version', 'characters record the applied rules version');
select has_column('public', 'characters', 'creation_rolls', 'characters retain creation roll provenance');
select has_column('public', 'character_talents', 'roll_formula', 'talents record their roll formula');
select has_column('public', 'character_talents', 'roll_total', 'talents record their rolled total');
select has_column('public', 'character_talents', 'rules_version', 'talents record their rules version');
select has_table('public', 'campaign_events', 'campaign event ledger exists');
select is(
  (select public from storage.buckets where id = 'maps'),
  false,
  'campaign maps are stored in a private bucket'
);

-- Anonymous users cannot browse the campaign directory.
select ok(
  not has_table_privilege('anon', 'public.campaigns', 'select'),
  'anonymous cannot list public campaigns'
);
set local role anon;
select throws_ok(
  $$select count(*) from storage.objects where bucket_id = 'maps'$$,
  '42501', null,
  'anonymous users cannot read campaign map objects'
);
reset role;

-- An outsider can browse public campaigns, but not private ones.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::integer from campaigns), 1, 'outsider sees only public campaigns');
select is(
  (select count(*)::integer from storage.objects where bucket_id = 'maps'),
  0,
  'outsider cannot read maps before joining a campaign'
);
select throws_ok(
  $$insert into campaign_members (campaign_id, user_id, role)
    values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'gm')$$,
  '42501', null, 'outsider cannot self-promote to GM'
);
select lives_ok(
  $$insert into campaign_members (campaign_id, user_id, role)
    values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'player')$$,
  'outsider can join a public campaign as player'
);
select is(
  (select count(*)::integer from storage.objects where bucket_id = 'maps'),
  1,
  'new member can read the joined campaign map'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('maps', '10000000-0000-0000-0000-000000000001/attack.png', '00000000-0000-0000-0000-000000000003')$$,
  '42501', null, 'outsider cannot upload a campaign map'
);
select throws_ok(
  $$select * from join_campaign_by_code('PRIVATE1', 'wrong')$$,
  'P0001', 'Incorrect password.', 'private campaign rejects the wrong password'
);
select lives_ok(
  $$select * from join_campaign_by_code('PRIVATE1', 'secret')$$,
  'private campaign accepts the correct password'
);
select throws_ok(
  $$select complete_character_rest('40000000-0000-0000-0000-000000000001')$$,
  'P0001', 'Character not found, or you cannot rest this character.',
  'campaign member cannot rest another user character'
);
select throws_ok(
  $$select claim_ai_gm_turn('10000000-0000-0000-0000-000000000003')$$,
  'P0001', 'Campaign not found, or you are not a member.',
  'outsider cannot claim an AI-GM turn'
);
reset role;

-- A member sees revealed information, but not GM-only records or writes.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::integer from encounter_monsters), 1, 'player sees only revealed monsters');
select is((select count(*)::integer from gm_notes), 1, 'player sees only revealed notes');
select is((select count(*)::integer from campaign_npcs), 1, 'player can read public NPC details');
select is((select count(*)::integer from campaign_factions), 1, 'player can read public faction details');
select is((select count(*)::integer from campaign_treasure), 1, 'player can read public treasure details');
select is((select count(*)::integer from campaign_npc_secrets), 0, 'player cannot read NPC secrets');
select is((select count(*)::integer from campaign_faction_secrets), 0, 'player cannot read faction secrets');
select is((select count(*)::integer from campaign_treasure_secrets), 0, 'player cannot read treasure secrets');
select is(
  (select count(*)::integer from storage.objects where bucket_id = 'maps'),
  1,
  'player reads only maps for their campaigns'
);
select throws_ok(
  $$insert into campaign_npc_secrets (npc_id, notes)
    values ('30000000-0000-0000-0000-000000000001', 'Forged secret')$$,
  '42501', null, 'player cannot write NPC secrets'
);
select throws_ok(
  $$insert into encounter_monsters (campaign_id, name, ac, hp, max_hp)
    values ('10000000-0000-0000-0000-000000000001', 'Forbidden', 10, 1, 1)$$,
  '42501', null, 'player cannot create monsters'
);
select throws_ok(
  $$insert into map_cells (campaign_id, row, col, state)
    values ('10000000-0000-0000-0000-000000000001', 1, 1, 'explored')$$,
  '42501', null, 'player cannot reveal map cells'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('maps', '10000000-0000-0000-0000-000000000001/player.png', '00000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'player cannot upload a campaign map'
);
select throws_ok(
  $$insert into scene_log (campaign_id, type, sender_user_id, sender_name, text)
    values ('10000000-0000-0000-0000-000000000001', 'gm', '00000000-0000-0000-0000-000000000002', 'Player', 'Forged GM message')$$,
  '42501', null, 'player cannot post a GM message'
);
select throws_ok(
  $$insert into scene_log (campaign_id, type, sender_user_id, sender_name, text)
    values ('10000000-0000-0000-0000-000000000001', 'chat', '00000000-0000-0000-0000-000000000001', 'GM', 'Forged sender')$$,
  '42501', null, 'player cannot claim another sender id'
);
select throws_ok(
  $$insert into scene_log (campaign_id, type, sender_user_id, sender_name, text)
    values ('10000000-0000-0000-0000-000000000001', 'chat', '00000000-0000-0000-0000-000000000002', 'GM', 'Forged display name')$$,
  '42501', null, 'player cannot claim another display name'
);
select lives_ok(
  $$insert into scene_log (campaign_id, type, sender_user_id, sender_name, text)
    values ('10000000-0000-0000-0000-000000000001', 'chat', '00000000-0000-0000-0000-000000000002', 'Player', 'Hello')$$,
  'player can post attributed chat'
);
select throws_ok(
  $$insert into dice_rolls (campaign_id, roller_name, notation, mode, breakdown, total)
    values ('10000000-0000-0000-0000-000000000001', 'Goblin', '1d20', 'flat', '[10]', 10)$$,
  '42501', null, 'player cannot create an unowned dice roll'
);
select throws_ok(
  $$insert into dice_rolls (campaign_id, roller_user_id, roller_name, notation, mode, breakdown, total)
    values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'GM', '1d20', 'flat', '[10]', 10)$$,
  '42501', null, 'player cannot forge another roller identity'
);
select lives_ok(
  $$insert into dice_rolls (id, campaign_id, roller_user_id, roller_name, notation, mode, breakdown, total)
    values ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'Player', '1d20', 'flat', '[10]', 10)$$,
  'player can create an attributed dice roll'
);
select lives_ok(
  $$insert into scene_log (campaign_id, type, sender_user_id, sender_name, text, roll_source, dice_roll_id)
    values ('10000000-0000-0000-0000-000000000001', 'roll', '00000000-0000-0000-0000-000000000002', 'Player', 'rolled 10', 'app', '20000000-0000-0000-0000-000000000002')$$,
  'player can post a roll linked to their attributed dice row'
);
select throws_ok(
  $$insert into scene_log (campaign_id, type, sender_name, text)
    values ('10000000-0000-0000-0000-000000000001', 'ai_gm', 'Fake AI', 'Forged AI narration')$$,
  '42501', null, 'player cannot post an AI-GM message'
);
select throws_ok(
  $$insert into rules_documents (owner_user_id, system, title, kind, external_url)
    values ('00000000-0000-0000-0000-000000000002', 'Shadowdark', 'Fake rules', 'link', 'https://example.test')$$,
  '42501', null, 'non-GM cannot create a rules library entry'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('rules', '00000000-0000-0000-0000-000000000002/fake.pdf', '00000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'non-GM cannot upload a rules file'
);
select lives_ok(
  $$update characters
    set hp = 4
    where id = '40000000-0000-0000-0000-000000000001'$$,
  'character owner can update their character inside its campaign'
);
select throws_ok(
  $$update characters
    set campaign_id = '10000000-0000-0000-0000-000000000002'
    where id = '40000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'character owner cannot move a character to another campaign'
);
select lives_ok(
  $$update votes
    set option_key = 'south', option_label = 'South'
    where id = '60000000-0000-0000-0000-000000000001'$$,
  'voter can update their vote inside its campaign'
);
select throws_ok(
  $$update votes
    set campaign_id = '10000000-0000-0000-0000-000000000002'
    where id = '60000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'voter cannot move a vote to another campaign'
);
select lives_ok(
  $$insert into campaign_light_sources (
      campaign_id, character_id, name, total_minutes, remaining_minutes
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      'Player torch', 60, 60
    )$$,
  'character owner can add a light source to the matching campaign'
);
select throws_ok(
  $$insert into campaign_light_sources (
      campaign_id, character_id, name, total_minutes, remaining_minutes
    ) values (
      '10000000-0000-0000-0000-000000000002',
      '40000000-0000-0000-0000-000000000001',
      'Cross-campaign torch', 60, 60
    )$$,
  '42501', null, 'character owner cannot add their light source to another campaign'
);
select throws_ok(
  $$update campaign_light_sources
    set campaign_id = '10000000-0000-0000-0000-000000000002'
    where id = '70000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'character owner cannot move a light source to another campaign'
);
update character_gear
set character_id = '40000000-0000-0000-0000-000000000002'
where id = '50000000-0000-0000-0000-000000000001';
select is(
  (
    select character_id from character_gear
    where id = '50000000-0000-0000-0000-000000000001'
  ),
  '40000000-0000-0000-0000-000000000001'::uuid,
  'character owner cannot reassign gear to another character'
);
select throws_ok(
  $$insert into campaign_threads (campaign_id, title)
    values ('10000000-0000-0000-0000-000000000001', 'Forged thread')$$,
  '42501', null, 'player cannot create a campaign thread'
);
select throws_ok(
  $$insert into campaign_clocks (campaign_id, name)
    values ('10000000-0000-0000-0000-000000000001', 'Forged clock')$$,
  '42501', null, 'player cannot create a campaign clock'
);
select throws_ok(
  $$insert into campaign_timeline_entries (campaign_id, entry)
    values ('10000000-0000-0000-0000-000000000001', 'Forged history')$$,
  '42501', null, 'player cannot create a campaign timeline entry'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('avatars', '40000000-0000-0000-0000-000000000001/avatar.png', '00000000-0000-0000-0000-000000000002')$$,
  'character owner can upload their avatar'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('avatars', '40000000-0000-0000-0000-000000000002/avatar.png', '00000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'player cannot upload another character avatar'
);
select throws_ok(
  $$update storage.objects
    set name = '40000000-0000-0000-0000-000000000002/stolen.png'
    where bucket_id = 'avatars'
      and name = '40000000-0000-0000-0000-000000000001/avatar.png'$$,
  '42501', null, 'player cannot move their avatar into another character folder'
);
select lives_ok(
  $$select complete_character_rest('40000000-0000-0000-0000-000000000001')$$,
  'character owner can complete a full rest'
);
select is(
  (select hp from characters where id = '40000000-0000-0000-0000-000000000001'),
  5,
  'full rest restores character HP'
);
select is(
  (select quantity from character_gear where id = '50000000-0000-0000-0000-000000000002'),
  1,
  'full rest consumes exactly one ration'
);
select is(
  (select uses_current from character_features where id = '50000000-0000-0000-0000-000000000003'),
  1,
  'full rest restores daily feature uses'
);
select ok(
  (
    select not lost
      and not succeeded_since_rest
      and last_check_natural is null
    from character_spells
    where id = '50000000-0000-0000-0000-000000000004'
  ),
  'full rest clears spell locks and cycle history'
);
select is(
  (
    select count(*)::integer
    from campaign_events
    where event_type = 'character.full_rest_completed'
      and entity_id = '40000000-0000-0000-0000-000000000001'
  ),
  1,
  'full rest records one campaign event'
);
select is(
  (adjust_character_resource(
    '40000000-0000-0000-0000-000000000001', 'hp', -2, 'Trap damage'
  )->>'after')::numeric,
  3::numeric,
  'character owner can adjust HP through the command'
);
select is(
  (select hp from characters where id = '40000000-0000-0000-0000-000000000001'),
  3,
  'resource command updates the character atomically'
);
select is(
  (
    select payload->>'reason'
    from campaign_events
    where event_type = 'character.resource_adjusted'
    order by created_at desc
    limit 1
  ),
  'Trap damage',
  'resource event records its reason'
);
select is(
  (
    select actor_user_id
    from campaign_events
    where event_type = 'character.resource_adjusted'
    order by created_at desc
    limit 1
  ),
  '00000000-0000-0000-0000-000000000002'::uuid,
  'resource event derives the authenticated actor'
);
select throws_ok(
  $$insert into campaign_events (
      campaign_id, actor_user_id, event_type, entity_type, entity_id
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      'forged', 'character',
      '40000000-0000-0000-0000-000000000001'
    )$$,
  '42501', null, 'player cannot forge a campaign event'
);
select throws_ok(
  $$select adjust_character_resource(
      '40000000-0000-0000-0000-000000000002', 'hp', -1, null
    )$$,
  'P0001', 'Character not found, or you cannot adjust this character.',
  'player cannot adjust another character'
);
select lives_ok(
  $$select add_character_gear(
      '40000000-0000-0000-0000-000000000001', 'Rope', 1, 1, 'Silk'
    )$$,
  'character owner can add gear through the command'
);
select is(
  (
    select count(*)::integer from campaign_events
    where event_type = 'character.gear_added'
      and payload->'item'->>'name' = 'Rope'
  ),
  1,
  'adding gear records one event'
);
select lives_ok(
  $$select set_character_gear_equipped(
      (select id from character_gear
       where character_id = '40000000-0000-0000-0000-000000000001'
         and name = 'Rope'),
      true
    )$$,
  'character owner can equip gear through the command'
);
select lives_ok(
  $$select remove_character_gear(
      (select id from character_gear
       where character_id = '40000000-0000-0000-0000-000000000001'
         and name = 'Rope')
    )$$,
  'character owner can remove gear through the command'
);
select is(
  (
    select count(*)::integer from campaign_events
    where event_type in (
      'character.gear_added', 'character.gear_equipped', 'character.gear_removed'
    )
      and payload::text like '%Rope%'
  ),
  3,
  'gear lifecycle records each mutation'
);
select lives_ok(
  $$select add_character_spell(
      '40000000-0000-0000-0000-000000000001',
      'Light', 1, 'Close', '1 hour', 'Creates light.'
    )$$,
  'character owner can add a spell through the command'
);
select lives_ok(
  $$select set_character_spell_prepared(
      (select id from character_spells
       where character_id = '40000000-0000-0000-0000-000000000001'
         and name = 'Light'),
      true
    )$$,
  'character owner can prepare a spell through the command'
);
select ok(
  (
    select (record_character_spell_check(id, 15, 15)->>'succeeded_since_rest')::boolean
    from character_spells
    where character_id = '40000000-0000-0000-0000-000000000001'
      and name = 'Light'
  ),
  'successful spell check begins its rest cycle'
);
select ok(
  (
    select (record_character_spell_check(id, 5, 5)->>'lost')::boolean
    from character_spells
    where character_id = '40000000-0000-0000-0000-000000000001'
      and name = 'Light'
  ),
  'failed spell check after success locks the spell'
);
select is(
  (
    select count(*)::integer from campaign_events
    where event_type in (
      'character.spell_added', 'character.spell_prepared',
      'character.spell_check_recorded'
    )
      and payload::text like '%Light%'
  ),
  4,
  'spell setup and checks record each mutation'
);
select lives_ok(
  $$select remove_character_spell(
      (select id from character_spells
       where character_id = '40000000-0000-0000-0000-000000000001'
         and name = 'Light')
    )$$,
  'character owner can remove a spell through the command'
);
select is(
  (
    select count(*)::integer from campaign_events
    where event_type = 'character.spell_removed'
      and payload->'spell'->>'name' = 'Light'
  ),
  1,
  'removing a spell records one event'
);
select throws_ok(
  $$select add_character_gear(
      '40000000-0000-0000-0000-000000000002', 'Stolen', 1, 1, null
    )$$,
  'P0001', 'Character not found, or you cannot manage this character.',
  'player cannot add gear to another character'
);
select throws_ok(
  $$select record_character_spell_check(
      '50000000-0000-0000-0000-000000000004', 0, 10
    )$$,
  'P0001', 'Natural spell check roll must be from 1 to 20.',
  'spell command rejects an invalid natural roll'
);
update character_gear
set equipped = true
where id = '50000000-0000-0000-0000-000000000001';
select is(
  (
    select equipped from character_gear
    where id = '50000000-0000-0000-0000-000000000001'
  ),
  false,
  'owner cannot bypass the gear command with a direct update'
);
delete from character_spells
where id = '50000000-0000-0000-0000-000000000004';
select is(
  (
    select count(*)::integer from character_spells
    where id = '50000000-0000-0000-0000-000000000004'
  ),
  1,
  'owner cannot bypass the spell command with a direct delete'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(
  (select count(*)::integer from campaign_events),
  0,
  'outsider cannot read campaign events'
);
reset role;

-- The campaign GM retains the intended capabilities.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::integer from encounter_monsters), 2, 'GM sees hidden monsters');
select is((select count(*)::integer from gm_notes), 2, 'GM sees secret notes');
select is((select count(*)::integer from campaign_npc_secrets), 1, 'GM sees NPC secrets');
select is((select count(*)::integer from campaign_faction_secrets), 1, 'GM sees faction secrets');
select is((select count(*)::integer from campaign_treasure_secrets), 1, 'GM sees treasure secrets');
select lives_ok(
  $$insert into map_cells (campaign_id, row, col, state)
    values ('10000000-0000-0000-0000-000000000001', 1, 1, 'explored')$$,
  'GM can reveal map cells'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('maps', '10000000-0000-0000-0000-000000000001/gm.png', '00000000-0000-0000-0000-000000000001')$$,
  'GM can upload their campaign map'
);
select throws_ok(
  $$insert into campaigns (name, gm_type, gm_user_id, join_code)
    values ('Spoofed owner', 'human', '00000000-0000-0000-0000-000000000002', 'SPOOFED1')$$,
  '42501', null, 'campaign creator cannot spoof the recorded GM'
);
select lives_ok(
  $$insert into campaigns (name, gm_type, gm_user_id, join_code)
    values ('Owned campaign', 'human', '00000000-0000-0000-0000-000000000001', 'OWNED001')$$,
  'campaign creator can create a correctly-owned campaign'
);
select lives_ok(
  $$insert into scene_log (campaign_id, type, sender_user_id, sender_name, text)
    values ('10000000-0000-0000-0000-000000000001', 'gm', '00000000-0000-0000-0000-000000000001', 'GM', 'Legitimate GM message')$$,
  'GM can post an attributed GM message'
);
select lives_ok(
  $$insert into dice_rolls (id, campaign_id, roller_name, notation, mode, breakdown, total)
    values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Goblin', '1d20', 'flat', '[12]', 12)$$,
  'GM can create an unowned initiative roll'
);
select lives_ok(
  $$insert into scene_log (campaign_id, type, sender_name, text, roll_source, dice_roll_id)
    values ('10000000-0000-0000-0000-000000000001', 'roll', 'Goblin', 'rolled 12', 'app', '20000000-0000-0000-0000-000000000001')$$,
  'GM can post an unowned initiative roll'
);
select lives_ok(
  $$insert into rules_documents (owner_user_id, system, title, kind, external_url)
    values ('00000000-0000-0000-0000-000000000001', 'Shadowdark', 'GM rules', 'link', 'https://example.test')$$,
  'GM can create their rules library entry'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id)
    values ('rules', '00000000-0000-0000-0000-000000000001/rules.pdf', '00000000-0000-0000-0000-000000000001')$$,
  'GM can upload their rules file'
);
reset role;

-- AI-GM generation starts are serialized, bounded, and completed only by the
-- service role. These checks exercise the public RPC boundary and its state.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$select claim_ai_gm_turn('10000000-0000-0000-0000-000000000001')$$,
  'P0001', 'This campaign does not use the AI GM.',
  'member cannot claim a turn for a human-GM campaign'
);
select ok(
  not has_table_privilege('authenticated', 'public.ai_gm_turn_state', 'select'),
  'authenticated users cannot inspect AI-GM lease state'
);
select ok(
  not has_function_privilege('authenticated', 'public.complete_ai_gm_turn(uuid,uuid,text,text)', 'execute'),
  'authenticated users cannot complete an AI-GM turn'
);
select ok(
  not has_function_privilege('authenticated', 'public.release_ai_gm_turn(uuid,uuid)', 'execute'),
  'authenticated users cannot release an AI-GM turn'
);
select is(
  claim_ai_gm_turn('10000000-0000-0000-0000-000000000003')->>'status',
  'claimed',
  'campaign member can atomically claim an available AI-GM turn'
);
select is(
  claim_ai_gm_turn('10000000-0000-0000-0000-000000000003')->>'status',
  'busy',
  'a concurrent AI-GM turn is rejected while the lease is active'
);
reset role;

select ok(
  release_ai_gm_turn(
    '10000000-0000-0000-0000-000000000003',
    (select active_claim_token from ai_gm_turn_state where campaign_id = '10000000-0000-0000-0000-000000000003')
  ),
  'service role can release a failed AI-GM turn'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  claim_ai_gm_turn('10000000-0000-0000-0000-000000000003')->>'status',
  'claimed',
  'released AI-GM turn can be claimed again'
);
reset role;

select ok(
  complete_ai_gm_turn(
    '10000000-0000-0000-0000-000000000003',
    (select active_claim_token from ai_gm_turn_state where campaign_id = '10000000-0000-0000-0000-000000000003'),
    'AI test — AI GM',
    'The guarded turn completed.'
  ),
  'service role atomically completes the claimed AI-GM turn'
);
select is(
  (select count(*)::integer from scene_log where campaign_id = '10000000-0000-0000-0000-000000000003' and type = 'ai_gm'),
  1,
  'completing a claim writes exactly one AI-GM narration'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  claim_ai_gm_turn('10000000-0000-0000-0000-000000000003')->>'status',
  'skipped',
  'completed input cannot generate duplicate narration'
);
select lives_ok(
  $$insert into scene_log (campaign_id, type, sender_user_id, sender_name, text)
    values ('10000000-0000-0000-0000-000000000003', 'chat', '00000000-0000-0000-0000-000000000002', 'Player', 'Continue onward')$$,
  'new player input makes another AI-GM turn eligible'
);
select is(
  claim_ai_gm_turn('10000000-0000-0000-0000-000000000003')->>'status',
  'claimed',
  'new player input can claim a third generation start'
);
reset role;

select ok(
  release_ai_gm_turn(
    '10000000-0000-0000-0000-000000000003',
    (select active_claim_token from ai_gm_turn_state where campaign_id = '10000000-0000-0000-0000-000000000003')
  ),
  'third generation lease can be released'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  claim_ai_gm_turn('10000000-0000-0000-0000-000000000003')->>'status',
  'claimed',
  'campaign can claim the fourth start inside the minute window'
);
reset role;

select ok(
  release_ai_gm_turn(
    '10000000-0000-0000-0000-000000000003',
    (select active_claim_token from ai_gm_turn_state where campaign_id = '10000000-0000-0000-0000-000000000003')
  ),
  'fourth generation lease can be released'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  claim_ai_gm_turn('10000000-0000-0000-0000-000000000003')->>'status',
  'rate_limited',
  'campaign cannot start more than four AI-GM generations per minute'
);
reset role;

select * from finish();
rollback;
