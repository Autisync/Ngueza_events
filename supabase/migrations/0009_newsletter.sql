-- =====================================================================
-- 0008 — newsletter and waitlist (§37)
--
-- Not a marketing checkbox. The waitlist runs during the build, before
-- the platform exists, and turns weeks of building in silence into an
-- audience plus evidence of which categories and municipalities people
-- actually want — which directs supplier recruitment.
--
-- Marketing consent is a different legal basis from booking data, so it
-- is recorded as an audit trail rather than a boolean.
-- =====================================================================

create table newsletter_subscribers (
  id              uuid primary key default gen_random_uuid(),
  email           citext not null unique,
  profile_id      uuid references profiles(id) on delete set null,  -- null for waitlist

  audience        text not null default 'client'
                    check (audience in ('client', 'provider')),

  status          text not null default 'pending'
                    check (status in ('pending', 'confirmed', 'unsubscribed', 'bounced', 'complained')),

  -- {"categories": [uuid], "locations": [uuid]} — drives the "New in
  -- Talatona" digest and, before launch, tells recruitment where demand is.
  interests       jsonb not null default '{}',

  source          text check (source in
                    ('waitlist', 'footer', 'zero_result', 'signup', 'booking', 'import')),
  source_detail   text,                            -- e.g. the query that returned nothing

  locale          text not null default 'pt-AO',

  -- Double opt-in and one-click unsubscribe. Signed, single-purpose.
  confirm_token     text unique,
  unsubscribe_token text not null unique default encode(gen_random_bytes(24), 'hex'),

  confirmed_at    timestamptz,
  unsubscribed_at timestamptz,
  last_sent_at    timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Nothing is sent to an unconfirmed address.
  constraint newsletter_confirmed_shape check (
    (status = 'confirmed') = (confirmed_at is not null)
  )
);

create index newsletter_status_idx   on newsletter_subscribers (status);
create index newsletter_audience_idx on newsletter_subscribers (audience, status);
create index newsletter_source_idx   on newsletter_subscribers (source, created_at);
create index newsletter_interests_idx on newsletter_subscribers using gin (interests);

create trigger newsletter_subscribers_updated_at
  before update on newsletter_subscribers
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- The consent trail. A boolean proves nothing later; this records what
-- was shown, when, and from where — which is what §37 actually needs.
-- Append-only.
-- ---------------------------------------------------------------------
create table newsletter_consent_events (
  id            bigint generated always as identity primary key,
  subscriber_id uuid not null references newsletter_subscribers(id) on delete cascade,
  action        text not null check (action in
                  ('subscribed', 'confirmed', 'unsubscribed', 'resubscribed',
                   'bounced', 'complained')),
  consent_text  text,                              -- the exact wording presented
  source_url    text,
  ip            inet,
  user_agent    text,
  created_at    timestamptz not null default now()
);

create index newsletter_consent_subscriber_idx
  on newsletter_consent_events (subscriber_id, created_at);

create trigger newsletter_consent_append_only
  before update or delete on newsletter_consent_events
  for each row execute function reject_mutation();

-- ---------------------------------------------------------------------
-- The sendable audience. Marketing mail joins against this view and
-- never against the table, so an unconfirmed or unsubscribed address
-- cannot be reached by accident.
--
-- Transactional booking mail does NOT consult this at all — it travels
-- on a separate sending identity with its own suppression list. A
-- marketing unsubscribe must never stop a booking confirmation.
-- ---------------------------------------------------------------------
create view newsletter_sendable as
  select id, email, audience, interests, locale, last_sent_at
    from newsletter_subscribers
   where status = 'confirmed';

comment on view newsletter_sendable is
  'Marketing sends read from here only. Transactional mail is separate.';
