-- Keep campaign maps behind Storage authorization. Campaign rows store the
-- object path; clients mint short-lived URLs only after RLS confirms that
-- the caller belongs to the matching campaign.

alter table campaigns
  add column map_path text;

-- Preserve maps uploaded by earlier releases. Prefer the authoritative
-- object name when it can be matched, then fall back to the legacy public
-- URL suffix for any row whose object is not present in storage metadata.
update campaigns c
set map_path = o.name
from storage.objects o
where o.bucket_id = 'maps'
  and c.map_url is not null
  and (
    c.map_url like '%/storage/v1/object/public/maps/' || o.name
    or c.map_url like '%/storage/v1/object/public/maps/' || replace(o.name, ' ', '%20')
  );

update campaigns
set map_path = substring(map_url from '/storage/v1/object/public/maps/(.+)$')
where map_path is null
  and map_url is not null
  and map_url ~ '/storage/v1/object/public/maps/.+$';

update storage.buckets
set public = false
where id = 'maps';

drop policy if exists "anyone can view map images" on storage.objects;
create policy "campaign members can view map images" on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'maps'
    and public.is_campaign_member(
      case
        when (storage.foldername(name))[1] ~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then ((storage.foldername(name))[1])::uuid
        else null
      end
    )
  );
