# NGUEZA: the marketplace pivot plan

*For Rosária Kódia's team and the engineer. 13 Nov 2026. It is based on the pivot inventory, the owner's four decisions, three companion proposals and three judges' verdicts.*

---

## 1. Summary

- **NGUEZA becomes a marketplace for any service and any product in Angola.** Categories stay admin-managed rows. Verticals are seeded switched off and opened one at a time. Events stay the first vertical and keep working exactly as they do now.
- **Products are bought by order request.** The client sends items, quantities, and delivery or pickup. The seller confirms stock and sends payment instructions, and the client pays the seller directly. NGUEZA records what each side says and never holds or moves money.
- **Delivery is set by the seller.** A seller offers pickup at their own address and/or delivery to municipalities they choose, at their own fee. NGUEZA shows the terms and records them.
- **"Os meus projectos" replaces the event planner.** A project is any goal: a wedding, renovating a kitchen, a Christmas list, moving house. Each need is checked against real listings, real availability and real delivery zones, and the page gives one "Próximo passo" with a plain reason.
- **Rules do the work; AI is an optional extra.** The intelligence is templates as rows, matching in SQL, and numbered guidance rules. A small, cheap model (Claude Haiku 5.5) can be switched on later for two jobs only, after a human has written the privacy text. Every page works the same without it.

---

## 2. Decisions taken and what each changes

| # | Decision | What it changes |
|---|---|---|
| 1 | Products by order request, paid directly to the seller | The order lifecycle is in scope (it was "maybe" in the inventory). It needs new `order_requests`, `order_request_items` and `order_events` tables, a state machine in `spec/states.md`, and seller and client inboxes. There is no checkout, card or escrow, and 0008's `refunds`, `payment_events` and `card` shapes are frozen behind a lint rule. Orders open to the public only after Termos, Privacidade and Devoluções are live. |
| 2 | Delivery set by the seller | New `seller_delivery_zones(provider_id, location_id, fee_minor bigint, lead_days)` and `pickup_points`. Products are matched by "delivers to your municipality, or pickup nearby". NGUEZA never arranges or pays a courier. |
| 3 | All services and products | `seed/reference/02_verticals.sql` adds every vertical root and leaf as **inactive** rows. Activation is a staged admin action, guided by `demand_signals`. A new vertical needs no code, only templates, attributes and document requirements as rows. |
| 4 | The planner becomes Projects | The 0046 tables are renamed in a new migration, so no plan data is lost. Event types become project templates that cover any goal. Lines link to bookings, quote requests and order requests. AI is optional (see §3). |

**Rename versus additive.** The inventory said "never rename `event_plans`". We rename anyway, for three reasons:
- the owner asked for Projects;
- only 8 files reference these tables;
- `ALTER TABLE … RENAME` keeps the rows, the policies and the foreign keys.

The PR must also do three things:
- recreate `event_plans_guard`, `event_plans_cap` and `event_plan_items_guard`, because their plpgsql bodies name the old tables;
- add a CI grep that forbids `event_(types|plans|plan_items|type_needs)`;
- **update `scripts/live-migration-status.sh:75`.** It detects 0046 with `to_regclass('public.event_plans')`. After the rename, 0046 would show as unapplied, and someone could re-run it on live data.

---

## 3. The projects companion

### Chosen design

The base is design 1, the rules-based guide (it scored 25). From design 3 (24.5) it takes the typed-goal intake, the draft ids and the optional Haiku layer. From design 2 it takes demand signals and line-by-line acceptance. Its parts:

- **Templates are rows.** Groups such as Festas e eventos, Casa, Família and Listas are a parent tree, not an enum. Each template has a date label, a people label (or none), Sim/Não questions, and needs. Each need has:
  - a kind: `book`, `order`, `task` or `offline`;
  - a quantity formula in integer milli-units per person;
  - a lead time and a predecessor;
  - a tip;
  - an `is_optional` flag. Optional needs are shown under "Ideias".
