-- =====================================================================
-- 0040 — internal notes for the support console (slice 38, review R040)
--
-- Support across a team needs memory: "called the client on Tuesday,
-- supplier says the transfer never arrived". Notes hang on a booking, a
-- supplier or a person, are written and read by administrators only, and
-- are append-only — a note is a record of what someone knew at the time.
-- =====================================================================

create table admin_notes (
  id           uuid primary key default gen_random_uuid(),
  target_type  text not null check (target_type in ('booking', 'provider', 'profile')),
  target_id    uuid not null,
  author_id    uuid references profiles(id) on delete set null,
  body         text not null check (char_length(body) between 1 and 4000),
  created_at   timestamptz not null default now()
);

create index admin_notes_target_idx on admin_notes (target_type, target_id, created_at desc);

alter table admin_notes enable row level security;
create policy admin_notes_admin_read on admin_notes for select using (is_admin());
create policy admin_notes_admin_insert on admin_notes
  for insert with check (is_admin() and author_id = auth.uid());
-- No update or delete policy, for anyone: notes are append-only.
revoke update, delete on admin_notes from anon, authenticated;
