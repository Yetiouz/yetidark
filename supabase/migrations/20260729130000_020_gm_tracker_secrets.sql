-- Move GM-only tracker details out of member-readable entity rows.

create table campaign_npc_secrets (
  npc_id uuid primary key references campaign_npcs(id) on delete cascade,
  notes text,
  created_at timestamptz not null default now()
);

create table campaign_faction_secrets (
  faction_id uuid primary key references campaign_factions(id) on delete cascade,
  goal text,
  notes text,
  created_at timestamptz not null default now()
);

create table campaign_treasure_secrets (
  treasure_id uuid primary key references campaign_treasure(id) on delete cascade,
  notes text,
  created_at timestamptz not null default now()
);

insert into campaign_npc_secrets (npc_id, notes)
select id, notes
from campaign_npcs
where notes is not null and btrim(notes) <> '';

insert into campaign_faction_secrets (faction_id, goal, notes)
select id, goal, notes
from campaign_factions
where (goal is not null and btrim(goal) <> '')
   or (notes is not null and btrim(notes) <> '');

insert into campaign_treasure_secrets (treasure_id, notes)
select id, notes
from campaign_treasure
where notes is not null and btrim(notes) <> '';

alter table campaign_npcs drop column notes;
alter table campaign_factions drop column goal, drop column notes;
alter table campaign_treasure drop column notes;

alter table campaign_npc_secrets enable row level security;
alter table campaign_faction_secrets enable row level security;
alter table campaign_treasure_secrets enable row level security;

grant select, insert, update, delete on campaign_npc_secrets to authenticated;
grant select, insert, update, delete on campaign_faction_secrets to authenticated;
grant select, insert, update, delete on campaign_treasure_secrets to authenticated;
revoke all on campaign_npc_secrets, campaign_faction_secrets, campaign_treasure_secrets from anon;

create policy "gm manages npc secrets" on campaign_npc_secrets
  for all
  to authenticated
  using (
    exists (
      select 1
      from campaign_npcs n
      where n.id = campaign_npc_secrets.npc_id
        and is_campaign_gm(n.campaign_id)
    )
  )
  with check (
    exists (
      select 1
      from campaign_npcs n
      where n.id = campaign_npc_secrets.npc_id
        and is_campaign_gm(n.campaign_id)
    )
  );

create policy "gm manages faction secrets" on campaign_faction_secrets
  for all
  to authenticated
  using (
    exists (
      select 1
      from campaign_factions f
      where f.id = campaign_faction_secrets.faction_id
        and is_campaign_gm(f.campaign_id)
    )
  )
  with check (
    exists (
      select 1
      from campaign_factions f
      where f.id = campaign_faction_secrets.faction_id
        and is_campaign_gm(f.campaign_id)
    )
  );

create policy "gm manages treasure secrets" on campaign_treasure_secrets
  for all
  to authenticated
  using (
    exists (
      select 1
      from campaign_treasure t
      where t.id = campaign_treasure_secrets.treasure_id
        and is_campaign_gm(t.campaign_id)
    )
  )
  with check (
    exists (
      select 1
      from campaign_treasure t
      where t.id = campaign_treasure_secrets.treasure_id
        and is_campaign_gm(t.campaign_id)
    )
  );