- **Reconcile is idempotent.** A unique index on `(project_id, need_id)` means a later answer adds or flags lines and never duplicates them. This also fixes the name-join bug in `updatePlan`. "Não preciso" (`skipped`) is never suggested again.
- **Two ways in, both first-class:**
  1. **Template links.** Tapping is enough, and no text is typed.
  2. **A typed goal**, read by rules with no AI: Portuguese full-text search over the templates, plus regex for the date, the number of people, the Kz amount (parsed to bigint) and the municipality.

  The result opens an editable step-2 form through `?rascunho=<uuid>` (`project_intake_drafts`), so budgets and dates never appear in a URL. `?exemplo=` links prefill common goals.
- **Matching is in SQL.**
  - `project_item_matches(p_project)` and `project_item_candidates(p_item)` are SECURITY INVOKER functions over the public catalogue. Verified is a ranking key, not a filter, because the catalogue is still sparse.
  - Availability crosses only through definer booleans: `resource_is_free` for venues, and a new `service_is_free` that mirrors the concurrency trigger.
  - Free-date counts are capped at 21 ("20+"), and the functions run under a 1.5 s `statement_timeout`.
  - Ranking is lexicographic, and each position maps to a reason chip: tier, free on date, within estimate, verified, rating, reviews, total, id.
  - Totals are bigint. No total is shown for per-hour prices without a duration, or for `on_request` prices.
- **The guide is `lib/project-guide.ts`.** It is a pure function with fixed-date unit tests. Its rules:

  | Rule | Meaning |
  |---|---|
  | R1 | Overdue |
  | R2 | Due within 14 days |
  | R3 | Scarcity: 3 or fewer free on the date |
  | R4 | The cheapest option is above the line's estimate |
  | R5 | The estimates are above the budget |
  | R6 | Nobody nearby, so ask for a quote or widen the area |
  | R7 | Blocked by a predecessor |
  | R8 | Unanswered questions |
  | R9 | A linked booking or order was cancelled |
  | R10 | New listings since the last visit |
  | R11 | The date has passed, so close the project |

  The top rule becomes the "Próximo passo" and the next three become "A seguir".
- **Prices are honest.** Typical prices (p25–p75) are shown per line, only when there are at least 3 real listings. Design 1's "Projectos assim custam X–Y" is dropped, because a sum of percentiles is not a real project cost. Instead, "Ponto de partida" adds up the line medians, says "baseado em 7 de 12 linhas", and offers "Usar como orçamento".
- **It stays light on a phone.** Every page is a server component, adds 0 KB of client JS (the route is at 176 of 180 KB), and loads no images on the overview. The per-line page shows at most 5 lazy thumbnails. If matching times out, the page says "Opções indisponíveis agora" and still shows the checklist.
- **Plans stay private.** Projects, answers, suggestions, drafts and AI runs are owner-only, with no admin clause. Unmet demand is recorded only as `demand_signals(category, location, week, hits)`, and admins see a row only when hits ≥ 5.

### AI recommendation

**Use AI, but narrowly, and off at launch.** The rules engine gives the "companion" feel with no AI. AI adds real value in only two places: unusual typed goals, and open lists such as a bucket list or a renovation, where a template cannot know every item.

