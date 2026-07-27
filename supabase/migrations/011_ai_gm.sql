-- Delve — AI GM turns (chunk 9 of the GM-brain integration).
--
-- Adds a distinct scene_log entry type for AI-generated narration, so the
-- UI can style it differently from a human GM's 'gm' lines and players
-- know exactly which messages came from the AI. The actual generation
-- happens in the ai-gm-turn Edge Function, not here -- this migration is
-- just the schema change that lets it write its output into the existing
-- shared log everyone already reads.

alter table scene_log drop constraint scene_log_type_check;
alter table scene_log add constraint scene_log_type_check
  check (type in ('narration', 'chat', 'gm', 'roll', 'ai_gm'));
