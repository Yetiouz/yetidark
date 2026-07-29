-- Reconcile database objects that exist in production but were created
-- outside the checked-in migration history.

create or replace function join_public_campaign(p_campaign_id uuid)
returns table (id uuid, name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign campaigns%rowtype;
begin
  select * into v_campaign
  from campaigns
  where campaigns.id = p_campaign_id;

  if not found then
    raise exception 'Campaign not found.';
  end if;

  if not v_campaign.is_public then
    raise exception 'This campaign is not public.';
  end if;

  if auth.uid() is null then
    raise exception 'You must be signed in to join a campaign.';
  end if;

  insert into campaign_members (campaign_id, user_id, role)
  values (v_campaign.id, auth.uid(), 'player')
  on conflict (campaign_id, user_id) do nothing;

  return query select v_campaign.id, v_campaign.name;
end;
$$;

revoke all on function join_public_campaign(uuid) from public;
grant execute on function join_public_campaign(uuid) to authenticated;

-- These base tables are members of the live realtime publication, but
-- schema.sql only documented that fact in a comment. Add them
-- idempotently so this migration is safe on both a fresh database and the
-- already-configured production project.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'map_cells',
    'campaigns',
    'scene_log',
    'encounter_monsters',
    'gm_notes',
    'turn_order',
    'votes',
    'characters'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        table_name
      );
    end if;
  end loop;
end;
$$;