| | Recommendation |
|---|---|
| **Where** | (1) **"Interpretar"**: offered only when the rules intake is unsure. It returns a template slug, fields, and up to 8 extra needs. (2) **"Sugerir o que falta"**: up to 5 suggestions, plus category guesses for lines without a category. (3) **Offline admin drafting** of template rows and aliases, which uses no user data and is reviewed by a human before publishing. |
| **Not used for** | Matching, ranking, prices, availability, the next step, summaries or notifications. Design 3's summary job is dropped. |
| **Model** | `claude-haiku-5-5`, kept in one constant. The work is choosing among enums, so it does not need a larger model. Use `output_config.format` (JSON schema) for structured output, effort `low`, and max_tokens of about 2,000. Do not send `temperature`: Haiku 5.5 rejects non-default values. Haiku 5.5 has no server-side refusal fallback, so a refusal falls back to the rules path. If a 40-goal pt-AO evaluation (run by a human) shows weak quality, `claude-sonnet-5-5` is the upgrade at about 20× the cost. |
| **Cost** | Haiku 5.5 costs $0.10 per million input tokens and $0.50 per million output tokens. One call is about 2.5k tokens in and up to 1k out, so about **$0.001**. A project uses 0–3 calls, so **under $0.003 (a few Kz)**. The global cap of 2,000 calls a day sets a ceiling of about $1.50 a day, roughly $45 a month. Prices come from Anthropic's price sheet as of 3 Nov 2026; re-check them when the feature is switched on. |
| **Guardrails** | - It ships **paused** (`platform_switches.assistant_paused`). The buttons are hidden while it is paused or when the API key is missing.<br>- Per-user limits are 10 calls a day and 3 a minute, enforced through `lib/rate-limit.ts` (`rate_limit_hit` is granted to the service role only).<br>- The global cap is read through a SECURITY DEFINER `assistant_calls_today()`, never as a sum under RLS.<br>- `assistant_runs` can only be inserted and read by its owner, with no update or delete, and stores token counts only.<br>- Output can only be slugs the server passed in. It is validated, stored as `project_suggestions`, and the user accepts each line with a form post. Linked or locked lines are never changed.<br>- Supplier-written text never goes into a prompt. |
| **Privacy** | - **Interpretar** sends only the typed goal (at most 500 characters), with phone numbers, emails and NIF-like numbers masked first.<br>- **Sugerir** sends the template name, number of people, target month, municipality name, and item names with their slugs. It never sends the title, notes, "Para quem" or amounts.<br>- No prompt or response text is stored. Admins see only aggregates (`assistant_usage()`).<br>- A human writes the disclosure line and the Privacidade text that names Anthropic as a processor. Ask Anthropic about zero data retention. |
| **Fallback** | On a timeout (8 s), error, refusal, cap or pause, the button disappears and the user sees "O assistente não conseguiu ajudar desta vez. Escolha um modelo abaixo." Nothing the user typed is lost. CI and e2e run with a stubbed SDK. |

### User flows

**A wedding** (Casamento, 15 Dez 2026, 150 convidados, Talatona, 3 000 000 Kz)
1. Conta → "Os meus projectos" → "Novo projecto" → Festas e eventos → **Casamento**.
2. "Conte-nos mais" has Data do casamento, Convidados, Município and Orçamento, and two Sim/Não questions: "Vai haver cerimónia religiosa?" Sim; "Precisa de transporte para os convidados?" Não. One transaction creates 12 lines.
3. "O seu projecto" shows "Faltam 32 dias · 0 de 12 tratados".
   - **Próximo passo (R3):** "Reservar o salão: só 3 livres a 15 Dez em Talatona."
   - Each row has a chip, for example "DJ · 5 livres a 15 Dez · desde 180 000 Kz". The "Vestido de noiva" line is `offline` and shows "Tratado fora do NGUEZA".
4. "Opções para: Salão" lists 5 cards with chips: "Livre agora a 15 Dez", "Cabe 200 pessoas", "Dentro do seu valor", "Verificado", "4,7 (12)".
   - **Reservar** opens the existing booking form with the date and number of people filled in.
   - If another client takes the slot first, the 23P01 error shows "Esta data acabou de ser reservada", and R9 offers the alternatives.
5. Once the booking is confirmed, the line moves to "Tratado" and the page prompts "Registe quanto pagou". After 15 Dez, "Concluir projecto" links to the review forms.

**Renovating a kitchen** (typed: "quero remodelar a cozinha até Março com 1.500.000 Kz", Viana)
1. The rules intake picks the template **Renovar uma divisão**, the deadline 31 Mar 2027 and the budget of 150 000 000 cêntimos, so no AI is called. Step 2 (`?rascunho=`) is prefilled. It asks "Precisa de canalização nova?", "Mudar a instalação eléctrica?" and "Trocar o pavimento?".
2. The lines run in predecessor order: Demolição → Canalização → Electricidade → Azulejos → Pintura → Móveis de cozinha (`order`) → Electrodomésticos (`order`).
3. **Próximo passo (R6):** "Ninguém de canalização em Viana: pedir orçamento". The quote request is prefilled. Pintura shows "Espera pela electricidade" (R7).
4. If the assistant is on, "Sugerir o que falta" proposes "Exaustor" and "Lava-loiça" as pending suggestions, and each is added only with "Adicionar".

