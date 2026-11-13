# Slice 50 — dashboards that read like dashboards, and an event planner

**Status:** in progress.
**Asked by NGUEZA:** "for all dashboards, make it look more like this
dashboard, for normal logged users, supplier and admin. Allow users to plan
their events in the system as well, with costs and needs for type of event."
The references were three event-management dashboards: a left sidebar, a
top bar with the account, and a grid of white cards: headline numbers, a
progress ring, upcoming events with a progress bar and "days left", a task
list and alerts.

NGUEZA's own rules still hold:
- **Colour:** blue and white. The references' orange, purple and pink become
  steps of the blue ramp. Semantic colour (good / warning / danger) only
  marks state, always with a word beside it.
- **No new client JavaScript.** Charts are server-rendered SVG with a text
  equivalent. The phone menu is a scrollable strip of links.
- **Mobile first.** Every card stacks to one column at 390 px.

## Part 1 — the event planner (0046 + reference seed)

**Event types are rows, not code** (CLAUDE.md: the same rule as categories,
so a cleaning or tutoring marketplace can plan different things).
- **`event_types`:** Casamento, Alambamento, Aniversário, Festa infantil,
  Baptizado, Conferência ou seminário, Festa de empresa, Outro evento.
- **`event_type_needs`:** what each type usually needs. Each row has:
  - a name;
  - an optional marketplace category (Local → salões, Buffet → buffet…);
  - a typical **share of the budget** in basis points (integers, so the
    suggested estimates are integer arithmetic on cêntimos);
  - **how many weeks before** the date it should be booked.

  A wedding's local is booked 26 weeks ahead and takes about 30 %. A
  contingency line (Imprevistos) ends every list.
- Administrators manage both lists at `/admin/tipos-de-evento`: add, rename,
  reorder, change the share and lead time, retire.
- The starting lists live in `seed/reference/01_event_types.sql`. They come
  after the taxonomy, so the category links resolve on a fresh database too.

**A plan belongs to the person who made it.**
- **`event_plans`** has a type, title, optional date, guests, municipality,
  budget (bigint cêntimos) and notes. It can be archived; nothing is ever
  deleted.
- **`event_plan_items`** is one line per need: status (por tratar / em
  contacto / tratado), estimate, actual cost, "reservar até" date, an
  optional link to one of the owner's own bookings, and notes.
- **Creating a plan copies its type's needs.** Each estimate is the budget
  × its share. Each "reservar até" date is the event date minus its lead
  time. The client then edits, adds and removes lines freely.
- **RLS:** a plan and its lines are visible to their owner only. Not to
  administrators: nothing in running the platform needs a client's budget.
  Visitors cannot touch either table.
- **Guards:**
  - a line can link only to a booking whose client is the plan's owner
    (23514);
  - a line cannot move to another plan;
  - an owner holds at most 30 active plans, and a plan at most 60 lines.

**Pages** (all signed in, under the client dashboard):
- `/conta/eventos`: the plans as cards. Each shows the type, date, a
  "faltam N dias" chip, a preparation bar (lines treated / total) and the
  budget used.
- `/conta/eventos/novo`: the form. Choosing the type is enough; everything
  else is optional and editable later.
- `/conta/eventos/[id]`: the plan itself.
  - Headline numbers: budget, estimated, spent, still to arrange.
  - A preparation ring, and a budget meter that turns to a warning, with
    the words "acima do orçamento", when spending passes the budget.
  - A list of needs by "reservar até": each with its status, estimate,
    actual, a meter of actual against estimate, and its linked booking.
  - **"Procurar fornecedores"** leads to `/procurar` filtered by the
    need's category, the plan's municipality and its date.
  - **"Preços no NGUEZA: desde X"** comes from published, verified, real
    (not example) suppliers' public prices in that category. A per-person
    price is multiplied by the guests.
  - Edit details, add a need, archive.

## Part 2 — one dashboard shell for three roles

**`DashShell`** is a server component used by every signed-in area.
- **Desktop:** a fixed left sidebar with the wordmark, a primary action
  (Planear evento / A sua página / Consola) and grouped links with icons
  and counts. The current link is marked with a blue bar.
- **Phone:** the same links become a scrollable strip under a slim top bar.
- **The top bar** has a search box (to `/procurar`), the notification bell
  with the unread count, and the account (initial, name, role).
- The public header and footer step aside on `/conta`, `/reservas` and
  `/painel`, as they already did on `/admin`.
- Pages inside keep their content. Their dark-blue header band becomes a
  plain title on the dashboard's light-blue ground, through a global
  `.ngz-dash` scope, because `painel.module.css` also styles two public
  pages.

**Dashboard parts** (`app/dash/`): page head, card, stat tile (icon, value,
note, state), meter, progress ring, column chart. Each chart:
- has an accessible name and a visually hidden table;
- gives a native SVG `<title>` for every mark;
- follows the dataviz mark specs: bars ≤ 24 px with 4 px rounded data
  ends, hairline grid, text in text colours, never in the series colour.

**Client (`/conta`), now an overview:**
- **Tiles:** next event and days left, active bookings, budget used on the
  next event, unread notifications.
- **Upcoming events:** the plan cards.
- **Por tratar:** the next needs by "reservar até", across plans; overdue
  ones say so.
- **Alertas:**
  - bookings to pay;
  - offers waiting on a quote request;
  - requests the supplier has not answered;
  - unread notifications.
- **Next bookings,** with date tiles.

Account details and sign-out move to `/conta/perfil`. The password-update
redirect follows them there.

**Supplier (`/painel/[id]`):**
- **Tiles:**
  - requests to answer;
  - confirmed upcoming;
  - value booked this year (sum of `total_minor`, confirmed and
    completed);
  - average rating.
- **Charts:** bookings per month, six months back and six ahead (columns),
  and this year's bookings by status (ranked bars).
- **Lists:** the next bookings, and alerts (documents missing, no photos,
  reviews without a reply, quote requests waiting).
- The existing management sections stay below, unchanged.

**Admin (`/admin`):**
- **The sidebar** becomes the light dashboard sidebar with icons.
- **Tiles:** the five queues (suppliers in review, documents, payments,
  support, reports).
- **Charts:** new bookings per week (eight weeks) and suppliers by
  verification state.
- The emergency switches, scheduled jobs and the audit trail stay as cards.

## Not in this slice

- Guest lists, seating, RSVPs and invitations. The plan has the guest
  count; managing the guests themselves is a product of its own.
- Payments through the planner. NGUEZA never moves money, so "actual cost"
  is what the client says they paid.
- Sharing a plan with a partner or planner.

## Acceptance

- [ ] `event_types` / `event_type_needs` are rows; an admin can add a type, add a need with a category, share and lead time, and retire either.
- [ ] Creating a plan with a budget copies its type's needs, with estimates = budget × share (integer cêntimos) and "reservar até" = date − lead time.
- [ ] A plan and its lines are invisible to every other user, to visitors and to administrators (RLS, asserted per role in `tests/sql`).
- [ ] A line cannot link to someone else's booking (23514); the caps hold.
- [ ] The plan page shows budget / estimated / spent / to arrange, the preparation ring, per-need meters, and "acima do orçamento" when over.
- [ ] Every need with a category links to a filtered search, and shows a market "desde" price from real suppliers only.
- [ ] `/conta`, `/reservas`, `/painel/[id]` and `/admin` share the sidebar shell; the public header is gone there and only there.
- [ ] Client, supplier and admin overviews show their tiles, charts and lists from live data.
- [ ] Every chart has an accessible name and a hidden data table; no client JavaScript added.
- [ ] Gates pass; the JS budget is unchanged.
