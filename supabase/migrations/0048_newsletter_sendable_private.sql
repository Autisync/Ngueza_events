-- =====================================================================
-- 0048 — the marketing list is not readable by visitors
--
-- `newsletter_sendable` (0009) is a plain view, so it runs with its
-- owner's rights and skips the RLS on `newsletter_subscribers`. 0012 then
-- granted SELECT on "all tables" to anon and authenticated, which
-- included this view. Anyone holding the public anon key could read the
-- email, audience and interests of every confirmed subscriber through
-- PostgREST, while the table itself returned nothing to them.
--
-- The same mistake on `provider_health` was closed in 0024 and 0031.
--
-- Both steps, so either one alone still holds:
--   * security_invoker: the view applies the caller's RLS, and
--     newsletter_subscribers has no SELECT policy for anon or for
--     non-admin users;
--   * revoke: visitors and signed-in users cannot read it at all. The
--     only reader is the sender, which runs as the service role.
--
-- tests/sql/10_catalog_rules.sql now refuses any view that anon or
-- authenticated can read unless it is security_invoker or named there as
-- public on purpose.
-- =====================================================================

alter view newsletter_sendable set (security_invoker = true);
revoke all on newsletter_sendable from anon, authenticated;
