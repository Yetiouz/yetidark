-- ==== 20260802150950 drop_orphaned_votes_table ====
-- Phase 0 #27: drop the orphaned `votes` table.
-- The vote feature was removed end-to-end from the client in PR #70.
-- Confirmed zero references in src/ (GitHub code search) and no other
-- tables hold FKs into votes. It carried 1 live row (a vote cast after
-- the client removal) and 3 RLS policies, both dropped with the table.
DROP TABLE IF EXISTS public.votes;

-- ==== 20260802151001 pin_search_path_on_security_functions ====
-- Phase 0 #5: pin search_path on the 4 flagged SECURITY DEFINER-adjacent
-- functions to close the "role mutable search_path" advisor lint.
ALTER FUNCTION public.is_campaign_member(uuid) SET search_path = public;
ALTER FUNCTION public.is_campaign_gm(uuid) SET search_path = public;
ALTER FUNCTION public.can_read_rules_documents(uuid, text) SET search_path = public;
ALTER FUNCTION public.ability_modifier(integer) SET search_path = public;

-- ==== 20260802151241 tighten_avatars_bucket_select_policy ====
-- Phase 0 #6: tighten the avatars bucket SELECT policy from list-all to
-- fetch-only. Confirmed the client only ever calls storage.upload() and
-- storage.getPublicUrl() against 'avatars' (never .list()/.download()).
-- `avatars` is a public bucket, so getPublicUrl() fetches are served via
-- the public object endpoint and bypass RLS entirely — they are
-- unaffected by this change. The only thing this blanket SELECT policy
-- enabled was full bucket enumeration through the storage API/list
-- endpoint, which this drop removes.
DROP POLICY IF EXISTS "anyone can view character avatars" ON storage.objects;

-- ==== 20260802151408 document_ai_gm_turn_state_rls_intent ====
-- Phase 0 #8: confirmed intentional, not breakage. ai_gm_turn_state has
-- RLS enabled with zero policies by design: all reads/writes go through
-- the SECURITY DEFINER functions claim_ai_gm_turn (granted to
-- authenticated), and complete_ai_gm_turn/release_ai_gm_turn (granted to
-- service_role, called from the ai-gm-turn Edge Function's service-role
-- client). No client code queries this table directly. Direct
-- table access from anon/authenticated must stay blocked - do not add a
-- permissive policy here without routing through those functions instead.
COMMENT ON TABLE public.ai_gm_turn_state IS
  'AI-GM turn claim/rate-limit state. RLS enabled, intentionally zero direct policies: all access is mediated by claim_ai_gm_turn/complete_ai_gm_turn/release_ai_gm_turn (SECURITY DEFINER). Do not add a direct SELECT/UPDATE policy for anon/authenticated - route through those functions instead.';

-- ==== 20260802151538 fix_auth_rls_initplan_policies ====
-- Phase 0 #22: rewrite the 12 flagged auth_rls_initplan policies to cache
-- auth.uid() as (select auth.uid()) so it's evaluated once per query
-- instead of once per row. Semantics unchanged - only wrapping the
-- direct auth.uid() calls; helper function calls (is_campaign_gm,
-- is_campaign_member, is_current_user_gm) are untouched.

ALTER POLICY "users can update their own profile" ON public.profiles
  USING (id = (select auth.uid()));

ALTER POLICY "users can leave a campaign" ON public.campaign_members
  USING (user_id = (select auth.uid()));

ALTER POLICY "owner or gm can write a character's talents" ON public.character_talents
  USING (EXISTS ( SELECT 1 FROM characters c
    WHERE ((c.id = character_talents.character_id)
      AND ((c.owner_user_id = (select auth.uid())) OR is_campaign_gm(c.campaign_id)))));

ALTER POLICY "gm owner manages their rules documents" ON public.rules_documents
  USING ((owner_user_id = (select auth.uid())) AND is_current_user_gm())
  WITH CHECK ((owner_user_id = (select auth.uid())) AND is_current_user_gm());

ALTER POLICY "owner or gm can write a character's features" ON public.character_features
  USING (EXISTS ( SELECT 1 FROM characters c
    WHERE ((c.id = character_features.character_id)
      AND ((c.owner_user_id = (select auth.uid())) OR is_campaign_gm(c.campaign_id)))));

ALTER POLICY "authenticated users can create campaigns" ON public.campaigns
  WITH CHECK ((((select auth.uid()) IS NOT NULL))
    AND (((gm_type = 'human'::text) AND (gm_user_id = (select auth.uid())))
      OR ((gm_type = 'ai'::text) AND (gm_user_id IS NULL))));

ALTER POLICY "users can add themselves to public campaigns" ON public.campaign_members
  WITH CHECK (((user_id = (select auth.uid())) AND (role = 'player'::text)
    AND (EXISTS ( SELECT 1 FROM campaigns c
      WHERE ((c.id = campaign_members.campaign_id) AND (c.is_public = true))))));

ALTER POLICY "owners and gm can update characters" ON public.characters
  USING (((owner_user_id = (select auth.uid())) AND is_campaign_member(campaign_id)) OR is_campaign_gm(campaign_id))
  WITH CHECK (((owner_user_id = (select auth.uid())) AND is_campaign_member(campaign_id)) OR is_campaign_gm(campaign_id));

ALTER POLICY "owner or gm can add a character's gear" ON public.character_gear
  WITH CHECK (EXISTS ( SELECT 1 FROM characters c
    WHERE ((c.id = character_gear.character_id)
      AND ((c.owner_user_id = (select auth.uid())) OR is_campaign_gm(c.campaign_id)))));

ALTER POLICY "owner or gm can add a character's spells" ON public.character_spells
  WITH CHECK (EXISTS ( SELECT 1 FROM characters c
    WHERE ((c.id = character_spells.character_id)
      AND ((c.owner_user_id = (select auth.uid())) OR is_campaign_gm(c.campaign_id)))));

ALTER POLICY "members can report their own physical dice" ON public.dice_rolls
  WITH CHECK (is_campaign_member(campaign_id)
    AND (roller_user_id = (select auth.uid()))
    AND (roller_name = ( SELECT p.display_name FROM profiles p WHERE (p.id = (select auth.uid()))))
    AND (mode = 'self'::text) AND (breakdown = 'self-reported'::text));

ALTER POLICY "members can post attributed scene entries" ON public.scene_log
  WITH CHECK (is_campaign_member(campaign_id)
    AND (
      ((type = 'chat'::text) AND (sender_user_id = (select auth.uid()))
        AND (sender_name = ( SELECT p.display_name FROM profiles p WHERE (p.id = (select auth.uid()))))
        AND (dice_roll_id IS NULL) AND (roll_source IS NULL))
      OR ((type = 'roll'::text) AND (sender_user_id = (select auth.uid()))
        AND (sender_name = ( SELECT p.display_name FROM profiles p WHERE (p.id = (select auth.uid()))))
        AND (roll_source = 'self'::text)
        AND (EXISTS ( SELECT 1 FROM dice_rolls d
          WHERE ((d.id = scene_log.dice_roll_id) AND (d.campaign_id = scene_log.campaign_id)
            AND (d.roller_user_id = (select auth.uid())) AND (d.mode = 'self'::text)))))
      OR (is_campaign_gm(campaign_id) AND (type = ANY (ARRAY['gm'::text, 'narration'::text]))
        AND (sender_user_id = (select auth.uid()))
        AND (sender_name = ( SELECT p.display_name FROM profiles p WHERE (p.id = (select auth.uid())))))
    ));

-- ==== 20260802151636 add_missing_fk_indexes_drop_unused ====
-- Phase 0 #24: add covering indexes for all 26 flagged unindexed FKs, and
-- drop the 2 flagged unused indexes. INFO-level performance lints.

