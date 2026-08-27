-- =====================================================================
-- 0013 — consent records must survive rewriting, but not erasure
--
-- 0009 made newsletter_consent_events reject both UPDATE and DELETE,
-- reusing the same guard as booking_events. That was too strong, and it
-- surfaced as a cascade from newsletter_subscribers being refused.
--
-- The two trails protect different things:
--
--   booking_events        — evidence for disputes and money. Immutable
--                           against everyone, which also makes bookings
--                           undeletable. Intended (§38).
--
--   newsletter_consent_events — proof that consent was given, for as long
--                           as the data is held. §37 requires a real
--                           erasure path; when the person is erased, the
--                           proof of their consent goes with them. Keeping
--                           it would be holding personal data about
--                           someone who asked to be forgotten.
--
-- So: consent records can never be rewritten, and can only disappear by
-- cascade when the subscriber is erased — an operation available to the
-- service role alone, never through a browser session.
-- =====================================================================

create or replace function reject_update()
returns trigger language plpgsql as $$
begin
  raise exception '% cannot be modified', tg_table_name using errcode = 'check_violation';
end $$;

drop trigger if exists newsletter_consent_append_only on newsletter_consent_events;

create trigger newsletter_consent_no_rewrite
  before update on newsletter_consent_events
  for each row execute function reject_update();

-- Deletion is possible only for the service role, and only as a cascade
-- from erasing the subscriber.
revoke delete on newsletter_consent_events from anon, authenticated;
revoke delete on newsletter_subscribers   from anon, authenticated;
