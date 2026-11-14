# NGUEZA pivot inventory: from an event marketplace to a general services and products marketplace

**Scope.** This is a read-only map; no files were changed. It merges eight subsystem reader maps and the completeness critic's additions into one list. Each item appears once, under the theme it belongs to. Before writing it I re-checked the load-bearing identifiers in the repo:
- `providers.supplier_type` check `('venue','service')` is at `0004_providers.sql:22`.
- `categories.default_supplier_type` is at `0003_taxonomy.sql:19-20`.
- `locations.level` CHECK is at `0003:44-45`.
- `document_kinds.required_for` is at `0044:22-23`.
- `services.price_unit` CHECK is at `0004:134-135`.
- The `case cat.default_supplier_type when 'venue'…else 'service'` line is `lib/onboarding.ts:143`.
- `SLOT_TAKEN='23P01'` is in `lib/db.ts:76`.
- The money regex and OFFSET greps are in `.github/workflows/ci.yml:186-202`.
- The ESLint rule bans only `new Number()` and `parseFloat` (`eslint.config.mjs:15`).
- `lib/console.ts:94` formats money with `amount_minor / 100`.
- The predicate `parent_id is not null` is copied in five places: `app/page.tsx:33`, `app/procurar/page.tsx:57`, `app/lista-de-espera/page.tsx:33`, `lib/painel.ts:130` and `lib/event-plans.ts:568`.
- The `gates` script in `package.json` runs typecheck, lint, test:unit, test:integration and db:test. There is no `test:concurrency` or `test:e2e` npm script; concurrency runs inside `db:test`.
- `app/termos/page.tsx` is a 29-line placeholder.

**Rules that stay.**
- Categories and locations are rows, never enums.
- NGUEZA never holds or moves money. Clients pay providers directly, and NGUEZA only records each party's statements.
- Legal text is written by humans.
- Money is `bigint` cêntimos.
- Migrations are append-only.
- Every new table ships with RLS and per-role tests.

**Corrections to the reader maps** (from the critic, re-checked):
- `app/termos/page.tsx` contains no "sinal / pedir pagamento" text. That wording lives in `app/ajuda/page.tsx`, `lib/booking-labels.ts` and the booking pages.
- Copy changes are **not** test-free. `tests/unit/notify.test.ts` and `tests/unit/booking-labels.test.ts` assert pt-AO strings and `/reservas/...` paths verbatim, and `tests/integration/onboarding.test.ts` asserts `'Espaço principal'`.
- The review sub-score columns (`rating_punctuality`/`cleanliness`/…) are dormant: no form emits them, and the only input is `ratingOverall`. The real limit is that reviews target `provider_id` only and require a booking.
- One *owner* can already register several providers. Today the "one mode per business" limit applies per provider row, not per person.
- The RLS hole is wider than one reader said. Both `providers_owner_insert` and `providers_owner_update` (0011) leave `supplier_type`, `concurrency_limit`, `category_id` and `is_demo` freely writable, because 0012 grants UPDATE on all columns. Only `verification_status` has a guard trigger.

---

## 0. Guarantees that must keep holding through every slice

| Guarantee | Where it lives | What protects it |
|---|---|---|
| A venue slot cannot be double-booked | `bookings_no_double_booking` (0006:103), its predicate `blocks_calendar and resource_id not null` | `tests/sql/01_constraint.sql`, venue race in `tests/concurrency.sh`, `scripts/verify-remote.sh`, `docs/backup-restore.md` |
| A service never exceeds its concurrency limit | `bookings_enforce_concurrency` (0006:161, redefined 0031:72), advisory lock on provider_id | service race in `tests/concurrency.sh` (exactly 2 of 50 win) |
| One clash path with one error contract | 23P01 mapped in `lib/db.ts` `isSlotTaken`, `lib/booking.ts` requestBooking | `tests/integration/booking.test.ts` |
| Availability is visible to anon only through definer functions | `resource_is_free` (0014) | `tests/sql/06_function_grants.sql` allowlist |
| Booking integrity | `bookings_guard_actor` (0021/0033), `bookings_guard_columns` (0035), `bookings_guard_completion`, `bookings_client_insert` (`starts_at > now()`, 0031), `bookings_guard_unavailable`, `bookings_guard_paused` (0039), `bookings_guard_demo` (0041), append-only `booking_events` | `tests/sql/05_integrity.sql`, `booking.test.ts` |
| Reviews cannot be self-written or fake-verified | `reviews_derive_verified` (0031), `reviews_guard_reply`/`reviews_guard_author` (0022/0031; these list every column) | `reviews.test.ts` |
| Money stays a statement, never a transfer | `refund_attestations` (0045, append-only), `payments_client_submit` (0025), admin-only `payments_admin_write` | `payments.test.ts`, `refunds.test.ts` |
| Old bookings keep their frozen terms | `policy_snapshot` (0035) read by `compute_refund_pct` (0026) | `cancellation-policy.test.ts` |
| Notifications are not sent twice | outbox `ON CONFLICT (source_table, source_id, kind, recipient_id)` (0027) | `notifications.test.ts` |
| Plans are private | `event_plans_owner_*` with no admin clause (0046) | `tests/sql/08_event_planner.sql` |

**Recommended strategy.** Make every change additive: add columns, tables and compat views, and backfill before any trigger stops reading `providers.supplier_type`. Never rename `bookings`, `resources` or `event_plans` in place. Keep the existing tests green **unchanged**, and add sibling tests next to them.

---

## 1. Data model

### 1.1 Move the fulfilment model from the provider to the offering — **L**

**Findings**
- `providers.supplier_type` (0004:22) is the single switch. Readers:
  - `bookings_00_set_shape` (0031:66), which derives `blocks_calendar` and whether `resource_id` is required or forbidden;
  - `bookings_enforce_concurrency`;
  - the anon column grant (0031 ~line 388);
  - `lib/onboarding.ts:143`, `lib/provider.ts` (the `PublicProvider.supplierType` and `PlanningContext` unions), `lib/search.ts`, `lib/painel.ts` (the `OwnedProvider.supplierType` union), `lib/documents.ts`, `lib/admin.ts` (the `QueueItem.supplierType` union), `lib/document-checklist.ts`;
  - every SQL fixture (`tests/sql/01,02,04,05,07`, `tests/concurrency.sh`) and the seeds.
- 0028 already lets `services.category_id` differ from the provider's category. A venue-registered business listing a "djs" service therefore gets resource-required, date-exclusive bookings for it. The behaviour is wrong today, not only in future.
- `lib/onboarding.ts:143` maps every non-venue category (including any future 'product' one) to `'service'`.
- `updateProvider()` lets an owner recategorise across modes. `supplier_type` stays frozen, and the database does not guard it.

**Proposal**
- Add `services.fulfilment_model text not null check (fulfilment_model in ('exclusive_slot','capacity_slot','on_request'))`. Products get their own table (§1.5), so 'product' never enters `bookings`.
  - This closed set is a booking mechanic that selects code paths. It is not taxonomy, so a CHECK is acceptable.
  - Categories carry only a *default* (§2.1).
- Backfill: venue → `exclusive_slot`, service → `capacity_slot`.
- Then redefine `bookings_00_set_shape` to read the offering, with the provider's `supplier_type` as fallback while `service_id` is null on legacy rows.
- Keep `providers.supplier_type` for at least one release as a compat column, derived by trigger.
- Add a BEFORE INSERT/UPDATE guard on `providers` that derives behaviour columns from category and offering rows. REVOKE UPDATE on `supplier_type`, `concurrency_limit` and `is_demo` from `authenticated`.