CREATE INDEX IF NOT EXISTS idx_ai_gm_turn_state_active_input_id ON public.ai_gm_turn_state (active_input_id);
CREATE INDEX IF NOT EXISTS idx_ai_gm_turn_state_last_completed_input_id ON public.ai_gm_turn_state (last_completed_input_id);
CREATE INDEX IF NOT EXISTS idx_campaign_clocks_campaign_id ON public.campaign_clocks (campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_events_actor_user_id ON public.campaign_events (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_factions_campaign_id ON public.campaign_factions (campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_light_sources_campaign_id ON public.campaign_light_sources (campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_light_sources_character_id ON public.campaign_light_sources (character_id);
CREATE INDEX IF NOT EXISTS idx_campaign_members_user_id ON public.campaign_members (user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_npcs_campaign_id ON public.campaign_npcs (campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_threads_campaign_id ON public.campaign_threads (campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_timeline_entries_campaign_id ON public.campaign_timeline_entries (campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_treasure_campaign_id ON public.campaign_treasure (campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_gm_user_id ON public.campaigns (gm_user_id);
CREATE INDEX IF NOT EXISTS idx_character_features_character_id ON public.character_features (character_id);
CREATE INDEX IF NOT EXISTS idx_character_gear_character_id ON public.character_gear (character_id);
CREATE INDEX IF NOT EXISTS idx_character_spells_character_id ON public.character_spells (character_id);
CREATE INDEX IF NOT EXISTS idx_character_talents_character_id ON public.character_talents (character_id);
CREATE INDEX IF NOT EXISTS idx_characters_campaign_id ON public.characters (campaign_id);
CREATE INDEX IF NOT EXISTS idx_characters_owner_user_id ON public.characters (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_dice_rolls_campaign_id ON public.dice_rolls (campaign_id);
CREATE INDEX IF NOT EXISTS idx_dice_rolls_roller_user_id ON public.dice_rolls (roller_user_id);
CREATE INDEX IF NOT EXISTS idx_encounter_monsters_campaign_id ON public.encounter_monsters (campaign_id);
CREATE INDEX IF NOT EXISTS idx_rules_documents_owner_user_id ON public.rules_documents (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_scene_log_campaign_id ON public.scene_log (campaign_id);
CREATE INDEX IF NOT EXISTS idx_scene_log_dice_roll_id ON public.scene_log (dice_roll_id);
CREATE INDEX IF NOT EXISTS idx_scene_log_sender_user_id ON public.scene_log (sender_user_id);

DROP INDEX IF EXISTS public.gm_notes_entity_idx;
DROP INDEX IF EXISTS public.campaign_events_entity_idx;

-- ==== 20260802151839 consolidate_multiple_permissive_policies ====
-- Phase 0 #25: consolidate multiple permissive policies (62 lint entries,
-- 12 distinct tables). Confirmed via is_campaign_gm()/is_campaign_member()
-- definitions: is_campaign_gm always implies is_campaign_member (the GM
-- has their own campaign_members row with role='gm'), and
-- can_read_rules_documents() already covers the owning GM
-- (target_owner = auth.uid() short-circuits). So on 11 tables the "gm/owner
-- writes X" FOR ALL policy's SELECT grant is fully redundant with the
-- dedicated read policy - splitting the write policy into
-- INSERT/UPDATE/DELETE-only removes the redundant SELECT evaluation
-- without changing any effective permission.

-- campaign_factions
DROP POLICY "gm writes factions" ON public.campaign_factions;
CREATE POLICY "gm writes factions - insert" ON public.campaign_factions FOR INSERT WITH CHECK (is_campaign_gm(campaign_id));
CREATE POLICY "gm writes factions - update" ON public.campaign_factions FOR UPDATE USING (is_campaign_gm(campaign_id)) WITH CHECK (is_campaign_gm(campaign_id));
CREATE POLICY "gm writes factions - delete" ON public.campaign_factions FOR DELETE USING (is_campaign_gm(campaign_id));

-- campaign_npcs
DROP POLICY "gm writes npcs" ON public.campaign_npcs;
CREATE POLICY "gm writes npcs - insert" ON public.campaign_npcs FOR INSERT WITH CHECK (is_campaign_gm(campaign_id));
CREATE POLICY "gm writes npcs - update" ON public.campaign_npcs FOR UPDATE USING (is_campaign_gm(campaign_id)) WITH CHECK (is_campaign_gm(campaign_id));
CREATE POLICY "gm writes npcs - delete" ON public.campaign_npcs FOR DELETE USING (is_campaign_gm(campaign_id));

-- campaign_threads
DROP POLICY "gm writes campaign threads" ON public.campaign_threads;
CREATE POLICY "gm writes campaign threads - insert" ON public.campaign_threads FOR INSERT WITH CHECK (is_campaign_gm(campaign_id));
CREATE POLICY "gm writes campaign threads - update" ON public.campaign_threads FOR UPDATE USING (is_campaign_gm(campaign_id)) WITH CHECK (is_campaign_gm(campaign_id));
CREATE POLICY "gm writes campaign threads - delete" ON public.campaign_threads FOR DELETE USING (is_campaign_gm(campaign_id));

-- campaign_timeline_entries
DROP POLICY "gm writes the timeline" ON public.campaign_timeline_entries;
CREATE POLICY "gm writes the timeline - insert" ON public.campaign_timeline_entries FOR INSERT WITH CHECK (is_campaign_gm(campaign_id));
CREATE POLICY "gm writes the timeline - update" ON public.campaign_timeline_entries FOR UPDATE USING (is_campaign_gm(campaign_id)) WITH CHECK (is_campaign_gm(campaign_id));
CREATE POLICY "gm writes the timeline - delete" ON public.campaign_timeline_entries FOR DELETE USING (is_campaign_gm(campaign_id));

-- campaign_treasure
DROP POLICY "gm writes treasure" ON public.campaign_treasure;
CREATE POLICY "gm writes treasure - insert" ON public.campaign_treasure FOR INSERT WITH CHECK (is_campaign_gm(campaign_id));
CREATE POLICY "gm writes treasure - update" ON public.campaign_treasure FOR UPDATE USING (is_campaign_gm(campaign_id)) WITH CHECK (is_campaign_gm(campaign_id));
CREATE POLICY "gm writes treasure - delete" ON public.campaign_treasure FOR DELETE USING (is_campaign_gm(campaign_id));

-- encounter_monsters
DROP POLICY "only gm writes monsters" ON public.encounter_monsters;
CREATE POLICY "only gm writes monsters - insert" ON public.encounter_monsters FOR INSERT WITH CHECK (is_campaign_gm(campaign_id));
CREATE POLICY "only gm writes monsters - update" ON public.encounter_monsters FOR UPDATE USING (is_campaign_gm(campaign_id)) WITH CHECK (is_campaign_gm(campaign_id));
CREATE POLICY "only gm writes monsters - delete" ON public.encounter_monsters FOR DELETE USING (is_campaign_gm(campaign_id));

-- gm_notes
DROP POLICY "only gm writes notes" ON public.gm_notes;
CREATE POLICY "only gm writes notes - insert" ON public.gm_notes FOR INSERT WITH CHECK (is_campaign_gm(campaign_id));
CREATE POLICY "only gm writes notes - update" ON public.gm_notes FOR UPDATE USING (is_campaign_gm(campaign_id)) WITH CHECK (is_campaign_gm(campaign_id));
CREATE POLICY "only gm writes notes - delete" ON public.gm_notes FOR DELETE USING (is_campaign_gm(campaign_id));

-- turn_order
DROP POLICY "gm updates turn order" ON public.turn_order;
CREATE POLICY "gm updates turn order - insert" ON public.turn_order FOR INSERT WITH CHECK (is_campaign_gm(campaign_id));
CREATE POLICY "gm updates turn order - update" ON public.turn_order FOR UPDATE USING (is_campaign_gm(campaign_id)) WITH CHECK (is_campaign_gm(campaign_id));
CREATE POLICY "gm updates turn order - delete" ON public.turn_order FOR DELETE USING (is_campaign_gm(campaign_id));

-- character_talents (owner or gm)
DROP POLICY "owner or gm can write a character's talents" ON public.character_talents;
CREATE POLICY "owner or gm can write a character's talents - insert" ON public.character_talents FOR INSERT
  WITH CHECK (EXISTS ( SELECT 1 FROM characters c WHERE ((c.id = character_talents.character_id) AND ((c.owner_user_id = (select auth.uid())) OR is_campaign_gm(c.campaign_id)))));
CREATE POLICY "owner or gm can write a character's talents - update" ON public.character_talents FOR UPDATE
  USING (EXISTS ( SELECT 1 FROM characters c WHERE ((c.id = character_talents.character_id) AND ((c.owner_user_id = (select auth.uid())) OR is_campaign_gm(c.campaign_id)))))
  WITH CHECK (EXISTS ( SELECT 1 FROM characters c WHERE ((c.id = character_talents.character_id) AND ((c.owner_user_id = (select auth.uid())) OR is_campaign_gm(c.campaign_id)))));
CREATE POLICY "owner or gm can write a character's talents - delete" ON public.character_talents FOR DELETE
  USING (EXISTS ( SELECT 1 FROM characters c WHERE ((c.id = character_talents.character_id) AND ((c.owner_user_id = (select auth.uid())) OR is_campaign_gm(c.campaign_id)))));

-- character_features (owner or gm)
DROP POLICY "owner or gm can write a character's features" ON public.character_features;
CREATE POLICY "owner or gm can write a character's features - insert" ON public.character_features FOR INSERT
  WITH CHECK (EXISTS ( SELECT 1 FROM characters c WHERE ((c.id = character_features.character_id) AND ((c.owner_user_id = (select auth.uid())) OR is_campaign_gm(c.campaign_id)))));
CREATE POLICY "owner or gm can write a character's features - update" ON public.character_features FOR UPDATE
  USING (EXISTS ( SELECT 1 FROM characters c WHERE ((c.id = character_features.character_id) AND ((c.owner_user_id = (select auth.uid())) OR is_campaign_gm(c.campaign_id)))))
  WITH CHECK (EXISTS ( SELECT 1 FROM characters c WHERE ((c.id = character_features.character_id) AND ((c.owner_user_id = (select auth.uid())) OR is_campaign_gm(c.campaign_id)))));
CREATE POLICY "owner or gm can write a character's features - delete" ON public.character_features FOR DELETE
  USING (EXISTS ( SELECT 1 FROM characters c WHERE ((c.id = character_features.character_id) AND ((c.owner_user_id = (select auth.uid())) OR is_campaign_gm(c.campaign_id)))));

-- rules_documents (owner-gm manages; can_read_rules_documents() already
-- short-circuits on target_owner = auth.uid(), so the owner's SELECT
-- access is fully covered by the read policy)
DROP POLICY "gm owner manages their rules documents" ON public.rules_documents;
CREATE POLICY "gm owner manages their rules documents - insert" ON public.rules_documents FOR INSERT TO authenticated
  WITH CHECK ((owner_user_id = (select auth.uid())) AND is_current_user_gm());
CREATE POLICY "gm owner manages their rules documents - update" ON public.rules_documents FOR UPDATE TO authenticated
  USING ((owner_user_id = (select auth.uid())) AND is_current_user_gm())
  WITH CHECK ((owner_user_id = (select auth.uid())) AND is_current_user_gm());
CREATE POLICY "gm owner manages their rules documents - delete" ON public.rules_documents FOR DELETE TO authenticated
  USING ((owner_user_id = (select auth.uid())) AND is_current_user_gm());

-- campaigns: merge the two independent SELECT policies into one. Scoping
-- to `authenticated` is safe - is_campaign_member() requires auth.uid()
-- to match a row, which is always false for anon, so anon never actually
-- benefited from the "public" role grant on "members can read their
-- campaigns".
DROP POLICY "authenticated users can read public campaigns" ON public.campaigns;
DROP POLICY "members can read their campaigns" ON public.campaigns;
CREATE POLICY "members or public campaigns are readable" ON public.campaigns FOR SELECT TO authenticated
  USING (is_public = true OR is_campaign_member(id));

-- ==== 20260802151907 add_gm_notes_campaign_id_index ====
-- Phase 0 #24 follow-up: dropping the unused gm_notes_entity_idx (a
-- composite index) also removed its incidental coverage of the
-- gm_notes_campaign_id_fkey FK, which the advisor re-scan caught. Add a
-- dedicated single-column index for that FK.
CREATE INDEX IF NOT EXISTS idx_gm_notes_campaign_id ON public.gm_notes (campaign_id);

-- ==== 20260802153748 close_gear_spell_direct_insert_and_stray_grants ====
-- Phase 1 #28: close the direct-INSERT write-path hole on character_gear
-- and character_spells, mirroring migration 036's fix for `characters`.
--
-- Confirmed via a full frontend grep (CharacterSheet.jsx, CharacterBuilder.jsx,
-- GameTable.jsx, GmDashboard.jsx): every gear/spell mutation already goes
-- through add_character_gear / remove_character_gear /
-- set_character_gear_equipped / add_character_spell / remove_character_spell
-- / set_character_spell_prepared / record_character_spell_check, or through
-- create_character's p_gear param at creation time. The only direct
-- `.from('character_gear'|'character_spells')` calls in the client are
-- `.select()` reads. So dropping the direct INSERT policy breaks nothing
-- live.
--
-- Why this matters: add_character_gear/add_character_spell write both the
-- row AND a campaign_events ledger entry (confirmed in the pgTAP suite --
-- "adding gear records one event"). The RLS INSERT policy being open let
-- a direct API insert (bypassing the RPC entirely) create a gear/spell row
-- with no ledger entry, silently desyncing the event log from reality --
-- the same failure mode 036 closed for `characters`.
--
-- UPDATE/DELETE were already fully closed (no RLS policy exists for
-- either), so no change needed there beyond revoking the stray blanket
-- grants below, which were inert but inconsistent with the least-privilege
-- model 036 established and worth removing on principle.

drop policy "owner or gm can add a character's gear" on character_gear;
drop policy "owner or gm can add a character's spells" on character_spells;

revoke update, delete on character_gear from authenticated, anon;
revoke update, delete on character_spells from authenticated, anon;

-- ==== 20260802192306 block_gm_leaving_campaign_members ====
-- Decision Queue #52: Profile.jsx's GM-leave block (bug #1, fixed 2026-08-02) is
-- currently enforced client-side only. The "users can leave a campaign" DELETE
-- policy on campaign_members has no role check, so a GM could still remove their
-- own membership row via a direct API call and strand the campaign with no GM.
--
-- This adds a BEFORE DELETE trigger that raises when a GM's own membership row
-- is deleted WHILE the campaign it belongs to still exists. The "still exists"
-- check is deliberate: campaign_members.campaign_id has ON DELETE CASCADE from
-- campaigns, so deleting a campaign (the only real way to get rid of a GM's
-- membership today, and the path this session's own QA cleanup uses) must keep
-- working -- by the time the cascade fires this trigger, the parent campaigns
-- row is already gone from this transaction's view, so the guard is a no-op.
-- Only a direct, campaign-still-alive DELETE against a GM's own row is blocked.
--
-- Known residual gap, not addressed here: campaign_members.user_id also has
-- ON DELETE CASCADE from profiles. If a future "delete my account" feature ever
-- ships, deleting a GM's profile while their campaign still exists would hit
-- this same guard and fail the whole operation. No such feature exists in the
-- app today, so this is deliberately left as a known limitation rather than
-- worked around speculatively -- flag it if account deletion is ever built.

create or replace function public.prevent_gm_leaving_campaign()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if OLD.role = 'gm' and exists (select 1 from campaigns where id = OLD.campaign_id) then
    raise exception 'The GM cannot leave a campaign. Transfer GM ownership or delete the campaign instead.';
  end if;
  return OLD;
end;
$$;

create trigger prevent_gm_leaving_campaign_trigger
before delete on public.campaign_members
for each row
execute function public.prevent_gm_leaving_campaign();


-- ==== 20260802210042 add_encounter_monster_hp_visible ====
alter table public.encounter_monsters
  add column hp_visible boolean not null default false;

comment on column public.encounter_monsters.hp_visible is
  'GM-controlled second visibility toggle (Milestone 1 locked decision: presence vs. HP known independently). Existing "hidden" already hides the monster row entirely from players via RLS (see "gm sees all monsters, players see non-hidden"); hp_visible is a separate, narrower reveal of just hp/max_hp for an otherwise-visible monster. Note: unlike hidden, this is not enforced at the RLS/realtime layer (no column-level RLS in Postgres) -- the client is expected to gate rendering on this flag. Acceptable for this app''s threat model; flagged in the task list rather than silently treated as equivalent to hidden''s DB-level guarantee.';

-- ==== 20260802215512 add_character_gear_category ====
-- Decision Queue #38. Small fixed category set (not a fuller taxonomy),
-- freeform damage_die/properties text copied verbatim from
-- CharacterBuilder.jsx's WEAPONS/ARMOR/SHIELD constants (not structured
-- property flags) -- both per explicit user decision. Unblocks real
-- per-category gear icons and weapon damage/property display; consumable
-- "Use" buttons and the CharacterSheet Attacks table (#44) are follow-up
-- work, not done in this migration.
alter table public.character_gear
  add column category text not null default 'gear'
    check (category in ('weapon', 'armor', 'shield', 'consumable', 'gear')),
  add column damage_die text,
  add column properties text;

comment on column public.character_gear.category is
  'Decision Queue #38 (resolved 2026-08-02). Small fixed set by explicit decision, not a fuller taxonomy. Drives gear icon selection and (eventually) consumable "Use" button gating.';
comment on column public.character_gear.damage_die is
  'Weapon-only, e.g. "1d8" or "1d8/1d10" for a versatile weapon. Freeform text copied verbatim from CharacterBuilder.jsx''s WEAPONS constant (explicit decision, not structured property flags) -- was never persisted past character creation before this column existed.';
comment on column public.character_gear.properties is
  'Weapon/armor property text (e.g. "Finesse, thrown", "Disadvantage on stealth, swim"), copied verbatim from the WEAPONS/ARMOR/SHIELD constants. Freeform by explicit decision -- zone-range validation on attacks would need structured tags instead, deferred until that''s actually built.';

-- Backfill existing rows (created before this column existed) by matching
-- against the known weapon/armor/shield/starting-kit names. A name that
-- doesn't match anything (custom/renamed gear) stays at the 'gear' default
-- rather than being guessed at.
update character_gear set category = 'weapon', damage_die = v.damage_die, properties = v.properties
from (values
  ('Bastard sword', '1d8/1d10', 'Versatile'),
  ('Club', '1d4', '-'),
  ('Crossbow', '1d6', 'Two-handed, loud'),
  ('Dagger', '1d4', 'Finesse, thrown'),
  ('Greataxe', '1d8/1d10', 'Versatile'),
  ('Greatsword', '1d12', 'Two-handed'),
  ('Javelin', '1d4', 'Thrown'),
  ('Longbow', '1d8', 'Two-handed'),
  ('Longsword', '1d8', '-'),
  ('Mace', '1d6', '-'),
  ('Shortbow', '1d4', 'Two-handed'),
  ('Shortsword', '1d6', '-'),
  ('Spear', '1d6', 'Thrown'),
  ('Staff', '1d4', 'Two-handed'),
  ('Warhammer', '1d10', 'Two-handed'),
  ('Blowgun', '1', 'Ranged, silent from hiding'),
  ('Bolas', '-', 'Ranged, entangles legs'),
  ('Morningstar', '1d6/1d8', 'Versatile'),
  ('Pike', '1d10', 'Two-handed, reach'),
  ('Razor chain', '1d6', 'Finesse, lash'),
  ('Scimitar', '1d6', 'Finesse'),
  ('Shuriken', '1d4', 'Ranged'),
  ('Sling', '1d4', '-'),
  ('Whip', '1d4', 'Finesse, lash'),
  ('Handaxe', '1d6', 'Finesse, thrown'),
  ('Stave', '1d6', 'Two-handed')
) as v(name, damage_die, properties)
where character_gear.name = v.name;

update character_gear set category = 'armor', properties = v.properties
from (values
  ('Leather armor', '-'),
  ('Chainmail', 'Disadvantage on stealth, swim'),
  ('Plate mail', 'No swim, disadvantage on stealth')
) as v(name, properties)
where character_gear.name = v.name;

update character_gear set category = 'shield', properties = 'Occupies one hand'
where name = 'Shield';

update character_gear set category = 'consumable'
where name in ('Torch', 'Rations');
-- Backpack, Flint and steel, and both "Rope, 50'"/"Rope, 60'" variants
-- (live data has both -- the STARTING_KIT constant's length changed at
-- some point) stay at the 'gear' default; no explicit update needed.

-- ==== 20260802215540 wire_gear_category_into_create_and_add_character_gear ====
-- create_character: accept category/damage_die/properties per gear item
-- (CharacterBuilder.jsx now supplies them from its WEAPONS/ARMOR/SHIELD
-- constants) so new characters get real gear classification from day one,
-- not just via the one-time backfill above.
create or replace function public.create_character(p_campaign_id uuid, p_character jsonb, p_gear jsonb DEFAULT '[]'::jsonb, p_talents jsonb DEFAULT '[]'::jsonb, p_features jsonb DEFAULT '[]'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    base_ac, dex_applies, is_shield, category, damage_die, properties
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
    coalesce(item.is_shield, false),
    coalesce(nullif(item.category, ''), 'gear'),
    nullif(btrim(item.damage_die), ''),
    nullif(btrim(item.properties), '')
  from jsonb_to_recordset(p_gear) as item(
    name text,
    slots numeric,
    equipped boolean,
    quantity int,
    notes text,
    base_ac int,
    dex_applies boolean,
    is_shield boolean,
    category text,
    damage_die text,
    properties text
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
$function$;

-- add_character_gear: accept optional category/damage_die/properties too,
-- for parity -- any future non-freeform "add gear" UI (e.g. a weapon
-- picker on CharacterSheet) can now pass real values. Existing call sites
-- (CharacterSheet.jsx's freeform add-gear box) don't pass these, so they
-- fall through to the same 'gear'/null defaults as before this migration
-- -- no behavior change for the current UI.
create or replace function public.add_character_gear(p_character_id uuid, p_name text, p_slots numeric DEFAULT 1, p_quantity integer DEFAULT 1, p_notes text DEFAULT NULL::text, p_category text DEFAULT 'gear'::text, p_damage_die text DEFAULT NULL::text, p_properties text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  if coalesce(nullif(btrim(p_category), ''), 'gear') not in ('weapon', 'armor', 'shield', 'consumable', 'gear') then
    raise exception 'Invalid gear category.';
  end if;

  insert into character_gear (character_id, name, slots, quantity, notes, equipped, category, damage_die, properties)
  values (
    p_character_id, btrim(p_name), p_slots, p_quantity,
    nullif(btrim(p_notes), ''), false,
    coalesce(nullif(btrim(p_category), ''), 'gear'),
    nullif(btrim(p_damage_die), ''),
    nullif(btrim(p_properties), '')
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
$function$;

-- ==== 20260802215601 drop_stale_add_character_gear_overload ====
-- create or replace with 3 new params created an overload instead of
-- replacing in place (Postgres keys function identity on the parameter
-- type list, not names) -- caught immediately via pg_proc. Drop the old
-- 5-arg signature so exactly one add_character_gear exists; PostgREST
-- can otherwise report "Could not choose the best candidate function"
-- on an RPC call that satisfies both overloads via defaults.
drop function if exists public.add_character_gear(uuid, text, numeric, integer, text);

-- ==== 20260802223601 add_move_character_zone_rpc ====
-- Player self-movement + per-turn action economy (Phase 3 build order item
-- 4). User decisions: (1) self-movement restricted to one zone-step
-- (Close<->Near, Near<->Far -- not Close<->Far in one turn), matching
-- Shadowdark's "one action + Near movement" rule, while the GM's own
-- right-click zone control stays unrestricted; (2) moved/acted tracked as
-- two independent per-turn flags, not one combined flag.
--
-- No new table/column -- turn_order.order_list is already a JSONB array of
-- per-character entries ({id, name, status, dexMod?}), and per-turn state
-- belongs there: it naturally resets each time a character's entry is
-- rotated to status='acting' (see rollInitiative/advanceTurn in
-- GmDashboard.jsx), which is exactly when a fresh moved/acted flag pair is
-- needed. A new `characters` column would need its own separate reset
-- logic tied to the same rotation and would just duplicate that.
--
-- Convention (documented here since it's schema-shape, not a real column):
-- every order_list entry SHOULD carry `moved` and `acted` booleans,
-- defaulting to false and reset to false whenever that entry becomes
-- status='acting'. `moved` is fully wired below (move_character_zone
-- enforces and sets it). `acted` is reserved schema only in this pass --
-- resolve_attack_roll identifies its attacker by free-text name, not
-- character_id (a preexisting gap noted in delve-phase3-scope.md), so it
-- can't reliably set `acted` on turn_order without a riskier signature
-- change to already-shipped combat RPCs. Flagged as follow-up, not faked
-- with a UI indicator for something nothing sets yet.
comment on table public.turn_order is
  'One row per campaign; order_list is a JSONB array of {id, name, status, dexMod?, moved?, acted?} entries, clockwise-rotated by advanceTurn(). moved/acted are per-turn flags that should reset to false whenever an entry becomes status=''acting''. moved is enforced by move_character_zone(); acted is reserved schema only as of 2026-08-02 (Decision: player self-movement) -- no RPC sets it yet, see that migration''s comment for why.';

create or replace function public.move_character_zone(p_campaign_id uuid, p_character_id uuid, p_zone text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_character characters%rowtype;
  v_order jsonb;
  v_entry jsonb;
  v_current_zone text;
  v_adjacent text[];
  v_scene scene_log%rowtype;
  v_text text;
begin
  if p_zone not in ('close', 'near', 'far') then
    raise exception 'Invalid zone.';
  end if;

  select * into v_character from characters where id = p_character_id and campaign_id = p_campaign_id;
  if v_character.id is null then
    raise exception 'Character not found in this campaign.';
  end if;
  if v_character.owner_user_id is distinct from auth.uid() then
    raise exception 'You can only move your own character.';
  end if;

  select order_list into v_order from turn_order where campaign_id = p_campaign_id;
  if v_order is null then
    raise exception 'No active turn order.';
  end if;

  select elem into v_entry
  from jsonb_array_elements(v_order) as elem
  where elem->>'id' = p_character_id::text
  limit 1;

  if v_entry is null then
    raise exception '% is not in the current turn order.', v_character.name;
  end if;
  if v_entry->>'status' is distinct from 'acting' then
    raise exception 'It is not % turn.', v_character.name;
  end if;
  if coalesce((v_entry->>'moved')::boolean, false) then
    raise exception '% has already moved this turn.', v_character.name;
  end if;

  v_current_zone := coalesce(v_character.zone, 'near');
  v_adjacent := case v_current_zone
    when 'close' then array['near']
    when 'near' then array['close', 'far']
    when 'far' then array['near']
    else array['close', 'near', 'far']
  end;
  if v_current_zone = p_zone then
    raise exception '% is already in that zone.', v_character.name;
  end if;
  if not (p_zone = any(v_adjacent)) then
    raise exception '% cannot move from % to % in one turn.', v_character.name, v_current_zone, p_zone;
  end if;

  update characters set zone = p_zone where id = p_character_id;

  update turn_order
  set order_list = (
    select jsonb_agg(
      case when e->>'id' = p_character_id::text
        then e || jsonb_build_object('moved', true)
        else e
      end
    )
    from jsonb_array_elements(v_order) as e
  ),
  updated_at = now()
  where campaign_id = p_campaign_id;

  v_text := v_character.name || ' moved to ' || initcap(p_zone) || '.';
  insert into scene_log (campaign_id, type, sender_user_id, sender_name, text)
  values (p_campaign_id, 'narration', auth.uid(), v_character.name, v_text)
  returning * into v_scene;

  return jsonb_build_object(
    'zone', p_zone,
    'scene_entry', to_jsonb(v_scene)
  );
end;
$function$;

grant execute on function public.move_character_zone(uuid, uuid, text) to authenticated;

-- ==== 20260803001132 add_danger_level_and_crawling_round ====
alter table public.campaigns
  add column danger_level text check (danger_level is null or danger_level in ('unsafe', 'risky', 'deadly')),
  add column crawling_round integer not null default 0,
  add column rounds_since_check integer not null default 0;

comment on column public.campaigns.danger_level is 'Shadowdark danger level (Unsafe/Risky/Deadly, rulebook p.84/112) for the environment the party is currently exploring. Drives the crawling-round random-encounter check cadence via advance_crawling_round(). Null until the GM sets it -- no default danger level is assumed, matching the standing "honest placeholder, never a faked value" rule.';
comment on column public.campaigns.crawling_round is 'Running count of crawling rounds (exploration, non-combat) elapsed this session, advanced via advance_crawling_round(). A separate counter from turn_order''s combat rounds -- crawling and combat rounds are mechanically distinct per the rulebook (p.84: "Characters are in crawling rounds while not in combat").';
comment on column public.campaigns.rounds_since_check is 'Rounds elapsed since the last random-encounter check, reset to 0 whenever advance_crawling_round() triggers a check. Compared against danger_level''s cadence (unsafe=3, risky=2, deadly=1, rulebook p.112) to decide when the next check is due.';

create or replace function public.advance_crawling_round(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_danger text;
  v_round int;
  v_since int;
  v_cadence int;
  v_check_due boolean := false;
begin
  if not is_campaign_gm(p_campaign_id) then
    raise exception 'Only the GM can advance crawling rounds.';
  end if;

  select danger_level into v_danger from campaigns where id = p_campaign_id;
  if v_danger is null then
    raise exception 'Set a danger level before advancing crawling rounds.';
  end if;

  v_cadence := case v_danger
    when 'unsafe' then 3
    when 'risky' then 2
    when 'deadly' then 1
  end;

  update campaigns
    set crawling_round = crawling_round + 1,
        rounds_since_check = rounds_since_check + 1
    where id = p_campaign_id
    returning crawling_round, rounds_since_check into v_round, v_since;

  if v_since >= v_cadence then
    v_check_due := true;
    update campaigns set rounds_since_check = 0 where id = p_campaign_id;
    v_since := 0;
  end if;

  return jsonb_build_object(
    'crawling_round', v_round,
    'rounds_since_check', v_since,
    'check_due', v_check_due,
    'danger_level', v_danger,
    'cadence', v_cadence
  );
end;
$$;

comment on function public.advance_crawling_round(uuid) is 'GM-only. Increments campaigns.crawling_round/rounds_since_check; when rounds_since_check reaches danger_level''s cadence (unsafe=3, risky=2, deadly=1), resets it to 0 and returns check_due=true so the client can trigger the existing rollQuickTable(''Random encounter check'', ''1d6'') roll -- this RPC only owns the counter state, not the dice roll itself, matching the existing separation between authoritative state RPCs and roll_campaign_dice.';

grant execute on function public.advance_crawling_round(uuid) to authenticated;


-- ==== 20260803001146 add_scene_secrets_table ====
create table public.scene_secrets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete cascade,
  name text not null,
  description text,
  zone text not null default 'near' check (zone in ('close', 'near', 'far')),
  state text not null default 'hidden' check (state in ('hidden', 'tell_visible', 'revealed')),
  created_at timestamptz not null default now()
);

comment on table public.scene_secrets is 'Traps, hidden doors, and other map secrets (ROADMAP.md Milestone 1 locked decision, 2026-08-03 build). Three-state visibility instead of a binary hidden/revealed flag, matching how Shadowdark actually handles secrets -- physical tells and player description, not a flat perception roll. state is a manual GM toggle (hidden -> tell_visible -> revealed -> back to hidden), same pattern as encounter_monsters.hidden/hp_visible -- no automatic class-based reveal logic, an explicit decision (not built speculatively). Positioned by zone (Close/Near/Far), the same model as characters/encounter_monsters, not the old row/col map_cells grid which the zone model superseded.';
comment on column public.scene_secrets.state is 'hidden = invisible to players (RLS-blocked, same enforcement level as encounter_monsters.hidden). tell_visible/revealed = players see the full row including description -- same client-trust-only distinction already documented and accepted for encounter_monsters.hp_visible (no column-level RLS exists in Postgres); the difference between the two is purely narrative/UI treatment on the GM''s side, not a data-visibility difference.';

alter table public.scene_secrets enable row level security;

create policy "gm sees all secrets, players see non-hidden"
  on public.scene_secrets for select
  using (is_campaign_gm(campaign_id) or (is_campaign_member(campaign_id) and state <> 'hidden'));

create policy "only gm writes secrets - insert"
  on public.scene_secrets for insert
  with check (is_campaign_gm(campaign_id));

create policy "only gm writes secrets - update"
  on public.scene_secrets for update
  using (is_campaign_gm(campaign_id))
  with check (is_campaign_gm(campaign_id));

create policy "only gm writes secrets - delete"
  on public.scene_secrets for delete
  using (is_campaign_gm(campaign_id));

create index idx_scene_secrets_campaign_id on public.scene_secrets(campaign_id);

alter publication supabase_realtime add table public.scene_secrets;

-- Extend gm_notes' contextual-inspector entity_type to cover secrets too --
-- the Selected panel's note UI (GmDashboard.jsx) is already fully generic
-- on entity_type/entity_id, it was only ever gated by this constraint plus
-- ZoneScene.jsx not passing secret tokens through onSelectToken (both
-- addressed in the same frontend change as this migration).
alter table public.gm_notes drop constraint gm_notes_entity_type_check;
alter table public.gm_notes add constraint gm_notes_entity_type_check
  check (entity_type is null or entity_type = any (array['character', 'monster', 'secret']));


-- ==== 20260803004115 add_character_luck_tokens ====
alter table public.characters
  add column luck_tokens integer not null default 0 check (luck_tokens >= 0);

comment on column public.characters.luck_tokens is 'Shadowdark luck tokens (rulebook p.79) -- GM-awarded for exceptional roleplaying/heroism/sacrifice. A player cashes one in to reroll a roll they just made, or gives it to a companion; both of those are narrated table actions the GM adjusts this count for, not automated by the app (Decision, 2026-08-03: track + GM award/spend only, no automated reroll/transfer wiring -- matches the depth the player actually asked for). Normally capped at 1 per player; campaigns.modes_of_play including ''pulp'' removes that cap entirely (rulebook p.111). The cap is enforced client-side in GmDashboard.jsx''s award control by reading the campaign''s already-real modes_of_play, not by a DB constraint here -- the cap depends on campaign-level mode state, which this column has no way to see on its own.';


-- ==== 20260803022859 add_advance_character_level_rpc ====
create or replace function public.advance_character_level(
  p_character_id uuid,
  p_hp_gain int,
  p_talents jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_character characters%rowtype;
  v_required_xp int;
  v_new_level int;
  v_talent_count int;
begin
  if p_hp_gain is null or p_hp_gain <= 0 or p_hp_gain > 20 then
    raise exception 'HP gain must be between 1 and 20.';
  end if;

  if jsonb_typeof(p_talents) <> 'array' then
    raise exception 'Talents must be an array.';
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
    raise exception 'Character not found, or you cannot advance this character.';
  end if;

  if v_character.level >= 10 then
    raise exception 'Already at the maximum level (10).';
  end if;

  v_required_xp := v_character.level * 10;
  if v_character.xp < v_required_xp then
    raise exception 'Needs % XP to level up (has %).', v_required_xp, v_character.xp;
  end if;

  v_new_level := v_character.level + 1;

  update characters
  set level = v_new_level,
      xp = 0,
      max_hp = max_hp + p_hp_gain
  where id = p_character_id
  returning * into v_character;

  insert into character_talents (
    character_id, source, description, roll_formula, roll_total, rules_version
  )
  select
    p_character_id,
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

  get diagnostics v_talent_count = row_count;

  insert into campaign_events (
    campaign_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_character.campaign_id,
    auth.uid(),
    'character.leveled_up',
    'character',
    p_character_id,
    jsonb_build_object(
      'new_level', v_new_level,
      'hp_gain', p_hp_gain,
      'new_max_hp', v_character.max_hp,
      'talent_count', v_talent_count
    )
  );

  insert into scene_log (
    campaign_id, type, sender_user_id, sender_name, text
  ) values (
    v_character.campaign_id,
    'narration',
    auth.uid(),
    v_character.name,
    v_character.name || ' reached level ' || v_new_level || ' — +' || p_hp_gain || ' max HP'
      || case when v_talent_count > 0 then ', new talent' else '' end
  );

  return jsonb_build_object(
    'character_id', p_character_id,
    'level', v_new_level,
    'xp', 0,
    'max_hp', v_character.max_hp,
    'hp', v_character.hp,
    'talent_count', v_talent_count
  );
end;
$function$;

grant execute on function public.advance_character_level(uuid, int, jsonb) to authenticated;

comment on function public.advance_character_level(uuid, int, jsonb) is 'Shadowdark level-up (rulebook p.39): requires current_level x 10 XP (hard-enforced, matching the rulebook''s deterministic formula -- Decision, 2026-08-03), resets XP to 0, adds p_hp_gain to max_hp (client rolls/enters the class hit die client-side and submits the result, same trust model create_character already uses for starting HP -- no per-class hit-die validation here since the RPC has no knowledge of class data, which lives in src/game/rules/content.js on the client), and inserts any p_talents rows (only sent by the client on levels 1/3/5/7/9 per the class talent table). Caps at level 10 (Shadowdark''s max). Only max_hp changes, not current hp, per the rulebook''s literal wording ("add it to your maximum HP") -- a level-up does not also heal the character.';

-- ==== 20260803031202 add_carouse_character_rpc ====
create or replace function public.carouse_character(
  p_character_id uuid,
  p_cost_tier int
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_character characters%rowtype;
  v_cost numeric;
  v_bonus int;
  v_roll jsonb;
  v_raw int;
  v_total int;
  v_xp_gain int;
  v_grants_luck boolean := false;
  v_pct numeric := 0;
  v_outcome text;
  v_coin_after_cost numeric;
  v_coin_loss numeric := 0;
  v_scene scene_log%rowtype;
  v_luck_cap int;
  v_pulp boolean;
begin
  if p_cost_tier is null or p_cost_tier < 0 or p_cost_tier > 6 then
    raise exception 'Cost tier must be between 0 and 6.';
  end if;

  select * into v_character from characters where id = p_character_id for update;
  if not found or not (
    v_character.owner_user_id = auth.uid()
    or is_campaign_gm(v_character.campaign_id)
  ) then
    raise exception 'Character not found, or you cannot carouse as this character.';
  end if;

  v_cost := (array[30,100,300,600,900,1200,1800])[p_cost_tier + 1];
  v_bonus := p_cost_tier;

  if v_character.coin < v_cost then
    raise exception '% needs % gp to carouse at this tier (has %).', v_character.name, v_cost, v_character.coin;
  end if;

  v_coin_after_cost := v_character.coin - v_cost;

  v_roll := roll_dice_expression('1d8');
  v_raw := (v_roll->>'total')::int;
  v_total := v_raw + v_bonus;

  -- Outcome table, rulebook p.93.
  if v_total >= 14 then
    v_xp_gain := 6; v_pct := 0;
    v_outcome := 'You wake up deep inside the local ruler''s stronghold holding one of their priceless family heirlooms. Footsteps approach. (GM: if the character escapes, a 90-100 treasure-table item.)';
  elsif v_total = 13 then
    v_xp_gain := 6; v_pct := 0;
    v_outcome := 'You pulled off an ill-advised heist inside a feared sorcerer''s tower. (GM: an 80-100 treasure-table item.)';
  elsif v_total = 12 then
    v_xp_gain := 5; v_pct := 0;
    v_outcome := 'You defeated a noble in a highly wagered drinking contest. (GM: a debt owed by the noble.)';
  elsif v_total = 11 then
    v_xp_gain := 5; v_pct := 0;
    v_outcome := 'You performed a humiliating prank on a despised and corrupt merchant. (GM: an ally in the City Watch.)';
  elsif v_total = 10 then
    v_xp_gain := 5; v_pct := 0; v_grants_luck := true;
    v_outcome := 'An angry wizard cast a deadly spell at you, but you reflected it off your cup. Gain a luck token.';
  elsif v_total = 9 then
    v_xp_gain := 5; v_pct := 0;
    v_outcome := 'By talent (50%) or trickery (50%), you beat a rival crawler in a test of skill. (GM: an NPC ally or enemy.)';
  elsif v_total = 8 then
    v_xp_gain := 4; v_pct := 0; v_grants_luck := true;
    v_outcome := 'You survived a blindfolded knife-throwing demonstration unscathed. Gain a luck token.';
  elsif v_total = 7 then
    v_xp_gain := 4; v_pct := 0;
    v_outcome := 'You led an entire tavern in a wildly insulting song about a disliked noble. (GM: a famous bard ally.)';
  elsif v_total = 6 then
    v_xp_gain := 4; v_pct := 5;
    v_outcome := 'The Thieves'' Guild bilked you for 5% of your total wealth.';
  elsif v_total = 5 then
    v_xp_gain := 3; v_pct := 10;
    v_outcome := 'You''re fined 10% of your total wealth for starting a full-tavern brawl. (GM: barred from a tavern.)';
  elsif v_total = 4 then
    v_xp_gain := 3; v_pct := 10;
    v_outcome := 'You hazily remember donating 10% of your total wealth to a glib priest. (GM: a priest ally.)';
  elsif v_total = 3 then
    v_xp_gain := 3; v_pct := 15;
    v_outcome := 'You wake up in a gutter with 15% of your total wealth spent.';
  elsif v_total = 2 then
    v_xp_gain := 2; v_pct := 20;
    v_outcome := 'You''re locked in the stocks for 1d4 days and fined 20% of your total wealth for setting a building on fire.';
  else
    v_xp_gain := 2; v_pct := 0;
    v_outcome := 'You wake up blearily in your bed.';
  end if;

  v_coin_loss := round(v_coin_after_cost * v_pct / 100, 2);

  select coalesce((c.modes_of_play ? 'pulp'), false) into v_pulp
  from campaigns c where c.id = v_character.campaign_id;
  v_luck_cap := case when v_pulp then 999 else 1 end;

  update characters
  set coin = greatest(0, v_coin_after_cost - v_coin_loss),
      xp = xp + v_xp_gain,
      luck_tokens = case
        when v_grants_luck and luck_tokens < v_luck_cap then luck_tokens + 1
        else luck_tokens
      end
  where id = p_character_id
  returning * into v_character;

  insert into campaign_events (campaign_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (
    v_character.campaign_id, auth.uid(), 'character.caroused', 'character', p_character_id,
    jsonb_build_object(
      'cost_tier', p_cost_tier, 'cost_gp', v_cost, 'roll_total', v_total,
      'xp_gain', v_xp_gain, 'coin_loss', v_coin_loss, 'grants_luck', v_grants_luck,
      'outcome', v_outcome
    )
  );

  insert into scene_log (campaign_id, type, sender_user_id, sender_name, text)
  values (
    v_character.campaign_id, 'narration', auth.uid(), v_character.name,
    v_character.name || ' carouses (rolled ' || v_total || '): ' || v_outcome
      || ' +' || v_xp_gain || ' XP'
      || case when v_coin_loss > 0 then ', -' || v_coin_loss || ' gp' else '' end
      || case when v_grants_luck then ', +1 luck token' else '' end
  );

  return jsonb_build_object(
    'character_id', p_character_id,
    'roll_total', v_total,
    'outcome', v_outcome,
    'xp_gain', v_xp_gain,
    'coin', v_character.coin,
    'xp', v_character.xp,
    'luck_tokens', v_character.luck_tokens
  );
end;
$function$;

grant execute on function public.carouse_character(uuid, int) to authenticated;

comment on function public.carouse_character(uuid, int) is
  'Downtime carousing (rulebook p.92-93). p_cost_tier 0-6 selects the cost/event-bonus row (30gp/+0 .. 1800gp/+6). Rolls 1d8+bonus, resolves the exact outcome table (XP gain, wealth-percent loss applied to post-cost coin, luck-token grant on 2 of 14 rows respecting the 1-unless-pulp cap). Outcomes referencing mechanics this app does not model (NPC allies/enemies, tavern bans, debts, treasure-table items) are surfaced as narrative text, not faked as mechanical effects. Owner-or-GM auth, same predicate as advance_character_level/adjust_character_resource.';


-- ==== 20260803033303 add_treasure_quality_and_award_xp_rpc ====
alter table public.campaign_treasure
  add column quality text check (quality in ('poor','normal','fabulous','legendary')),
  add column xp_awarded boolean not null default false;

comment on column public.campaign_treasure.quality is
  'Rulebook p.117 XP-for-treasure-quality: poor=0, normal=1, fabulous=3, legendary=10 XP. Null means not yet classified -- award_treasure_xp() requires this be set before it can award XP.';
comment on column public.campaign_treasure.xp_awarded is
  'Set true by award_treasure_xp() once this entry''s XP has been distributed to the party, so the same treasure can''t be awarded twice.';

create or replace function public.award_treasure_xp(p_treasure_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_treasure campaign_treasure%rowtype;
  v_xp int;
  v_recipient_count int;
begin
  select * into v_treasure from campaign_treasure where id = p_treasure_id for update;
  if not found then
    raise exception 'Treasure entry not found.';
  end if;

  if not is_campaign_gm(v_treasure.campaign_id) then
    raise exception 'Only the GM can award treasure XP.';
  end if;

  if v_treasure.quality is null then
    raise exception 'Set a quality for this treasure before awarding XP.';
  end if;

  if v_treasure.xp_awarded then
    raise exception 'XP for this treasure has already been awarded.';
  end if;

  v_xp := case v_treasure.quality
    when 'poor' then 0
    when 'normal' then 1
    when 'fabulous' then 3
    when 'legendary' then 10
  end;

  update characters
  set xp = xp + v_xp
  where campaign_id = v_treasure.campaign_id and is_active = true;

  get diagnostics v_recipient_count = row_count;

  update campaign_treasure set xp_awarded = true where id = p_treasure_id;

  insert into campaign_events (campaign_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (
    v_treasure.campaign_id, auth.uid(), 'treasure.xp_awarded', 'treasure', p_treasure_id,
    jsonb_build_object(
      'item', v_treasure.item, 'quality', v_treasure.quality,
      'xp_each', v_xp, 'recipient_count', v_recipient_count
    )
  );

  insert into scene_log (campaign_id, type, sender_user_id, sender_name, text)
  values (
    v_treasure.campaign_id, 'narration', auth.uid(), 'GM',
    'Awarded ' || v_xp || ' XP each for ' || v_treasure.item || ' (' || v_treasure.quality || ') to '
      || v_recipient_count || ' character' || case when v_recipient_count = 1 then '' else 's' end
  );

  return jsonb_build_object(
    'treasure_id', p_treasure_id, 'quality', v_treasure.quality,
    'xp_each', v_xp, 'recipient_count', v_recipient_count
  );
end;
$function$;

grant execute on function public.award_treasure_xp(uuid) to authenticated;

comment on function public.award_treasure_xp(uuid) is
  'Downtime XP-for-treasure-quality (rulebook p.117: poor=0/normal=1/fabulous=3/legendary=10 XP). GM-only. Distributes the quality''s fixed XP value to every is_active character in the treasure''s campaign, then marks the entry xp_awarded so it cannot be double-awarded.';


-- ==== 20260803035419 add_end_session_review ====
alter table public.campaigns add column next_session_pickup text;
comment on column public.campaigns.next_session_pickup is
  'GM-set "where we left off" note from the most recent end_campaign_session() call. Overwritten each time a session ends; surfaced to all campaign members (not GM-only) since it is what the whole table needs to pick back up next time.';

create table public.campaign_session_snapshots (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_number int not null,
  recap text not null,
  next_session_pickup text,
  party_state jsonb not null,
  campaign_state jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

comment on table public.campaign_session_snapshots is
  'One row per finalized session (ROADMAP.md Milestone 3: End-Session Review). Written only by end_campaign_session() -- a point-in-time record of party and campaign state at that session boundary, kept for history. Deliberately read-only/historical in this pass: restoring a snapshot (reverting live state back to it) is real future work, not built here -- writing the snapshot is the safe, additive half of "current-state snapshot" from the ROADMAP completion bar; reverting live state is a materially riskier feature that deserves its own pass.';

alter table public.campaign_session_snapshots enable row level security;

create policy "campaign members can view session snapshots"
  on public.campaign_session_snapshots for select
  using (is_campaign_member(campaign_id));

create or replace function public.end_campaign_session(
  p_campaign_id uuid,
  p_recap text,
  p_next_session_pickup text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_campaign campaigns%rowtype;
  v_recap text := btrim(coalesce(p_recap, ''));
  v_pickup text := nullif(btrim(coalesce(p_next_session_pickup, '')), '');
  v_party jsonb;
  v_state jsonb;
  v_snapshot_id uuid;
  v_thread_count int;
  v_clock_count int;
begin
  if v_recap = '' then
    raise exception 'A session recap is required to end the session.';
  end if;

  select * into v_campaign from campaigns where id = p_campaign_id for update;
  if not found then
    raise exception 'Campaign not found.';
  end if;

  if not is_campaign_gm(p_campaign_id) then
    raise exception 'Only the GM can end the session.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'level', c.level, 'xp', c.xp,
    'hp', c.hp, 'max_hp', c.max_hp, 'coin', c.coin, 'luck_tokens', c.luck_tokens,
    'status', c.status
  )), '[]'::jsonb)
  into v_party
  from characters c
  where c.campaign_id = p_campaign_id and c.is_active = true;

  select count(*) into v_thread_count from campaign_threads where campaign_id = p_campaign_id and status = 'open';
  select count(*) into v_clock_count from campaign_clocks where campaign_id = p_campaign_id;

  v_state := jsonb_build_object(
    'danger_level', v_campaign.danger_level,
    'crawling_round', v_campaign.crawling_round,
    'open_thread_count', v_thread_count,
    'clock_count', v_clock_count,
    'modes_of_play', v_campaign.modes_of_play
  );

  insert into campaign_session_snapshots (
    campaign_id, session_number, recap, next_session_pickup, party_state, campaign_state, created_by
  ) values (
    p_campaign_id, v_campaign.session_number, v_recap, v_pickup, v_party, v_state, auth.uid()
  )
  returning id into v_snapshot_id;

  insert into campaign_timeline_entries (campaign_id, session_number, entry)
  values (p_campaign_id, v_campaign.session_number, v_recap);

  update campaigns
  set session_number = v_campaign.session_number + 1,
      session_active = false,
      next_session_pickup = v_pickup
  where id = p_campaign_id;

  insert into campaign_events (campaign_id, actor_user_id, event_type, entity_type, entity_id, payload)
  values (
    p_campaign_id, auth.uid(), 'campaign.session_ended', 'campaign_session_snapshot', v_snapshot_id,
    jsonb_build_object('session_number', v_campaign.session_number, 'party_count', jsonb_array_length(v_party))
  );

  insert into scene_log (campaign_id, type, sender_user_id, sender_name, text)
  values (
    p_campaign_id, 'narration', auth.uid(), 'GM',
    'Session ' || v_campaign.session_number || ' ended.' || case when v_pickup is not null then ' Next time: ' || v_pickup else '' end
  );

  return jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'ended_session_number', v_campaign.session_number,
    'new_session_number', v_campaign.session_number + 1,
    'next_session_pickup', v_pickup
  );
end;
$function$;

grant execute on function public.end_campaign_session(uuid, text, text) to authenticated;

comment on function public.end_campaign_session(uuid, text, text) is
  'End-Session Review (ROADMAP.md Milestone 3). GM-only. Requires a non-empty recap (the one real validation gate this pass builds -- no fabricated checklist items). Writes a campaign_session_snapshots row (party + campaign state at this boundary), a campaign_timeline_entries row (the recap, so it appears in the existing session log), advances campaigns.session_number, clears session_active, and stores next_session_pickup for the whole table to see next time. Snapshot restore (reverting live state) is explicitly not built here -- flagged as separate future work.';


-- ==== 20260803053259 add_campaign_events_to_realtime ====
alter publication supabase_realtime add table public.campaign_events;

-- ==== 20260803055137 add_campaign_journal_entries ====
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  entry_type text not null check (entry_type in ('quest', 'clue', 'note')),
  title text not null,
  body text not null default '',
  status text check (status in ('fact', 'suspicion')),
  revealed boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_journal_entries_campaign_id on public.journal_entries(campaign_id);

alter table public.journal_entries enable row level security;

-- Same shape as gm_notes' established "gm sees all, players see revealed
-- only" split -- this is the player-facing knowledge log, so a row only
-- becomes visible to non-GM members once the GM has actually revealed it.
create policy "gm sees all journal entries, players see revealed only"
  on public.journal_entries for select
  using (is_campaign_gm(campaign_id) or (is_campaign_member(campaign_id) and revealed = true));

create policy "only gm writes journal entries - insert"
  on public.journal_entries for insert
  with check (is_campaign_gm(campaign_id));

create policy "only gm writes journal entries - update"
  on public.journal_entries for update
  using (is_campaign_gm(campaign_id))
  with check (is_campaign_gm(campaign_id));

create policy "only gm writes journal entries - delete"
  on public.journal_entries for delete
  using (is_campaign_gm(campaign_id));

alter publication supabase_realtime add table public.journal_entries;

-- ==== 20260803121554 add_campaign_map_drawings ====
create table public.campaign_map_drawings (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  created_by uuid references auth.users(id),
  points jsonb not null,
  color text not null default '#f2f2f2',
  created_at timestamptz not null default now()
);

comment on table public.campaign_map_drawings is
  'Freehand GM annotations drawn over the campaign''s scene image (ZoneScene.jsx), one row per stroke. points is a jsonb array of {x,y} percentage coordinates (0-100) in the same coordinate system ZoneScene already uses for token positioning -- not tied to the old map_cols/map_rows/map_cells grid, which the zone-based (close/near/far) positioning model superseded and which this feature does not use. Strokes are immutable once drawn (no UPDATE policy) -- only added or deleted (undo-last / clear-all from the client). Client-side convention (GmDashboard.jsx uploadMap/removeMap): all rows for a campaign are deleted whenever that campaign''s map image is replaced or removed, so old annotations never appear misaligned over an unrelated new image -- not DB-enforced, same as-is-scope precedent as those two functions not cleaning up orphaned storage files.';

create index idx_campaign_map_drawings_campaign_id on public.campaign_map_drawings(campaign_id);

alter table public.campaign_map_drawings enable row level security;

create policy "members can read map drawings"
  on public.campaign_map_drawings for select
  using (is_campaign_member(campaign_id));

create policy "only gm writes map drawings - insert"
  on public.campaign_map_drawings for insert
  with check (is_campaign_gm(campaign_id));

create policy "only gm writes map drawings - delete"
  on public.campaign_map_drawings for delete
  using (is_campaign_gm(campaign_id));

alter publication supabase_realtime add table public.campaign_map_drawings;

-- ==== 20260803123213 fix_ai_gm_campaign_membership ====
-- Decision Queue #30: AI-run campaigns had no GM member. handle_new_campaign()
-- only granted the creator role='gm' when gm_type='human'; for gm_type='ai' the
-- creator was enrolled as role='player', so is_campaign_gm() always rejected
-- them -- meaning every GM-gated table (monsters, turn order, clocks, NPCs,
-- notes, map, campaign_map_drawings, journal_entries, etc.) was unwritable by
-- anyone in an AI-GM campaign, and set_campaign_privacy() always rejected them
-- too (the AI-GM+Private client-side stopgap added in commit 3b1701d exists
-- because of this).
--
-- Decision (of the three options the task list named -- service-role AI acts
-- as GM, creator gets a hybrid role, or a synthetic GM member): the creator
-- gets a hybrid role. Design-handoff-spec Section 4.17 (AI GM Supervision) and
-- 4.22 (AI-GM Table, "the AI is standing in for the same human-GM command
-- layer") both frame the human organizer of an AI-GM campaign as holding the
-- same administrative/oversight seat a human GM would -- the AI narrates, the
-- human still owns the table. So the creator now always gets role='gm',
-- exactly matching human-GM campaign structure; the AI itself acts through the
-- ai-gm-turn edge function's service-role key (bypasses RLS entirely, not
-- gated on this row), which is how #31 (the AI tool surface) will write when
-- it's built. A synthetic GM member (a dummy auth.users row) was rejected as
-- unnecessary complexity -- there's no session to authenticate it under
-- without also building a JWT-impersonation path, and it would need its own
-- display-name/avatar handling everywhere gm_user_id is read.
create or replace function public.handle_new_campaign()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.campaign_members (campaign_id, user_id, role)
  values (new.id, auth.uid(), 'gm')
  on conflict (campaign_id, user_id) do nothing;
  return new;
end;
$function$;

-- Backfill: promote the earliest-joined member of any campaign that
-- currently has zero role='gm' members to 'gm'. Written generically (not
-- gm_type='ai'-scoped) because the same live-data check that found the 3
-- broken AI-GM campaigns also turned up one gm_type='human' campaign
-- ("The sunken keep") in the identical broken state -- gm_user_id null, zero
-- gm-role members, likely predating this trigger/column entirely. Same
-- invariant violation, same fix, folded in rather than left as a second
-- undocumented landmine. "Earliest-joined member" is the creator in every
-- live case (verified by inspecting joined_at ordering before writing this).
with earliest_member as (
  select distinct on (m.campaign_id) m.campaign_id, m.user_id
  from campaign_members m
  where m.campaign_id in (
    select c.id from campaigns c
    where not exists (
      select 1 from campaign_members gm where gm.campaign_id = c.id and gm.role = 'gm'
    )
  )
  order by m.campaign_id, m.joined_at asc
)
update campaign_members m
set role = 'gm'
from earliest_member e
where m.campaign_id = e.campaign_id and m.user_id = e.user_id;

-- Mirror campaigns.gm_user_id for the same rows, restoring the "exactly one
-- role='gm' member, matching gm_user_id 1:1" invariant Profile.jsx's own
-- comment already assumed was universally true.
update campaigns c
set gm_user_id = m.user_id
from campaign_members m
where m.campaign_id = c.id and m.role = 'gm' and c.gm_user_id is null;

-- ==== 20260803130127 allow_service_role_through_gm_and_member_checks ====
-- Decision Queue #31, part 2: resolve_morale_check/resolve_stabilize_check/
-- resolve_dying_turn (the combat-resolution trio the AI GM tool surface
-- needs next) are SECURITY DEFINER functions that each do their own explicit
-- is_campaign_gm()/is_campaign_member() check -- correct for a real user's
-- JWT, but the ai-gm-turn edge function's `writer` client authenticates as
-- service_role (no user JWT, auth.uid() is null there), so those checks
-- would always reject it.
--
-- Fixed centrally rather than per-RPC: both predicate functions now also
-- return true when auth.role() = 'service_role'. This is safe and adds no
-- new capability -- service_role already bypasses RLS entirely on every
-- table these two functions gate (RLS simply isn't evaluated for a Postgres
-- role with BYPASSRLS, independent of what a policy expression would
-- return), so this change only affects the *explicit* function-body checks
-- SECURITY DEFINER functions add on top of RLS -- exactly the ones this AI
-- tool surface needs to pass, and every other current or future
-- is_campaign_gm()/is_campaign_member()-gated RPC gets this for free too,
-- instead of needing its own one-off patch.
create or replace function public.is_campaign_gm(target_campaign_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    auth.role() = 'service_role'
    or exists (
      select 1 from campaign_members
      where campaign_id = target_campaign_id and user_id = auth.uid() and role = 'gm'
    );
$function$;

create or replace function public.is_campaign_member(target_campaign_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    auth.role() = 'service_role'
    or exists (
      select 1 from campaign_members
      where campaign_id = target_campaign_id and user_id = auth.uid()
    );
$function$;