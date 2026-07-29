begin;

create extension if not exists pgtap with schema extensions;
select plan(34);

-- Stable local-only identities and campaigns.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gm@example.test', crypt('test', gen_salt('bf')), now(), '{}', '{"display_name":"GM"}', now(), now()),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'player@example.test', crypt('test', gen_salt('bf')), now(), '{}', '{"display_name":"Player"}', now(), now()),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'outsider@example.test', crypt('test', gen_salt('bf')), now(), '{}', '{"display_name":"Outsider"}', now(), now());

alter table campaigns disable trigger on_campaign_created;
insert into campaigns (id, name, gm_type, gm_user_id, join_code, is_public, join_password_hash)
values
  ('10000000-0000-0000-0000-000000000001', 'Private test', 'human', '00000000-0000-0000-0000-000000000001', 'PRIVATE1', false, crypt('secret', gen_salt('bf'))),
  ('10000000-0000-0000-0000-000000000002', 'Public test', 'human', '00000000-0000-0000-0000-000000000001', 'PUBLIC01', true, null);
alter table campaigns enable trigger on_campaign_created;

insert into campaign_members (campaign_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'gm'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'player'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'gm');

insert into encounter_monsters (campaign_id, name, ac, hp, max_hp, hidden) values
  ('10000000-0000-0000-0000-000000000001', 'Visible', 10, 1, 1, false),
  ('10000000-0000-0000-0000-000000000001', 'Hidden', 10, 1, 1, true);
insert into gm_notes (campaign_id, text, revealed) values
  ('10000000-0000-0000-0000-000000000001', 'Shared', true),
  ('10000000-0000-0000-0000-000000000001', 'Secret', false);

-- Anonymous users cannot browse the campaign directory.
select ok(
  not has_table_privilege('anon', 'public.campaigns', 'select'),
  'anonymous cannot list public campaigns'
);

-- An outsider can browse public campaigns, but not private ones.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::integer from campaigns), 1, 'outsider sees only public campaigns');
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
reset role;

-- A member sees revealed information, but not GM-only records or writes.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::integer from encounter_monsters), 1, 'player sees only revealed monsters');
select is((select count(*)::integer from gm_notes), 1, 'player sees only revealed notes');
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
reset role;

-- The campaign GM retains the intended capabilities.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::integer from encounter_monsters), 2, 'GM sees hidden monsters');
select is((select count(*)::integer from gm_notes), 2, 'GM sees secret notes');
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

select * from finish();
rollback;
