-- Delve — Rules library (chunk 7 of the GM-brain integration).
--
-- Mirrors the file-based GM system's _RULES/ folder: reference material
-- (core rulebook, supplements, adventures) as distinct from
-- _CAMPAIGNS/HOUSE_RULES.md (the table's own homebrew, already covered by
-- CampaignSettings.jsx's House Rules box). A document is owned by the GM
-- who added it and shared with everyone across *that GM's* campaigns for
-- the matching system -- not with every Delve user, since some of these
-- are paid products the GM doesn't have the right to redistribute widely.
--
-- Each document is either an uploaded file (private "rules" storage
-- bucket, signed URLs only) or an external link -- the app supports both
-- so a GM can upload freely-shareable material (Quickstart Set) while
-- linking out to commercial material (core rulebook, Cursed Scrolls)
-- instead of hosting a copy.

create table rules_documents (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references profiles(id) on delete cascade,
  system text not null default 'Shadowdark',
  title text not null,
  description text,
  kind text not null check (kind in ('file', 'link')),
  file_path text,
  external_url text,
  created_at timestamptz not null default now(),
  constraint rules_documents_kind_payload check (
    (kind = 'file' and file_path is not null and external_url is null)
    or (kind = 'link' and external_url is not null and file_path is null)
  )
);

alter table rules_documents enable row level security;

-- True for the owning GM, or anyone who's a member of one of that GM's
-- campaigns running the same system. Security definer so it can read
-- campaign_members/campaigns regardless of the caller's own RLS access.
create or replace function can_read_rules_documents(target_owner uuid, target_system text)
returns boolean
language sql
security definer
stable
as $$
  select target_owner = auth.uid() or exists (
    select 1 from campaign_members cm
    join campaigns c on c.id = cm.campaign_id
    where cm.user_id = auth.uid()
      and c.gm_user_id = target_owner
      and c.system = target_system
  );
$$;

create policy "gm and their players can read rules documents" on rules_documents
  for select using (can_read_rules_documents(owner_user_id, system));

create policy "owner manages their rules documents" on rules_documents
  for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Storage: private bucket -- unlike "maps" (public, non-sensitive images),
-- rules documents can include paid PDFs, so reads go through signed URLs
-- gated by the same can_read_rules_documents() check, not a guessable
-- public URL. Files live at "<owner_user_id>/<uuid>-<filename>".
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('rules', 'rules', false)
on conflict (id) do nothing;

create policy "gm uploads their own rules files" on storage.objects
  for insert with check (
    bucket_id = 'rules' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "gm deletes their own rules files" on storage.objects
  for delete using (
    bucket_id = 'rules' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "members can read rules files they're entitled to" on storage.objects
  for select using (
    bucket_id = 'rules' and exists (
      select 1 from rules_documents rd
      where rd.file_path = storage.objects.name
        and can_read_rules_documents(rd.owner_user_id, rd.system)
    )
  );