**A Christmas list**
1. Listas → **Lista de Natal**. The date is prefilled to 25 Dez, and each line has a "Para quem" field.
2. In "Adicionar à lista", the user types "bicicleta" and enters "Miguel" under "Para quem". `resolve_need_text` finds one confident category, so the line is added at once. A vaguer word such as "natação" opens "Isto é…?", with "Nenhuma: só um lembrete" as an option.
3. Lines are grouped by person, with a subtotal for each. Product chips read, for example, "Entrega em Talatona · 4 lojas".
4. **"Comprar tudo junto"** shows: "Loja X tem 5 dos 7 itens · entrega 1 500 Kz · total 38 200 Kz". "Pedir encomenda (5 itens)" opens one prefilled order request. The seller confirms and sends payment instructions, and the client pays the seller.
5. **Próximo passo (R2):** "Encomendar até 18 Dez: a Loja Y entrega em 5 dias." A "Lista de desejos" works the same way without a date, and "Feito!" closes it.

---

## 4. Data model at a glance

**Additive** means new tables or columns, safe to add. **Compat** means an old column is kept and derived while readers move. **Rename** means the data and policies are kept.

| Area | Change | Kind |
|---|---|---|
| Guardrails | `providers` guard trigger; REVOKE on `supplier_type`, `concurrency_limit` and `is_demo`; `job_runs` and switches as rows | Additive |
| Taxonomy | `is_assignable`, `assignable_categories` view, `category_links` (cross-listing), inactive vertical rows; `price_units` table with a FK replacing the CHECK | Additive / compat |
| Rows not code | `attribute_definitions`, `attribute_options`, `listing_attribute_values`; `document_requirements`; `category_tips` | Additive; `amenities` scoped as legacy |
| Geography and privacy | `provider_service_areas`; `providers.address_visibility`; location level as rows | Additive |
| Fulfilment | `services.fulfilment_model` and `services.concurrency_limit`; `bookings` gains `quantity`, `quote_offer_id` and `service_location_id` | Additive; `providers.supplier_type` kept as compat |
| Addresses | Erasable `booking_addresses` and `order_addresses` | Additive |
| Products | `products`, `product_variants` (`price_minor` bigint, `stock_state`), `seller_delivery_zones`, `pickup_points`; `variant_stock_level()` definer | Additive |
| Orders | `order_requests`, `order_request_items`, `order_events` (append-only); `order_id` on payments, payment_documents, reviews, reports, support, legal_acceptances and audit, with `num_nonnulls = 1` | Additive |
| Projects | `event_types` → `project_types`; `event_type_needs` → `project_type_needs`; `event_plans` → `projects`; `event_plan_items` → `project_items` | Rename + 308 redirects |
| Projects (new) | `project_type_questions`, `project_answers`, `project_suggestions`, `project_intake_drafts`, `project_item_shortlist`, `category_aliases`, `category_companions`, `demand_signals`, `assistant_runs`; columns `need_id`, `quantity`, `for_whom`, `order_request_id`, `quote_request_id`, `seen_at`; status gains `skipped` | Additive |
| Functions | `service_is_free`, `project_item_matches`, `project_item_candidates`, `resolve_need_text`, `assistant_calls_today`, `assistant_usage`, `record_demand` | Additive, listed in `06_function_grants.sql` |

Generated tsvector columns must not call `unaccent()` directly, because it is not immutable (`0001:25`). Use an immutable wrapper or a column maintained by a trigger. Keep the 0046 caps of 30 active projects and 60 lines.

---

## 5. Revised slice sequence

Every slice is additive, leaves venues behaving exactly as today, and keeps all gates green. Effort is S, M or L.

