-- GM notes as a contextual, entity-linked inspector instead of a flat list --
-- one of the design decisions confirmed in the July 31 mockup review
-- (docs/ROADMAP.md, "Design decisions confirmed"): "GM notes move off a
-- flat notes panel entirely. Persistent notes attach to whatever's
-- selected on the map (a monster, a trap, a feature) as a contextual
-- inspector."
--
-- Purely additive: two nullable columns, no RLS change. Existing rows (and
-- existing app code, until GmDashboard.jsx is updated) keep working exactly
-- as before -- a note with entity_type/entity_id null is a general note,
-- same as every gm_notes row today. Visibility rules are untouched: GM
-- always sees everything, players only see revealed = true, regardless of
-- whether a note is tagged to an entity.
--
-- 'trap'/'feature' aren't real entities yet (no table for them -- that's
-- the Milestone 4 map-editor work), so the check constraint only allows
-- 'character' and 'monster' for now. Widen it once those exist rather than
-- adding untyped free-form tagging today.
alter table gm_notes
  add column entity_type text,
  add column entity_id uuid;

alter table gm_notes
  add constraint gm_notes_entity_type_check
  check (entity_type is null or entity_type in ('character', 'monster'));

alter table gm_notes
  add constraint gm_notes_entity_pairing_check
  check ((entity_type is null) = (entity_id is null));

create index gm_notes_entity_idx on gm_notes (campaign_id, entity_type, entity_id)
  where entity_type is not null;
