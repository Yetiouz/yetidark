create table character_features (
  id uuid primary key default gen_random_uuid(),
  character_id uuid references characters(id) on delete cascade,
  source text not null,
  name text not null,
  description text not null,
  uses_max int,
  uses_current int,
  created_at timestamptz not null default now()
);

alter table character_features enable row level security;

create policy "members can read a character's features" on character_features
  for select using (
    exists (
      select 1 from characters c
      where c.id = character_features.character_id
        and is_campaign_member(c.campaign_id)
    )
  );

create policy "owner or gm can write a character's features" on character_features
  for all using (
    exists (
      select 1 from characters c
      where c.id = character_features.character_id
        and (c.owner_user_id = auth.uid() or is_campaign_gm(c.campaign_id))
    )
  );

alter publication supabase_realtime add table character_features;