| # | Slice | What ships | Keeps the site working because | Effort | Waits on |
|---|---|---|---|---|---|
| 51 | Guardrails and doc truth | CI money, OFFSET and enum checks widened; ESLint `Number()` rule plus bigint helpers; budget scripts fail on a non-200 response; SQL fixture helper; fix the `lib/console.ts:94` money bug; provider guard and REVOKE; CLAUDE.md fixes | No behaviour change | S–M | A human reviews the audit query on live rows |
| 52 | Taxonomy and verticals | Assignable view replaces the 5 copies of the predicate; grouped pickers; icons; `category_links`; all verticals seeded inactive; activation toggle | New roots stay hidden | M | Owner: activation order |
| 53 | Price units as rows | `price_units` with FK; one label source | The 4 existing slugs are kept as rows | M | None |
| 54 | Attributes, documents, tips | Attribute tables; `document_requirements` and `/admin/documentos`; `category_tips` | NULL scope keeps today's behaviour | L | Counsel: papers needed per trade |
| 55 | Service areas and address privacy | Areas in search and quote matching together; `address_visibility`; anon grant revoke; JSON-LD gating; `?zona` by path | Venues default to public premises | M | Owner: address default |
| 56 | Fulfilment model per offering (the riskiest slice) | Backfill **before** `bookings_00_set_shape` switches; per-service concurrency; error mapping per constraint | `01_constraint.sql` and `concurrency.sh` unchanged | L | A human applies the live migration |
| 57 | Projects A: foundation | Rename and recreate the guards; fingerprint fix; templates, questions and reconcile; need kinds; rules intake and drafts; "Para quem"; ~15 seeded templates; admin "Pré-visualizar"; redirects | Rows preserved; `/conta/eventos` redirects | L | None |
| 58 | Projects B: matching and guide | `service_is_free`; match and candidate functions; `project-guide.ts`; options page; quote handoff; `demand_signals`; `/admin/cobertura` | Matching timeout still renders the checklist | L | None |
| 59 | Appointments, home services, first new verticals | Service chosen in the booking form; durations; working hours and time-off; `booking_addresses`; neutral copy; "o que oferece" registration step; activate the first verticals | Venue flow untouched | L | Privacidade update for addresses (human) |
| 60 | Search v2 | `?q=` full text and trigram; unit-aware price; category facets; truthful "livres"; zero-result help; `search_documents`; landing pages; 390 px Playwright | Old params and cursors still work | L | None |
| 61 | Quotes generalised | `needed_by`, quantity and unit, fulfilment mode; structured offers; accept → booking via a definer | Legacy `event_date` kept | M | None |
| 62 | Policy engine v2 | Hours-based notice; versioned snapshots; one resolution function | v1 snapshots compute unchanged | M | Humans set default values |
| 63 | Product catalogue and seller delivery | Products, variants, declared stock state; delivery zones and pickup; product pages and cards; products in search; moderation and report intake | No order path yet | L | Counsel: prohibited goods list |
| 64 | Order requests | Order request state machine (seller confirms stock, sends payment instructions, client pays the seller); expiry sweep; `orders_paused`; rate limits; notifications; inboxes; `order_client_contact()` | Behind a switch; bookings untouched | L | **Termos, Privacidade and Devoluções live** |
| 65 | Order trust records | `order_id` anchors; proof upload; seller "Recebido"; client "Recebi"; "Compra verificada"; admin queue and console include orders | Booking policies keep their tests | L | Human seal wording |
| 66 | Returns | `return_requests`; returns policy; refund attestations anchored to the order | Booking attestation unchanged | M | Counsel: returns minimums |
| 67 | Projects C: products in projects | `order` lines linked to order requests; "Comprar tudo junto" (at most 2 sellers); Ideias, aliases and companions; `/admin/sinonimos` | Order lines show "Em breve" until 64 | M | None |
| 68 | Projects D: optional assistant | Haiku "Interpretar" and "Sugerir"; switch; caps; metering; stubbed CI | Ships paused; pages identical without it | M | Privacy text naming the subprocessor; API account; cap set |
| 69 | Hubs | `/conta` puts activity first; "Os meus pedidos"; painel modules by kind; keyset product lists | Plan RLS kept | M | None |
| 70 | Scale and ops | `provider_members`; runbooks; backup and verify-remote checks; counted stock with a database reserve and a race test (if decided) | Full `02_rls.sql` re-assertion | L | None |

