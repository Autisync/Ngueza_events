-- =====================================================================
-- 0028 — a provider matches through any service's category, not only
-- its own (slice 22: multi-category discoverability)
--
-- services.category_id has always been settable independently per
-- service (see the add-service form, lib/onboarding.ts) — a business
-- registered as 'djs' could already list a 'fotografia' service. Search
-- (lib/search.ts) and quote-request matching (0027) both only ever
-- checked providers.category_id, so that second service was invisible
-- to anyone searching or requesting quotes for photography. This
-- migration widens both to match through EITHER the provider's own
-- category or any active service's — no schema change, since the data
-- to match on already existed.
-- =====================================================================

create or replace function quote_request_open_and_matches(p_quote_request_id uuid, p_provider_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from quote_requests qr, providers p
     where qr.id = p_quote_request_id
       and p.id = p_provider_id
       and qr.status = 'open'
       and p.is_published and p.verification_status = 'verified'
       and p.location_id in (select id from location_descendants(qr.location_id))
       and (
         p.category_id in (select id from category_descendants(qr.category_id))
         or exists (
           select 1 from services sv
            where sv.provider_id = p.id and sv.is_active
              and sv.category_id in (select id from category_descendants(qr.category_id))
         )
       )
  );
$$;

drop policy quote_requests_matching_supplier_read on quote_requests;

create policy quote_requests_matching_supplier_read on quote_requests
  for select using (
    has_offered_on_quote_request(id)
    or (
      status = 'open'
      and exists (
        select 1 from providers p
         where p.owner_id = auth.uid()
           and p.is_published and p.verification_status = 'verified'
           and p.location_id in (select id from location_descendants(quote_requests.location_id))
           and (
             p.category_id in (select id from category_descendants(quote_requests.category_id))
             or exists (
               select 1 from services sv
                where sv.provider_id = p.id and sv.is_active
                  and sv.category_id in (select id from category_descendants(quote_requests.category_id))
             )
           )
      )
    )
  );

create or replace function enqueue_quote_request_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notification_outbox
    (kind, to_email, recipient_id, context, source_table, source_id)
  select
    'quote_request_new',
    pr.email,
    p.owner_id,
    jsonb_build_object(
      'quote_request_id', new.id,
      'category_name', (select name from categories where id = new.category_id),
      'location_name', (select name from locations where id = new.location_id),
      'event_date', new.event_date,
      'capacity', new.capacity,
      'description', left(new.description, 280)
    ),
    'quote_requests', new.id::text
  from providers p
  join profiles pr on pr.id = p.owner_id
  where p.is_published and p.verification_status = 'verified'
    and p.location_id in (select id from location_descendants(new.location_id))
    and (
      p.category_id in (select id from category_descendants(new.category_id))
      or exists (
        select 1 from services sv
         where sv.provider_id = p.id and sv.is_active
           and sv.category_id in (select id from category_descendants(new.category_id))
      )
    )
  order by p.created_at
  limit 50
  on conflict (source_table, source_id, kind, recipient_id) do nothing;
  return null;
end $$;