**Risks**
- If `blocks_calendar` flips to false on live venue holds before the backfill, double bookings become possible without any error. This is the riskiest step in the whole pivot.
- Live rows may already be inconsistent (an owner wrote `supplier_type` directly, or a service's category implies the other mode). Run an audit query before adding the guard.

### 1.2 Generic bookable units: `resources` — **M**

**Findings**
- `resources` (0004:96) are event spaces whose `capacity` means guests.
- `bookings_set_shape` forbids `resource_id` for services.
- These all key on `resource_id`: the exclusion constraint, `resource_is_free`, `bookings_release_competitors` and `bookings_guard_held_date` (0033), and `resource_amenities` (0043).

**Proposal**
- Add columns; do not rename anything:
  - `resources.unit_label` (or `unit_kind_id` pointing at rows): sala, viatura, técnico, equipamento;
  - `capacity_label`;
  - optional `service_id`.
- Allow `resource_id` on any `exclusive_slot` booking (vehicle, crew, room).
- Extend competitor release to any exclusive resource.

### 1.3 Capacity per offering — **M**

**Findings**
- `providers.concurrency_limit` (0004:26) is one number per business, used under a provider-level advisory lock.
- It cannot express a cleaning firm with 6 crews or a driving school with 3 cars.
- No form anywhere edits it.

**Proposal**
- Add `services.concurrency_limit` (nullable, falling back to the provider's), counted per `service_id` or per resource pool.
- Optionally add `buffer_minutes` (travel time) as a padded `tstzrange`.
- Keep the advisory-lock pattern and the 23P01 contract.
- Distinguish refusal reasons by constraint name or HINT, so the user sees "slot taken", "capacity full" or "out of stock" correctly. Today `lib/db.ts` `isSlotTaken` makes every refusal render as "Essa data já não está disponível".

### 1.4 Bookings for services — **L**

**Findings**
- `bookings` (0006):
  - `starts_at`/`ends_at` NOT NULL plus `bookings_time_order`;
  - `party_size` means guests;
  - `service_id` is nullable, and the public form never sends it (`app/fornecedor/[slug]/page.tsx`, `app/booking-actions.ts` requestForm);
  - the only location is the supplier's address;
  - hold windows are fixed in `booking_hold_window` (0006:226, 48h/48h/24h).
- Auto-completion is `ends_at + 24h` (`complete_past_bookings`, 0031:207).
- There is no link from an accepted quote: `?oferta` is displayed only.

**Proposal**
- Keep `bookings` for time-bound services. Do **not** make `starts_at` nullable.
- On-request jobs get an agreed slot later (§4C).
- Add:
  - `quantity` (keep `party_size` as is; it is frozen by `bookings_guard_columns`);
  - `quote_offer_id`;
  - `service_location_id` plus a link to an **erasable** `booking_addresses` table (address text, lat/lng, access notes), revealed to the supplier only after acceptance using the 0034 `booking_client_contact()` pattern.
- Require `service_id` on new public requests.
- Make hold windows depend on the fulfilment model, either through a function argument or rows.

**Risks**
- `bookings_guard_columns` must add the new frozen columns.
- `booking_events` is append-only, which makes bookings undeletable. PII must therefore stay out of the booking row (0013 erasure rule; critic).

### 1.5 Products: new tables (nothing exists in 0001–0046) — **L**

| Table | Key columns | Notes |
|---|---|---|
| `products` | provider_id, category_id, name, slug, description, condition (`novo`/`usado`), brand, is_active, published_at | RLS mirrors `services_public_read` through `provider_is_public`. Owner write mirrors `services_owner_write`. |
| `product_variants` | product_id, sku (unique per provider), price_minor `bigint`, compare_at_minor `bigint`, currency 'AOA', weight_g, dims, is_active | Option values come from category-scoped attribute definitions (§2.3). |
| `stock_levels` | variant_id, pickup_point_id nullable, on_hand int, reserved int, `check (on_hand >= 0 and reserved >= 0 and reserved <= on_hand)` | **The database refuses oversell.** Reserve with a conditional `UPDATE … SET reserved = reserved + n WHERE on_hand - reserved >= n` (0 rows means out of stock, raised with a dedicated SQLSTATE or constraint name). Never read-then-write in app code. |
| `stock_movements` | variant_id, delta, reason (restock/order_reserve/order_release/sale/return/adjustment), actor, order_id | Append-only ledger, mirroring `booking_events`. Kept out of `audit_log`. |
| `orders` | client_id, provider_id, status, fulfilment_method, pickup_point_id, delivery_zone_id, `order_address_id` (erasable, §1.9), subtotal_minor, delivery_fee_minor, total_minor, deposit_minor (all `bigint`), payment_instructions, policy_snapshot, cancellation_reason, expires_at, is_demo guard | One order per seller: there is no platform checkout and no escrow. |
| `order_items` | order_id, variant_id, quantity > 0, unit_price_minor, name/variant snapshot, line_total_minor (computed in SQL) | Frozen by a guard trigger, following the `bookings_guard_columns` pattern. |
| `order_events` | append-only audit, ids only (no addresses) | Analogue of `booking_events`. |
| `seller_delivery_zones` | provider_id, location_id (matched via `location_descendants`), fee_minor `bigint`, min_order_minor, lead_days | The seller declares the fee; NGUEZA only displays it. |
| `pickup_points` | provider_id, location_id, address, hours | |
| `return_requests` / `return_items` | order_item_id, qty, reason, photos (private documents bucket), status, window from `delivered_at` | §4D |

- Public stock answer: a SECURITY DEFINER `variant_stock_level(variant_id)` returning only a boolean or a coarse level (em stock / últimas unidades / esgotado). Anon cannot see stock rows; this is the same trap CLAUDE.md describes for `resource_is_free`. Add it to `06_function_grants.sql`.
- Out-of-stock competitors: when the last unit goes, the database moves accepted-but-unpaid orders to `out_of_stock`, mirroring 0033's `unavailable`.
- Optional server-side cart: per client, split per seller.

### 1.6 Service areas and delivery — **M**

**Findings**
- A provider is a single point: `providers.location_id`, `address_line`, `lat`, `lng`.
- Search (`lib/search.ts:179`), quote fan-out (`quote_request_open_and_matches`, 0041, plus the 0028 matching-supplier RLS) and `enqueue_quote_request_notification` (0028) all match `p.location_id in location_descendants(...)`.

**Proposal**
- Add `provider_service_areas(provider_id, location_id)`, with a public read gated by `provider_is_public`.
- Match "located in OR serves OR delivers to".
- Search and quote matching must change in the same slice, or they will disagree about who serves where.

### 1.7 Price units as rows — **M**

**Findings**
- The `services.price_unit` CHECK `('event','hour','day','person')` defaults to `'event'`.
- The unit label map is triplicated in `app/SupplierCard.tsx` (UNIT), `app/painel/[providerId]/page.tsx` (UNITS) and `app/fornecedor/[slug]/page.tsx` (UNITS). More readers: `lib/search.ts` (~90, 150-157, 213, 282), `lib/painel.ts:78-84`, `lib/event-plans.ts:525`, `lib/onboarding.ts` serviceInput (z.enum).
- `services.min_capacity`/`max_capacity` hold guest counts.

**Proposal**
- Add a `price_units` table (slug, pt-AO label, plural, applies_to fulfilment model, optional category scope). Seed it with the four existing slugs plus visita, serviço, aula/sessão, m², km, noite, mês, unidade, kg, litro, caixa.
- Repoint `services.price_unit` to a FK on the slug, which replaces the CHECK.
- Change the default to a neutral unit.
- Generalise capacity to `min_qty`/`max_qty` plus a per-category label (§2.3).

### 1.8 Polymorphic anchors for money and trust records — **M** (one slice, many policies)

Everything below today hangs off `bookings` alone. For each, add a nullable `order_id`, with `check (num_nonnulls(booking_id, order_id) = 1)`:

| Record | Today |
|---|---|
| `payments` | `booking_id NOT NULL` (0008:36) |
| `payment_documents` | 0025 |
| `refund_attestations` | 0045; also add `return_request_id` |
| `reviews` | 0007; verification via `order_item_id` (unique) |
| `reports` | `target_type` |
| `legal_acceptances` | 0042, `context 'order'` |
| `support_requests` | 0038, `ref_kind` plus ref |
| `admin_notes` | `target_type` |
| `audit_log` | `target_type` plus product, variant and order triggers |
| `event_plan_items` | 0046 |
| `notification_outbox` | kinds |

**Risk.** Every RLS policy joins through `bookings`: `payments_party_read`, `payments_admin_write` (0011), `payment_documents_*`, `payments_client_submit` (0025), `refund_attestations_*` (0045), and `reviews_author_insert` via `booking_is_authors` (0031). Each needs an order branch and per-role tests. The triggers `payments_hold_booking`, `payments_notify_submitted` and `refund_attestations_notify` select from bookings.

**Freeze the dormant payout shapes** in 0008: `refunds` (status processed, processed_by), `payment_events` (webhook log) and `provider_key` values `card` and `multicaixa_reference`. Either drop them or document them as frozen behind a lint rule, so nobody wires product checkout through NGUEZA (BNA licensing; never-automate).

### 1.9 Personal data — **M**

- **Supplier addresses are public.** The 0031 anon column grant exposes `address_line`, `lat`, `lng`, `phone` and `whatsapp`. The JSON-LD `LocalBusiness` block in `app/fornecedor/[slug]/page.tsx` publishes streetAddress and geo. A home-based plumber or seller would publish their home.
  - Add `providers.address_visibility` (public premises / area only / after acceptance).
  - Revoke the street columns from anon and expose them through a definer function or view when public.
- **Client addresses must be erasable.** Delivery and service addresses go in erasable `order_addresses`/`booking_addresses` tables (§37 erasure, 0013). Append-only logs hold ids only.
- **Order contact.** Add `order_client_contact(order_id)` as a definer function on the 0034 pattern, granted to authenticated only.

### 1.10 Media per offering — **M**

**Findings**
- `media` is keyed on provider only (0004:178).
- There is a free-text `event_type` column.
- 0032 sets one cover per provider (`media_one_cover_idx`), a 30-photo cap and a 2-video cap, and the object prefix `<provider_id>/`.
- `lib/media.ts` VARIANTS are landscape fill crops.
- `deploy/cloudflare-images/src/index.ts` enforces `OBJECT_ID /^uuid\/uuid$/`.

**Proposal**
- Add nullable `service_id`, `product_id` and `variant_id`.
- Use a partial unique cover index per listing.
- Cap per listing.
- Add square/contain packshot variants. Change `lib/media.ts`, the Cloudflare worker and the imgproxy HMAC path together.
- Keep the provider prefix, so existing signed URLs keep working.
- Product photos must not take over the provider cover (`media_00_before_insert`).

### 1.11 Staff and members — **L, later**

- `owns_provider()` (0005:24-30) assumes one owner (`providers.owner_id`), and every provider-side policy and notification uses it.
- Add `provider_members(provider_id, profile_id, role)` and redefine `owns_provider` on membership.
- This touches every policy at once, so it needs a full `02_rls.sql` re-assertion.

### 1.12 Location levels — **M**

- `locations.level` is a 4-value CHECK (0003:44-45). It is mirrored by a z.enum in `lib/taxonomy.ts:40` and the `LocationNode.level` union.
- `/procurar` `resolve()` (lines 70-75) matches `?zona=<slug>` with `find()` over every municipality nationally. That is safe only while Luanda is the sole province.
- Fix: make the level a row (or drop the CHECK), and resolve zones by path or id, with redirects for existing `?zona=talatona` links.

**Theme 1 risks:** live data (supplier_type backfill, payments and anchors, price_unit, addresses), RLS (every anchor policy), money (bigint everywhere, oversell guard).

---

## 2. Taxonomy and verticals

### 2.1 Category behaviour — **M**

**Findings**
- `categories.default_supplier_type` CHECK `('venue','service','either')` (0003:19-20), mirrored by the z.enum and the `CategoryNode` union in `lib/taxonomy.ts`.
- `app/admin/categorias/page.tsx` and `[id]/page.tsx` describe only "Espaço / Serviço". Editing a category silently leaves existing providers unconverted.

**Proposal**
- Replace it with `default_fulfilment_model`: exclusive_slot / capacity_slot / on_request / product / either.
- Optionally add a `category_fulfilment_models` join.
- Admin UI:
  - group by vertical;
  - add an icon picker (the `categories.icon` column exists and `taxonomy-actions.ts` parses it, but nothing renders it);
  - warn or block when switching the model on a category that already has listings.

### 2.2 Tree shape and pickers — **S–M**

**Findings**
- There is one root (`eventos`) and 14 leaves (`seed/reference/00_taxonomy.sql`).
- "Pickable" means `parent_id is not null` in the five places listed in the header. With deeper trees that predicate would offer grouping nodes, and `sort_order` collides across verticals.
- `app/lista-de-espera/page.tsx:33` also filters `default_supplier_type = 'venue'`.
- `categoryTree()` counts only `providers.category_id` exactly: no descendants, no services, so a root always shows 0.

**Proposal**
- Add `is_assignable` (or derive leaves) and an `assignable_categories` view ordered by root, then path.
- Render `<optgroup>` per vertical.
- Count supply over `category_descendants` across services and products.

### 2.3 Category-scoped attributes, replacing venue-only amenities — **L**

**Findings**
- `amenities` and `resource_amenities` (0043) are global booleans attached only to resources. They are seeded in a migration, not in `seed/reference`.
- The search filter shows every amenity in use regardless of category, and choosing one excludes all services (`lib/search.ts:189-194`).
- `app/admin/comodidades` says "Comodidades dos espaços".

**Proposal** (additive)
- `attribute_definitions`: slug, label, value_type bool/int/enum/text, unit, `category_id` scope that inherits down the tree.
- `attribute_options`.
- `listing_attribute_values` on resources, services or products.
- Variant axes (tamanho, cor, voltagem) as definitions.
- Keep `amenities` slugs: `?comodidade=` is fixed URL vocabulary. Scope the existing 9 rows to the Eventos venue subtree in a new migration, with NULL scope meaning "legacy/global" during the transition.
- The insert policy must check that the attribute's scope matches the listing's category.

### 2.4 Documents per trade — **M**

**Findings**
- `document_kinds.required_for` `('all','venue','service','none')` (0044:22-23).
- The checklist is computed in `lib/document-checklist.ts` from the `SupplierType`/`RequiredFor` unions, and `lib/documents.ts` `providerChecklist()` reads `providers.supplier_type` only.
- No admin UI writes `document_kinds`.

**Proposal**
- Add `document_requirements(document_kind_slug, category_id null, fulfilment_model null, required bool)`, inherited down the tree.
- Seed new kinds in `seed/reference`: carta_de_conducao, livrete, seguro_viatura, licenca_sanitaria, certificado_profissional, alvara_comercial for sellers.
- Build `/admin/documentos`.
- Never rename existing slugs: `provider_documents.kind` FK has `on update cascade`.
- **Human decision:** which papers each trade legally needs. Verification decisions stay human.

### 2.5 Tips, icons, photos — **M**

**Findings**
- `lib/event-tips.ts` holds `BY_CATEGORY_SLUG` (13 event slugs), a venue/service fallback, and `GENERAL_TIPS` such as "para o dia do evento". A plumber would get "tempo de montagem antes do evento".
- `lib/provider.ts` `planningContext()` uses the provider's category, not the booked service's.
- `app/CategoryIcon.tsx` has `STATIC_PHOTO_SLUGS` and `CATEGORY_PATHS` (13 slugs), plus `public/categories/*.webp` (Pexels; licence notes kept in that file).

**Proposal**
- A `category_tips` rows table resolved from leaf to root, then fulfilment model, then global, with neutral general tips.
- Icons render from `categories.icon` (a key into an extended blue line-icon set: wrench, broom, book, truck, bag, scissors), falling back to the nearest ancestor.
- Category photos through Cloudflare via signed URL (category-scoped media), with licence provenance in `seed/examples/photos/photos.tsv`.
- Keep the 128px thumbs: the homepage rail is on the LCP critical path.

### 2.6 Proposed top-level verticals for Angola (rows, seeded inactive in a new `seed/reference/02_verticals.sql`)

| Vertical (root) | Example leaves | Default model |
|---|---|---|
| **Eventos** (existing) | salões, casas de festas/praia, salas de conferência, DJs, som, iluminação, decoração, buffet, fotografia, vídeo, maquilhagem | exclusive_slot / capacity_slot |
| **Casa e Reparações** | limpeza, canalização, electricidade, pintura, serralharia, carpintaria/montagem de móveis, jardinagem, desinfestação, ar condicionado e frio, reparação de electrodomésticos | on_request / capacity_slot |
| **Beleza e Bem-estar** | cabeleireiro e tranças, barbeiro, unhas, estética, massagem, maquilhagem (cross-listed) | capacity_slot |
| **Aulas e Explicações** | explicações escolares, línguas, música, informática, preparação para exames | capacity_slot |
| **Transporte e Mudanças** | mudanças, motorista, estafeta/entregas, aluguer de viatura com motorista, transporte escolar | exclusive_slot (vehicle resources) / on_request |
| **Auto** | mecânica, lavagem, bate-chapa, pneus | on_request |
| **Comida e Catering** | catering, bolos, salgados (licença sanitária) | on_request / product |
| **Tecnologia e Profissionais** | reparação de telemóveis/computadores, design, fotografia (cross-listed) | on_request |
| **Produtos** (launch subset is a decision) | casa e decoração, electrodomésticos, electrónica, moda e tecidos, material para festas (sale vs rental), materiais de construção | product |

**Reparent vs cross-list.** Reparenting `maquilhagem`, `fotografia` or `buffet` out of Eventos would change what `category_descendants('eventos')` returns. A search or quote request on Eventos would then stop matching make-up artists (`lib/search.ts:173-177`, 0028). Recommendation: **cross-list** through a `category_links(category_id, also_under_id)` table, not reparenting.

Seed rules:
- Never edit `00_taxonomy.sql`. It uses `on conflict do nothing`, so edits never reach existing databases.
- Keep event slugs stable. `seed/reference/01_event_types.sql` resolves needs by slug, and `tests/integration/event-plans.test.ts` and `taxonomy.test.ts` use them.

**Theme 2 risks:**
- `newsletter_subscribers.interests` holds category ids in jsonb with no FK.
- `services.category_id` and `providers.category_id` are ON DELETE RESTRICT.
- Adding rail items affects the LCP budget.

---

## 3. Search and discovery

| # | Finding (file) | Proposal | Effort |
|---|---|---|---|
| 3.1 | `lib/search.ts` `search()` returns one hit per **provider** (`candidate` CTE, `distinct on (id)`). `SearchHit` is shared by `/procurar` and the homepage rail. | Add an offering-level search document (§3.9), with hits per offering and optional grouping per provider. | L |
| 3.2 | No free text. `providers_name_trgm` (0004:68), `pg_trgm` and `unaccent` (0001) are unused. | Add `?q=`: a Portuguese tsvector through an immutable unaccent wrapper over provider, service, product and category names, a trigram fallback, and rank folded into `sort_num` so keyset paging holds. Record `q` (trimmed, capped) in `recordSearch`. | M |
| 3.3 | Price shown and budget filtered on the cheapest service in **any** category (lateral, lines 156-162, budget at 184). Price-on-request always passes. `preco` sort mixes units. | Restrict to offerings in the matched category; compare only within one unit, or group by unit. Update the slice-42 tests. | S–M |
| 3.4 | Date availability is checked only for `supplier_type='venue'` (lines 202-207). Day bounds are a JS literal `+01:00` (lines 122-123), while `lib/provider.ts` uses `at time zone 'Africa/Luanda'`. The header still says "N … livres a dd/mm" for services that were never checked (`app/procurar/page.tsx:228`). | Add a definer `service_slot_is_free`/`provider_has_capacity` mirroring the concurrency trigger, with an anon test. Products get a stock or "entrega até" predicate, never a calendar. Compute day bounds in SQL. Only say "livres" when an `availabilityChecked` flag is set. | M |
| 3.5 | Fixed facets: Data, Pessoas, Orçamento, Ordenar, "O espaço tem". Optgroups split Espaços/Serviços. Capacity reads `resources.capacity` only and ignores `services.max_capacity` (line 183). | Facets driven by the category from §2.3, rendered server-side in a GET form (JS budget). Keep the `?data`, `?pessoas` and `?comodidade` params working: deep links come from `lib/notify.ts`, `lib/event-plan-math.ts` `supplierSearchHref` and `app/reservas/[id]`. | L |
| 3.6 | Location: a single point; "Toda a Luanda" hard-coded; ungrouped municipalities. | Service areas and delivery zones (§1.6); province optgroups; an empty option labelled from the location row. | M |
| 3.7 | Zero results: the quote link keeps only `?categoria`; "outra zona ou data" drops every filter. No "avise-me", although `lib/newsletter.ts:35` accepts source `zero_result`. `app/pedir-orcamento/page.tsx` prefills only `categoria`. | Pass every validated filter through, round-tripping `/entrar?next=`. Offer relaxed counts (no date, parent zone, no attributes) bounded in one statement. Add email capture (the consent copy is human-written). | M |
| 3.8 | Ranking: "Relevância" is really "priced first, then alphabetical". The `provider_health` comment (0010) claims stale suppliers are demoted in date-filtered search; `search()` never reads it. | Define relevance as text rank + has price + verified reviews + responsiveness + in-stock first, via a public definer function or a precomputed score. `provider_health` stays admin-only (0024). | M |
| 3.9 | Scale: correlated subqueries (cover, categories, ratings) run per candidate before LIMIT, against a target of 100k+ providers plus products. | A denormalised `search_documents` table or materialized view (one row per offering, with tsvector, category path ids, price, unit, stock flag, rating, cover). Index it on the keyset tuple and refresh by trigger or job. Expose it only through RLS or a definer function, and refresh on suspension or unpublish. | L |
| 3.10 | `app/SupplierCard.tsx` is provider-only ("até N pessoas", UNIT map) and is the homepage LCP element. | Add a ProductCard/OfferingCard (price per unit, Em stock/Esgotado, Entrega/Levantamento chips). Server components only. | M |
| 3.11 | Homepage `filters()` (`app/page.tsx:30-56`): 8 leaves with no "has supply" rule, unlike `/procurar` (slice 42 R002). Rail photo is the newest provider cover in that category. | Show verticals or a curated `is_featured`. Share one `categoriesWithSupply()` helper between `/` and `/procurar`. | S–M |
| 3.12 | SEO: no landing pages; `app/sitemap.ts` lists `/`, `/procurar`, `/ajuda` and `/fornecedor/<slug>` with `limit 5000` and no index; no canonical; `app/robots.ts`. | Routes such as `/procurar/[categoria]/[zona]` from rows that have supply. `generateSitemaps()` with keyset chunks. Canonical URLs; noindex on cursor and attribute combinations. Disallow order and checkout token routes. | M |
| 3.13 | Analytics: `recordSearch()` props are event filters only; the `events.name` CHECK (0010:11-20) has no product names. | Add `q`, `facets` jsonb and root vertical to props, plus new event names. These must exist **before** launch, because `events` cannot be backfilled. | S |
| 3.14 | Tests: `tests/integration/search.test.ts` (~20 cases) is venue-centric, and there is no e2e at 390px. | Add cases for `q`, service capacity, scoped facets, area matching, stock filter, unit grouping and matched-category budget. Add a Playwright `/procurar` flow. | M |

**Theme 3 risks:**
- The RLS trap from 0014 (any inline `not exists` over bookings as anon reads as free).
- The LCP and JS budgets on `/` and `/procurar`.
- Ranking fairness should be explained on the help pages.

---

## 4. Transaction flows

Four flows. The money rule is the same in all of them: the client pays the provider directly, and NGUEZA only records claims (proof upload, supplier receipt attestation, refund attestation, client "recebi/não recebi").

### A. Exclusive slot (venues, vehicles, equipment) — **unchanged**
This is today's booking machine (`spec/states.md`): requested → accepted → awaiting_payment → confirmed → completed, plus cancelled_*, expired, rejected, unavailable (set by the DB only), no_show and blocked. The only change is that `blocks_calendar` derives from the offering (§1.1).

### B. Scheduled appointment (capacity slot: beauty, lessons, cleaning slots) — **M**
- Reuse the booking graph.
- The client chooses a service, and `service_id` is always posted.
- The window comes from the start time plus `services.duration_minutes`. Retire `eventWindow`'s past-midnight roll-over and 7-day cap (`lib/booking-labels.ts`) for this mode.
- Add working hours and time-off for service providers. Today `blockForm` and `doBlockDate` require `resourceId`. Time-off must be `blocked` bookings counted by the concurrency trigger.
- Show availability on the profile through a definer `offering_slots(offering_id, day)`. Today `lib/provider.ts` `availability()` covers venues only.
- Use shorter hold windows for same-day work, and notice tiers in hours (§4E).

### C. On-request job or quote (plumbing call-out, removals, custom orders) — **M–L**

**Findings**
- `quote_requests.event_date` and `capacity` (0027:17-18) are immutable via `quote_requests_guard_immutable`.
- Expiry runs on `event_date` (0030; latest `quote_request_open_and_matches` is in 0041).
- `quote_offers` holds one price with no link to a service, product or quantity.
- `lib/quotes.ts` `acceptOffer` sends the client back to the calendar. The 0029 header records why auto-creating a booking was refused: there is no `resource_id`.
- The supplier then retypes the total in `doRequestPayment`.

**Proposal**
- Add `needed_by` (date or window), `quantity` + unit, `fulfilment_mode` (on_site / at_provider / delivery / pickup), service address and jsonb attributes validated against category attribute rows. Keep `event_date` and `capacity` as legacy columns.
- Offers carry `service_id`/`variant_id`, quantity, `delivery_fee_minor`, `valid_until` and lead time.
- Acceptance creates a booking request or order through a definer function, with `total_minor` frozen from the offer and never taken from the URL.
- The booking still passes the exclusion and concurrency checks (handle 23P01).
- Add an `in_progress` status and an urgent "o mais cedo possível" option.

### D. Product order (new) — **L**

```
placed ──seller accepts (stock reserved in DB)──▶ accepted ─▶ awaiting_payment ─▶ paid (seller attests receipt)
   │                                                 │ (pay-on-delivery: accepted ─▶ preparing)
   ├─▶ rejected | expired (sweep) | cancelled_client                       │
   │                                                                       ▼
   └─▶ out_of_stock (DB only)            preparing ─▶ ready_for_pickup | dispatched ─▶ delivered/collected
                                                                         (client confirms, or auto after N days w/o dispute)
                                                                                         ─▶ completed
   cancelled_client (before dispatch) · cancelled_seller · return_requested ─▶ return_accepted|return_rejected ─▶ returned (+ refund attestation)
```

**Mechanics**
- `order_can_transition()` and an actor guard per role (who may walk each edge), following `bookings_guard_actor`.
- `order_events` is append-only.
- An expiry sweep releases `reserved` stock atomically.
- `orders_guard_demo`, plus an `orders_paused` switch through a trigger raising 55000.
- Rate limits on order creation in `lib/rate-limit.ts` (today only signin, signup, reset, waitlist and support), plus a database cap on concurrent open holds per client. This prevents inventory griefing.
- Document the machine in `spec/states.md` before writing code.

**Payment**
- Proof upload is allowed while an amount is outstanding. Today `payments_client_submit` only allows it in `awaiting_payment`.
- A supplier-side "recebido" attestation per payment covers cash or TPA on delivery.
- An optional `payment_schedule` (label, amount_minor, trigger: on_confirmation / before_start / on_delivery / fixed_date).
- Default payment instructions per provider, applied automatically.
- No card checkout via NGUEZA. If a gateway ever comes, the seller must be merchant of record, with a human in the loop.

**Verified reviews**
- Verification requires a delivered `order_item` authored by the buyer.
- The seller can never mark an item delivered and thereby unlock a review on their own (the B8 self-review vector).
- Auto-completion only follows client confirmation or a timeout after dispatch with no dispute.
- New columns must be added to both review guard column lists.

### E. Cancellation, returns and refunds — **M–L**

**Findings**
- `cancellation_policies.tiers` (days_before, refund_pct) with `cancellation_tiers_valid` 0..365 days, and `compute_refund_pct(tiers, starts_at, decided_at)` (0026).
- The platform default is 30/14/7 (`seed/reference/00_taxonomy.sql`).
- The resolution query is duplicated in four places: `bookings_set_terms` (0035), `lib/booking.ts:83`, `lib/cancellation-policy.ts`, `lib/painel.ts:165`.
- `refundEntitlement` covers only `cancelled_client` and `cancelled_provider`.

**Proposal**
- `policy_kind` (cancellation_notice in hours or days, before_fulfilment, returns).
- A separate returns policy: window after delivery, condition, who pays return transport, non-returnable categories.
- Snapshots versioned `{version, kind, tiers}`. The engine must keep reading v1 snapshots on live bookings.
- `compute_refund_amount(total_minor, pct)` with an explicit bigint rounding rule.
- Per-category defaults through a nullable `category_id`, resolved provider → nearest category ancestor → platform, in **one** shared SQL function.
- Refund causes: client_cancel, supplier_cancel (rule set by humans), return_accepted, not_delivered dispute.
- `refund_attestations` anchored to booking, order or return, with an outcome of refund / exchange.
- The method list is duplicated three times (0045 CHECK, `lib/refunds.ts`, `lib/notify.ts` `REFUND_METHOD_WORDS`) and must stay in sync.

### F. Notifications, jobs and switches — **M**

**Notifications**
- The `notification_outbox.kind` CHECK has been rewritten six times (0019, 0027, 0030, 0033, 0038, 0042, 0045). Replace it with a `notification_kinds` rows table or a prefix pattern.
- Add order_* kinds (placed, placed_seller, accepted, awaiting_payment, ready_for_pickup, dispatched, delivered, cancelled_*, return_*, stock_low).
- Write `enqueue_order_notification` on `order_events`, keeping the 4-column ON CONFLICT target and the text `source_id`.
- `lib/notify.ts` needs renderers and a `notificationPath` per kind, ideally as a `{kind: {audience, path}}` table so new kinds cannot fall through to null.

**Jobs**
- `app/api/cron/expire/route.ts`, the 0037 `job_runs` CHECK `('expire','notify')`, `job_health()`, `lib/jobs.ts` `JobName`, `deploy/cloudflare-cron/src/index.ts` SCHEDULES and `tests/unit/cron-worker.test.ts` all assume exactly two jobs.
- Add sweeps for stock holds, delivery auto-confirm and return-window close, and make `/api/saude` alarm on them.

**Switches**
- `lib/switches.ts` `SwitchKey` and the 0039 key CHECK are global, and `bookings_paused` does not stop quote requests.
- Move switches to rows with an optional scope (category subtree or fulfilment model). Enforce them in booking, order and quote insert triggers.

**Theme 4 risks:**
- Money: no automation of confirmations or refunds; adapters are never-automate.
- Legal: returns, warranty and supplier-cancellation duties.
- RLS: every new policy needs per-role tests.
- Concurrency: the last unit of stock.
- Live data: frozen snapshots, quote rows with `event_date`.

---

## 5. Supplier tools

| Item | Findings | Proposal | Effort |
|---|---|---|---|
| Registration | `app/registar-negocio/page.tsx`: venue placeholders ("Salão Horizonte", "Via S8, Talatona"), an agenda hint about espaço/serviço only, one flat category select (`lib/painel.ts` `formOptions`), one municipality, address required. `app/painel/actions.ts` `doRegisterBusiness`. | Step 1 asks what you offer (space / scheduled service / at the client's home / products, several allowed). Grouped category picker. Service areas or delivery zones multi-select. Address optional and its visibility selectable. | M |
| Creation side effects | `createProvider` auto-inserts the "Espaço principal" resource for venues (`lib/onboarding.ts:118-181`). | Seed a resource only when an `exclusive_slot` offering is created. Keep the `onboarding.test.ts` venue cases. | S |
| Offering forms | `ServiceFields.tsx`: venue placeholders, unit select, capacity in people. `serviceInput` zod (`lib/onboarding.ts:70-101`). | Placeholders, units and fields from category metadata. Add duration and buffer. A separate product form (SKU, variants, stock, weight, delivery options). One shared unit label source. | M–L |
| Overview and nav | `app/painel/[providerId]/page.tsx` PageHead is a binary venue/service sentence. Sections Serviços e preços / Espaços plus `AmenityChecks`. `layout.tsx` NavGroups are fixed. `app/painel/page.tsx` shows an Espaço/Serviço chip. | Modules and nav built from the offering kinds present: Produtos, Stock, Encomendas (with count), Entregas/Zonas, "Cancelamento e devoluções". Hide Reservas for sellers with products only. | M |
| Dashboard | `lib/dashboard.ts` `supplierOverview()` (95-157) and `lib/painel.ts` `dashboardCounts` count bookings only. | Order metrics (new, to dispatch or ready, low stock, value declared and agreed), grouped by `created_at` month. Under RLS, missing SELECT policies return 0 silently, so test them. | M |
| Catalogue scale | `ownedServices`/`ownedResources` have no LIMIT, and every row gets an inline edit form. | `/painel/[id]/produtos` with keyset pagination, search, filters and bulk price/stock editing. Stock changes write `stock_movements` deltas and never absolute values from a stale read. CSV import later. Stay inside the 180KB JS budget. | M |
| Inboxes | `app/painel/[providerId]/reservas/page.tsx` + `lib/booking.ts` `providerBookings` (unbounded). The detail page `NEXT_STEPS` assume a single dated item. Quote inbox `pedidos` shows "Data do evento", "N pessoas" and a single price. | Keyset pagination and status filters. Time-off for services. New Encomendas inbox and detail (lines, address revealed after accepting, fulfilment, attestations). Structured quote offers. | L |
| Policies | `app/painel/[providerId]/cancelamento/page.tsx` "Dias antes do evento". | An editor per policy kind (hours/days notice; before dispatch plus returns window). Wording stays human-reviewed. | M |
| Photos | `lib/photos.ts` `MAX_PHOTOS=30`, provider gallery; `fotos/page.tsx` guidance is about venues. | Per-listing galleries and covers; guidance by category. | M |
| Documents | `DocumentUpload.tsx` is already generic. | Pass only the kinds relevant to the provider's categories. | S |
| Staff | Single owner (§1.11). | `provider_members`, later. | L |

**Theme 5 risks:** stock concurrency, the RLS hole on behaviour columns (§1.1), the JS budget, and legal wording for returns.

---

## 6. Client tools (and the event planner)

| Item | Findings | Proposal | Effort |
|---|---|---|---|
| Shell | `app/dash/ClientShell.tsx` groups Reservas and Pedidos under "Eventos", with the primary action "Planear evento". `ROLE_LABEL` 'Fornecedor'. `app/dash/DashShell.tsx` placeholder "Procurar salões, DJs, buffet…"; trust line "Paga sempre ao fornecedor". | Group by activity (Reservas, Encomendas, Pedidos de orçamento), with Planos as optional. Primary action "Procurar". Neutral placeholder. Keep the trust meaning. Add `clientNavCounts` (`lib/dashboard.ts`) for orders. Add `/encomendas` to `DASHBOARD_PREFIXES` in `app/SiteHeader.tsx`. | S–M |
| Overview | `app/conta/page.tsx` hero is the next event plan (days left, convidados, budget). Alerts come only from bookings, plan items and quotes. "Próximas reservas" sorts by `startsAt`. | Activity first: reservas activas, encomendas em curso, propostas, notificações. A plan hero only if a plan exists. Extract `clientAlerts()` with an order source. A mixed "Em curso" list that tolerates items with no time. | M |
| Transactions | `app/reservas/page.tsx` "As minhas reservas". `app/reservas/[id]/page.tsx` assumes a dated event at the supplier's venue (Local, weather, "Dicas para o seu evento", "Faltam N dias"). `lib/booking-labels.ts` `nextStep`, `groupClientBookings`, `dateTile`, `listHint`, STATUS_LABEL. | Keep `/reservas` URLs (emails link there). Add `/encomendas/[id]`: lines with bigint totals, fulfilment timeline, "Recebi a encomenda", returns entry, payment card with the anti-fraud copy. Labels per kind: `Record<Kind, Record<Status,string>>`. Weather only for categories flagged weather-relevant, at the place where the work happens (`lib/weather.ts`). | M–L |
| Address | `profiles` has no address. | Snapshot the address on each order or booking in the erasable tables (§1.9). Defer an address book (decision). | S |
| Planner | 0046 tables (`event_types`, `event_type_needs`, `event_plans` event_date/guest_count/budget_minor, `event_plan_items` booking_id only), `lib/event-plans.ts`, `lib/event-plan-math.ts`, `/conta/eventos/**`, `/admin/tipos-de-evento`, `seed/reference/01_event_types.sql`. Shipped in the latest commit (aa672ca), so production may hold client plans. | **Keep the tables as the Eventos vertical's planner and generalise additively. Do not rename.** Add a nullable `root_category_id` on types; per-type `date_label`/`headcount_label`; plan items linking to `order_id`/`quote_request_id` (exactly 0 or 1, with the ownership guard extended). Add `template_need_id` on items: today `updatePlan` re-matches by `n.name = i.name` and silently skips renamed lines, which is an existing bug. `marketPrices()` should also read product variants and prefer the template's unit, not `'event'`. `supplierSearchHref` should add `data`/`pessoas` only where the model uses them. `planningOptions` should group by vertical. Non-event templates (Mudança de casa, Obras, Regresso às aulas) come later as rows. | M |
| Inbox | `app/conta/notificacoes/page.tsx` falls back to "Notificação" for kinds with no renderer; limit 50. | Renderers for every kind; a filter by type; keyset pagination on (created_at, id). | S |
| Quotes list | `app/conta/pedidos/page.tsx` "Data do evento", "{capacity} pessoas"; legacy CSS. | "Data pretendida", quantity with unit. Keep "Pedidos de orçamento" separate from "Encomendas" so "pedido" is never ambiguous. | S |

**Theme 6 risks:** owner-only RLS on plans, privacy of delivery addresses, existing email links.

---

## 7. Copy, SEO and brand (legal items listed separately at the end)

### 7.1 Copy an agent may change (pt-AO, user-facing only; never mix languages in one string) — **S–M overall**

**Global pitch**, duplicated in four places: `app/layout.tsx:11-19`, `app/page.tsx:22-27`, `app/manifest.ts:10-14`, `app/procurar/page.tsx:12-17`. Replace with one constant, e.g. `lib/site-copy.ts`.

**Home** (`app/page.tsx`):
- hero (71-80);
- date-first search form (82-106): show the date only when the category's model needs it, using a CSS-only reveal with no JS;
- trust strip "48h Resposta" (125-138): keep it only if order expiry is also 48h (PRODUCT.md truthfulness);
- "Como funciona" (140-165);
- supplier CTA "Sem comissão sobre nenhuma reserva" (191-201).

**Header and footer:** `app/SiteHeader.tsx` footer lede (149-152), NAV and account menu (18-23, 90, 128-133, 155-160).

**Waitlist:** `app/lista-de-espera/page.tsx` hero, the "Quando é o evento?" field, the steps and the foot. Keep the jsonb key `interests.event_month`, or read both keys: `tests/integration/waitlist.test.ts:232-239` and `lib/admin.ts:453` depend on it.

**Registration:** `app/registar-negocio/page.tsx` placeholders.

**Help:** `app/ajuda/page.tsx` restructured into Reservar / Encomendar / Serviços ao domicílio. Product sections only after the flow ships. Any sentence about rights goes to a human (§7.4).

**Support:** `lib/support.ts` TOPICS plus the 0038 topic CHECK and `booking_ref` regex. Add `encomenda`/`entrega`/`devolucao` and a "Referência do pedido".

**404:** `app/not-found.tsx`.

**Account pages:** `app/criar-conta/page.tsx:55`, `app/entrar/page.tsx:50`.

**Booking, tips and email copy:**
- `lib/booking-labels.ts`;
- `lib/event-tips.ts`;
- `lib/notify.ts`: "Data indisponível", "Estes espaços estão livres", "o fornecedor tem até 48 horas" (pass it from the expiry rule), and quote mail "Data do evento" / "Capacidade";
- `app/cancelar/[token]/page.tsx`: this is newsletter unsubscribe, not booking cancellation. Change its copy to "pedidos e reservas".

**Admin copy:** `app/admin/metricas`, `app/admin/registo` NOTIFY_KIND_LABEL, `app/admin/lista-de-espera`.

**Tests that assert strings:** update `tests/unit/notify.test.ts`, `tests/unit/booking-labels.test.ts` and `tests/integration/onboarding.test.ts` in the same PR.

**Glossary (decision):**
- fornecedor vs prestador/vendedor;
- reserva (slot) / marcação (appointment) / encomenda (order) / pedido de orçamento (quote);
- "Os meus pedidos" as the umbrella.

### 7.2 SEO — **M**
- Keep event keywords on Eventos landing pages; neutralise the global title.
- `app/fornecedor/[slug]/page.tsx` `generateMetadata` and JSON-LD:
  - `LocalBusiness` for premises;
  - `Service` + `areaServed` for area-only providers, with no streetAddress or geo;
  - `Product` + `Offer` (AOA from bigint, InStock/OutOfStock) on new product pages such as `/fornecedor/[slug]/produto/[productSlug]`.
- Landing pages, sitemap index and robots as in §3.12. Demo profiles stay noindex, and demo products are excluded.

### 7.3 Brand
- NGUEZA, never "NGEZA".
- Blue and white only. New category icons use the same blue line set.
- PRODUCT.md "Users / Product Purpose" and the README pitch (lines 3-21, plus the "Venues and services are different products" section) restate the events framing. Design agents read both, so update them. Changing PRODUCT.md and CLAUDE.md framing is a product-owner decision.

### 7.4 Legal items: a human or counsel must write these; code only adds hooks
1. **Termos** (`app/termos/page.tsx`, placeholder): NGUEZA as a pure intermediary for goods; seller responsibility for goods, delivery and warranty; prohibited and regulated goods; direct payment to the seller.
2. **Privacidade** (`app/privacidade/page.tsx`): delivery addresses, recipient names and phones shared with sellers; Lei 22/11.
3. **Devoluções/Trocas**, a new page beside `app/cancelamento/page.tsx` with a footer link.
   - Code adds `legal_documents.kind 'returns'` (and possibly `seller_terms`, `prohibited_items`, `delivery_terms`) and `legal_acceptances.context 'order'`/`'seller_onboarding'` (0042), plus `lib/legal.ts` `LegalKind`/`recordAcceptance`, recorded in the same transaction as the order.
4. Default cancellation tiers per vertical, the returns minimums, and what a supplier owes on its own cancellation (the slice-47 comment flags this).
5. `lib/newsletter.ts` `CONSENT_TEXT`: wider scope is a new consent basis, never applied to existing subscribers.
6. The footer line "A NGUEZA nunca recebe o seu dinheiro" if its wording is extended to sellers.
7. Help `#pagar`/`#cancelar` statements about rights, refunds and pay-on-delivery safety.
8. The "Reserva verificada" → "Compra verificada" seal wording (§30).
9. Which documents each trade legally requires, and all verification decisions.
10. Moving the transactional sender away from `reservas@ngueza.com` (`lib/email.ts`, `.env.example:67`) is a DNS, SPF and DKIM change and stays human-only.

**Gate:** orders must not open to the public until items 1–3 have active `legal_documents` rows.

---

## 8. Admin, ops, docs and tests

### 8.1 Admin — **M–L**

**Verification queue**
- `lib/admin.ts` `verificationQueue()` has no LIMIT and uses the `supplierType` union; `providerForReview()` shows services only.
- `app/admin/fornecedores/[providerId]/page.tsx` labels everything that is not a venue as "Serviço".
- Add keyset pagination, show every listing kind, and add product-specific reject reasons (copy written by humans).

**Payment queue**
- `paymentQueue()` inner-joins `bookings`. Left-join orders. Review stays "mark plausible" only.
- Product volume will need risk-based review, with the seller's own receipt attestation as the primary signal.

**Console**
- `lib/console.ts` covers bookings only: search, `bookingTimeline`, and `addNote` targets.
- Add order search and timeline, with a shared 8-hex reference space or a kind prefix.
- **Existing bug:** `lib/console.ts:94` `(amount_minor / 100)::text` drops cêntimos and skips pt-AO formatting. Return text and format with `lib/money`. Fix this before it is copied for orders.

**Metrics**
- `lib/analytics.ts` `dashboardMetrics`: the leakage ratio counts only booking requests, so every product sale would read as leakage. Add `order_placed` to the denominator, plus an order funnel and a stock-out rate.
- `providerHealthReport` and the `provider_health` view (0010/0031): add order responsiveness and stock freshness. Otherwise sellers with products only are flagged "Inactivo".

**Admin home and navigation**
- `app/admin/page.tsx` SWITCH_LABEL and JOB_LABEL, the weekly booking chart; `app/admin/actions.ts` `doSetSwitch` hard-codes the two keys.
- `app/admin/Chrome.tsx` nav: add product moderation, orders/disputes, attributes, documentos.

**Admin lists**
- `/admin/categorias` (grouped tree, typeahead parent).
- `/admin/comodidades` → attributes (keep the route, or redirect).
- `/admin/tipos-de-evento` stays under Eventos.
- `/admin/localizacoes` level select.

**Moderation intake is missing.** Only `lib/admin.ts` reads `reports`, and no page inserts into them, although `reports_insert_any` (0011:216) allows it. Add report buttons on profile, offering, order and review pages, with reasons `not_delivered`, `not_as_described`, `counterfeit`, `prohibited_item`. A goods marketplace without a notice channel is a legal exposure.

**Decide pre- vs post-moderation** for product listings (decision 7 below).

### 8.2 Ops — **S–M**

**Runbooks** (`docs/runbooks.md`): add oversell, not-delivered and not-as-described disputes, counterfeit or prohibited listing takedown per listing, and pausing orders separately. The evidence record becomes order_events + proofs + attestations.

**Backups** (`docs/backup-restore.md`): add the stock constraint and public stock function to the structural checks, include an order in the rehearsal, and use `--disable-triggers` for append-only `order_events`.

**Supabase docs** (`docs/supabase.md`): seed order and counts.

**Live migrations**
- `scripts/live-migration-status.sh` and `live-migration-detail.sql` hold a hand-maintained fingerprint per migration (0001–0046), and there is no migrations ledger.
- Every new migration must add a fingerprint. Consider a real ledger before the long series.
- Applying migrations to live data stays human-run (never-automate).

**Remote verification** (`scripts/verify-remote.sh`): fixtures use the `saloes-de-festas` and `talatona` slugs. Use stable ids, and add the oversell check next to the double-booking check.

**Demo data**
- `scripts/remove-example-catalogue.sql` must delete products, variants, stock, attribute values and service areas in FK order. Otherwise ON DELETE RESTRICT makes it roll back on live data.
- Example catalogue (`seed/examples/00_example_catalogue.sql`, 24 suppliers) and demo seed (`seed/demo/00_providers.sql`, 6 venues): add new-vertical and product examples under **new id ranges**. Never renumber the existing ones; the integration tests and budget scripts depend on them.

### 8.3 Docs — **S–M**

**CLAUDE.md**
- Restate the product as a marketplace of listings with explicit fulfilment models.
- Extend the hard rule: "never compute stock in application code; decrement under a DB constraint and catch the violation".
- Fix the wrong references: `spec/schema.md` is actually `spec/schema.sql`; the gates table lists `test:concurrency` and `test:e2e`, which do not exist as npm scripts, and there is no e2e suite at all.
- Changing the framing is an owner decision.

**spec/**
- `spec/states.md`: add the order machine; reword "completed: the event happened".
- Write new slice specs for orders, stock, delivery and returns. Mark the existing event and booking slices as the events-vertical contract and leave them unedited: 01 (open question #1 superseded), 06-07, 08, 09, 14, 16, 19, 20, 21, 28, 31, 32, 37, 38, 44, 45, 46, 47, 48, 50.

**README.md / PRODUCT.md:** as in §7.3.

### 8.4 Tests and CI — **M**

**Concurrency** (`tests/concurrency.sh`): keep both races byte-for-byte. Add a third: N simultaneous orders against stock K, exactly K win, and stock never goes negative. Note that the TRUNCATE … CASCADE fixtures will also empty new FK tables.

**SQL tests**
- `tests/sql/01_constraint.sql` stays unchanged.
- Add `09_products.sql`: stock floor, bigint snapshots, order graph, append-only `order_events`, a product cannot enter `bookings`, and RLS per role for every new table.
- Move fixtures in 01/02/04/05/07 to a helper that "creates a provider + offering of kind X", so the discriminator change touches one place.
- `06_function_grants.sql`: add the stock and slot definers to the allowlist deliberately; new sweeps go in the job-only block.

**CI** (`.github/workflows/ci.yml`)
- Money regex (194): widen to any `*_minor`/fee/cost/budget/deposit/shipping column, or better, add a catalog assertion in `db-test` that every `*_minor` column is `bigint`.
- OFFSET grep (198-202): extend from `supabase/` and `scripts/` to `lib/` and `app/`.
- Enum check (186-190): extend to CHECK lists on taxonomy tables and to z.enum over category or location attributes. Today it only catches `create type … as enum`.
- Update the stale "Integration tests" comment.

**ESLint** (`eslint.config.mjs:15`): also ban the `Number(x)` CallExpression on identifiers matching `/minor|price|amount|total|fee|budget|deposit/`, and add bigint helpers (`multiplyMinor`, `sumMinor`) to `lib/money.ts`. Line totals and fees are exactly where the slip will happen.

**Budget scripts**
- `scripts/check-js-budget.sh` and `scripts/check-lcp-budget.sh` measure `/fornecedor/salao-horizonte-talatona` with curl and no `-f`. A missing slug measures the 404 page and passes, which is a false green.
- Use `curl -fsS` or a status check. Add the product detail, storefront and order form routes and a non-event category landing page, using seeded slugs per listing kind.

**Integration and e2e**
- Integration suites to extend: onboarding, booking, payments, refunds, reviews, quotes, search, admin, console, analytics, dashboard, event-plans, switches, jobs, photos, amenities, taxonomy.
- Unit suites: `document-checklist`, `booking-labels`, `notify`, `event-plan-math`, `weather`, `cron-worker`.
- Create the e2e gate (Playwright at 390px) before claiming it.

---

## Proposed slice sequence

Ordering principle: guardrails first, then non-event **services**, which already fit the `capacity_slot` path and ship value earliest. A product catalogue follows before any orders, and orders are gated on human-written legal text. Each slice is additive, keeps venues behaving exactly as now, and keeps every gate green.

| # | Slice | Ships | Keeps the site working because… | Effort |
|---|---|---|---|---|
| **51** | **Guardrails and doc truth** | CI changes from §8.4 (money catalog check, OFFSET over lib/app, CHECK/z.enum detection); ESLint `Number()` rule plus bigint helpers; budget scripts fail on non-200; SQL fixture helper; fix the `lib/console.ts:94` money bug; `providers` guard trigger and REVOKE on `supplier_type`, `concurrency_limit` and `is_demo` (after an audit query); CLAUDE.md reference fixes; `job_runs` and switches move to rows | No behaviour change | S–M |
| **52** | **Taxonomy depth** | `assignable_categories` view replacing the five copies of the predicate; grouped pickers; supply counts over descendants; `categories.icon` rendering with ancestor fallback; `category_links` cross-listing; admin tree grouping; `seed/reference/02_verticals.sql` with roots and leaves **inactive**; waitlist chips no longer filtered to venues | New roots stay hidden until activated | M |
| **53** | **Price units and category facets** | `price_units` table plus FK replacing the CHECK; one label source (removes three UNITS maps); per-category capacity label; neutral default unit | The four existing slugs are kept as rows | M |
| **54** | **Attributes, documents, tips as rows** | Additive attribute definitions and values (amenities scoped to the Eventos venue subtree; `?comodidade` slugs stable); `document_requirements` plus `/admin/documentos` plus new kinds (requirements chosen by humans); `category_tips` replacing `lib/event-tips.ts` | Legacy NULL scope means current behaviour | L |
| **55** | **Service areas, address privacy, locations** | `provider_service_areas`; search and quote matching on areas in the same slice; `address_visibility` plus anon grant revoke plus JSON-LD gating; locations level as rows; `?zona` resolved by path with redirects | Venues default to "public premises" | M |
| **56** | **Offering-level fulfilment model** (the riskiest) | `services.fulfilment_model` backfilled from `supplier_type`; `bookings_00_set_shape` reads the offering; per-service `concurrency_limit`; `service_id` required on new public requests; error mapping per constraint name; compat `supplier_type` column | Backfill runs before the trigger switch; `01_constraint.sql` and `concurrency.sh` stay unchanged and green | L |
| **57** | **Appointments and home services, plus first non-event verticals** | Booking form chooses a service; duration; working hours and time-off for services; `offering_slots` and `service_slot_is_free` definers (anon tests); erasable `booking_addresses` revealed after accept; `quote_offer_id` link; hours-based notice tiers; activate Casa e Reparações, Beleza, Aulas (decision); neutral public copy and `lib/site-copy.ts`; registration step "o que oferece"; dashboard nav by kind | Venue flow untouched; new verticals use the existing service machinery | L |
| **58** | **Search v2** | `?q=` full text plus trigram; matched-category price; unit-aware sort; category-aware facets; truthful "livres"; zero-result relaxed counts, prefilled quote and avise-me; analytics props plus new event names; `search_documents` table; landing pages, sitemap index, canonical; Playwright `/procurar` at 390px | Old params keep working; old cursors fall back to page 1 | L |
| **59** | **Quotes generalised** | `needed_by`, quantity and unit, fulfilment_mode, attributes jsonb, service address; structured offers; accept → booking request via definer (still passes exclusion and concurrency) | `event_date`/`capacity` kept as legacy; outbox contexts read both | M |
| **60** | **Policy engine v2** | `policy_kind`, hours unit, versioned snapshots, one shared resolution function (replacing four), per-category defaults (values set by humans), `compute_refund_amount` | v1 snapshots on live bookings compute unchanged (backward-compat test) | M |
| **61** | **Product catalogue (listings only, no orders)** | `products`, `product_variants`, `stock_levels`, `stock_movements`, `variant_stock_level()` definer; offering-scoped media plus square variants (workers in lockstep); product pages, ProductCard, Product JSON-LD; products in search; seller delivery zones and pickup points (display only); "Contactar / Pedir orçamento" as the action; demo and example products plus the removal script; product listing moderation and report intake | No money or order path yet; value from discovery alone | L |
| **62** | **Orders core** (needs the legal gate: human Termos, Privacidade, Devoluções live) | `orders`, `order_items`, `order_events`, `order_can_transition` plus actor guard; oversell-proof reservation at seller acceptance; expiry sweep; `orders_guard_demo`, scoped `orders_paused`, order rate limits; order_* notification kinds; `spec/states.md`; stock race in `concurrency.sh`; `09_products.sql`; minimal supplier Encomendas inbox and client `/encomendas/[id]`; erasable `order_addresses`; `order_client_contact()` | Bookings untouched; behind a switch until the legal docs are active | L |
| **63** | **Order money and trust** | Polymorphic `order_id` on payments, payment_documents, reviews, reports, support_requests, legal_acceptances, admin_notes, audit_log; pay-on-delivery receipt attestation; optional payment schedule; client "Recebi" plus auto-confirm job; "Compra verificada" from delivered lines; admin payment queue, console timeline, metrics and health include orders; freeze 0008 `refunds`/`payment_events`/`card` | Booking policies keep their tests; new branches get their own per-role tests | L |
| **64** | **Returns** | `return_requests`/`return_items`; returns policy kind; `refund_attestations` anchored to order or return with refund/exchange outcome; `legal_documents 'returns'` plus `context 'order'` hooks (text human-written) | Attestation model unchanged for bookings | M |
| **65** | **Hubs and planner generalisation** | `/conta` activity-first; "Os meus pedidos"; painel modules by kind; product list with keyset pagination and bulk stock; planner items link to orders and quotes; `template_need_id` fix; non-event plan templates as rows | Plan RLS preserved; no table renames | M |
| **66** | **Scale and ops** | `provider_members` and staff roles; runbooks, backup checks, `verify-remote` oversell check; live-migration fingerprints review; multi-seller cart if decided | Full `02_rls.sql` re-assertion | L |

---

## Decisions the business owner must make

1. **Orders or listings only?** Does NGUEZA run the order lifecycle (slices 62–64), or stop at a product catalogue plus contact or quote (slice 61)? This decides whether 62–64 exist at all.
2. **Product delivery model.** Pickup only, seller delivers, seller-arranged courier, or a mix. Are delivery fees declared per zone by the seller? NGUEZA never arranges or pays couriers.
3. **How products are paid without NGUEZA touching money.** Transfer plus proof before dispatch, cash/TPA/Multicaixa Express on delivery, deposit plus balance. Who attests receipt? Confirm that no card checkout goes through NGUEZA (BNA licensing).
4. **When stock is held, and for how long.** At placement (griefing risk) or at seller acceptance (recommended, consistent with today's "requested does not hold the date"). What are the hold and expiry windows?
5. **Launch verticals and order of activation.** Which service verticals go live first, and which product categories at launch. The prohibited and regulated list (food, medicines, alcohol, weapons, used electronics, counterfeit) needs counsel.
6. **Reparent or cross-list** maquilhagem, fotografia and buffet. Cross-listing is recommended, to keep Eventos search results intact.
7. **Pre- or post-moderation** of product listings, and whether product sellers go through the same verification as suppliers.
8. **Document requirements per trade** (alvará comercial, licença sanitária, carta de condução, certificação profissional), set with counsel.
9. **Returns and warranty policy.** A platform-wide minimum or per seller; return window; who pays return transport. Also the supplier-cancellation obligations for services. Legal counsel and human-written text are needed for both.
10. **Cancellation defaults per vertical**, for example hours-based notice for same-day services.
11. **Single-seller orders or a multi-seller cart** (split per seller).
12. **Glossary and positioning.** Fornecedor vs prestador/vendedor; reserva/marcação/encomenda/pedido; homepage pitch. Does "0% comissão" also hold for products, and does monetisation change?
13. **Event planner scope.** Keep it events-only, or offer non-event plan templates.
14. **Address privacy default** for home-based providers (public, area only, or revealed after acceptance).
15. **Geography timing beyond Luanda.** This affects location levels, zone resolution and the time-zone handling in search.
16. **Staff accounts** (`provider_members`): priority for multi-crew businesses and shops.
17. **Marketing consent.** Re-ask existing subscribers under broader consent text, or leave them on the old scope.
18. **Transactional email sender change** (`reservas@` → neutral). This is a DNS, SPF and DKIM change made by a human.