---

## 6. Guarantees that must keep holding

| Guarantee | Protected by |
|---|---|
| No venue double-booking | `bookings_no_double_booking`, `tests/sql/01_constraint.sql`, venue race |
| A service never exceeds its concurrency limit | `bookings_enforce_concurrency`, service race (2 of 50 win) |
| Availability reaches anon only as booleans | `resource_is_free`, `service_is_free`, grants allowlist |
| NGUEZA never holds money | Statements only; 0008 payout shapes frozen; no checkout |
| Money is bigint | Catalog check that every `*_minor` column is bigint; ESLint rule |
| No OFFSET | CI grep extended to `lib/` and `app/` |
| Plans are private | No admin clause on any project table; test:db per role |
| AI never writes a list | Pending suggestions accepted by the user's form post |
| Mobile budgets | 180 KB JS and 2.5 s LCP; projects add 0 KB |
| Notifications sent once | Outbox ON CONFLICT target unchanged |

---

## 7. Remaining decisions for the owner

1. **Activation order of verticals and product categories.** *Default:* Eventos now; Casa e Reparações, Beleza and Aulas in slice 59; first products are material para festas and casa e decoração.
2. **Stock tracking.** *Default:* the seller declares stock (em stock / últimas / esgotado / por encomenda) and confirms it on each order. Counted stock with a database reserve waits for slice 70.
3. **Order request time limits.** *Default:* the seller has 48 h to confirm; the client has 48 h to pay before the request expires.
4. **Payment methods shown in instructions.** *Default:* transfer with proof, and cash or TPA on delivery. The seller attests receipt. No card payment ever goes through NGUEZA.
5. **Single seller per order, or a multi-seller cart.** *Default:* single seller. "Comprar tudo junto" creates one request per seller, at most 2.
6. **Moderation of product listings.** *Default:* a new seller's first 3 listings are checked before publishing, and sellers go through the same verification as suppliers.
7. **Cross-list or reparent maquilhagem, fotografia and buffet.** *Default:* cross-list.
8. **Switch the assistant on at all, and its caps.** *Default:* build it paused; switch it on after the privacy text; 10 calls per user per day and 2,000 a day overall.
9. **Address default for home-based providers.** *Default:* show the area only, and reveal the street after acceptance.
10. **Glossary and positioning.** *Default:*
    - "fornecedor" as the umbrella word;
    - reserva / marcação / encomenda / pedido de orçamento;
    - "projecto" (pre-AO90), enforced by a copy lint;
    - 0% commission also applies to products.

---

## 8. What needs a human

- **Legal text, written by counsel or a human (never generated):**
  - Termos: NGUEZA as an intermediary for goods; seller responsibility; direct payment.
  - Privacidade: delivery addresses, recipients, the AI subprocessor, Lei 22/11.
  - A new Devoluções/Trocas page.
  - The prohibited and regulated goods list.
  - Returns minimums and supplier-cancellation duties.
  - Default cancellation values per vertical.
  - "Compra verificada" wording.
  - The AI disclosure line.
  - New newsletter consent text (never applied to existing subscribers).
  - Any change to the footer line "A NGUEZA nunca recebe o seu dinheiro".
- **Counsel and verification:** which documents each trade must hold, and every supplier or seller verification decision.
- **Accounts and secrets:**
  - an Anthropic API account and key, set in Vercel as a server-only environment variable;
  - a monthly spend limit;
  - asking Anthropic about zero data retention.
- **DNS:** moving the sender from `reservas@ngueza.com` to a neutral address means SPF, DKIM and DNS changes.
- **Live data:**
  - a human applies every migration to production, including the rename and the 0046 fingerprint update;
  - a human reviews the audit query before the `providers` guard and before the slice-56 backfill.
- **Evaluation:** before the assistant is switched on or its model changed, a human runs the paid 40-goal pt-AO evaluation.
