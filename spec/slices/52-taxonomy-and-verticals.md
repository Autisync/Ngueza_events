# Slice 52 — taxonomy and verticals

**Status:** done.
**Part of:** the marketplace pivot (`spec/pivot/plan.md`, slice 52 of 51–70).
**Changes for visitors, clients and suppliers:** none until an
administrator opens a second vertical. Then:
- category lists are grouped by vertical;
- a make-up artist is found under Beleza as well as Eventos.

NGUEZA's categories were always rows, but the code around them assumed a
single vertical. This slice makes the tree carry several verticals,
seeded closed, which an administrator opens one at a time.

## 1. One definition of "a category you can pick" (0049)

Five files each decided what was pickable with `parent_id is not null`, a
sixth (registration) accepted any active category, and nothing in the
database checked services or quote requests at all. Now:

| Object | What it is |
|---|---|
| `categories.is_assignable` | False for a heading that only groups others. A root becomes a heading by itself when it gets its first child (`categories_root_heading`, which fires only on a real change of parent); an administrator can change it on the edit form. |
| `category_paths` (view) | Every category whose **whole ancestry** is active, with its root (vertical), depth, sort path and resolved icon. RLS alone looks only at a row's own flag, so it would show an active leaf under a closed vertical. |
| `assignable_categories` (view) | `category_paths` where `is_assignable`. Every picker and every guard reads it. |

Both views are `security_invoker`, so they apply the caller's RLS. 0048 and
the new catalogue rule exist because a plain view does not.

The guards, all INVOKER and all skipped for administrators and the system:

| Table | Refuses | Constraint (23514) |
|---|---|---|
| `providers` (0047, redefined) | a new listing, or a change of category, outside `assignable_categories` | `providers_category_active` |
| `services` (new) | the same; an unchanged category passes, so a service whose category was retired later can still be edited | `services_category_active` |
| `quote_requests` (new) | a category outside `category_paths`. A whole open vertical is allowed ("anything in Casa e Reparações"). | `quote_requests_category_active` |

The app maps each one to a message. `createProvider` reads
`assignable_categories` directly and returns `category_unavailable`.

## 2. Cross-listing

`category_links(category_id, also_under_id)` lists a category under a second
parent without moving it. Moving maquilhagem out of Eventos would have
dropped it from every Eventos search and quote request (0028).

- **`category_scope(root)`:** the root's active subtree plus everything
  linked under any node of it, followed transitively. It uses `UNION`, so a
  loop of links ends. Search, `quote_request_open_and_matches`, the
  supplier read policy, the quote fan-out and the supply counts all use it.
  `category_descendants` stays parent-only, because the 0020 cycle guard
  depends on it.
- **The guard:** a link refuses to point a category into its own subtree, or
  to a category it already sits under (`category_links_redundant`).
- **RLS:** only administrators write links. A link is visible only when both
  of its ends are.
- **In passing:** the quote fan-out no longer emails example listings
  (0041 already kept them from answering).

## 3. Pickers

`lib/categories.ts` provides `assignableCategories`, `openCategories`,
`categoriesWithSupply`, `groupByRoot` and `resolveCategory`.
`app/CategoryOptions.tsx` renders one `<optgroup>` per vertical, with no
client JavaScript. Changes per page:

- **Homepage:** the search box lists every assignable category, where it
  used to stop at the first 8. The rail shows the first 8 in vertical order.
- **`/procurar`:**
  - The picker lists categories with supply anywhere in their scope,
    headings included. It offers "Tudo em <vertical>" once there is more
    than one vertical.
  - `?categoria=` now resolves against every open category. A link to an
    empty one keeps its filter, and the search is recorded with it. Before,
    the filter was silently dropped, along with the recruitment signal.
  - The hard-coded "Espaços / Serviços" groups dropped `either` categories;
    they are gone.
- **Waitlist:** every open category, grouped by vertical. The venue-only
  filter is gone.
- **Painel profile, service form and admin need editor:** these keep a
  current category that is no longer offered, as a selected option. Before,
  the browser silently picked the first option, so saving a phone number
  could move a listing to "Salões de festas".
- **Registration, quote request and planner:** grouped options.

## 4. Icons

`categories.icon` is a key, never markup: a CHECK in the database plus the
same regex in zod. `app/CategoryIcon.tsx` draws 46 keys in the same blue
line style. A category without its own icon uses its nearest ancestor's
(`category_paths.resolved_icon`, `category_icon()`). The 14 event slugs keep
their drawings even where the seed has not run. Icons stay server-rendered,
so they cost HTML bytes and no route JS.

## 5. Administering verticals

- **`/admin/categorias`:** one card per vertical, with "Abrir vertical" or
  "Fechar vertical", which applies to the root and everything under it in
  one transaction.
- **Edit page:**
  - an icon picker with "Herdar da categoria-mãe";
  - the "may be picked" checkbox;
  - "Também aparece em", which adds and removes links;
  - a note when changing the type of a category in use.
- **Switching off.** The old copy, comment and test said that switching a
  category off leaves its published listings visible. That was false:
  visitors read categories under RLS, and search, the profile page and the
  quote inboxes inner-join them, so the listings vanish and their pages
  return 404. Switching a category or a vertical off is now refused while
  any listing, active service or open request uses it, and the page says
  how many. Switching a leaf on under a closed parent is refused too.
- **New verticals start closed.** A category created at the top level
  starts closed, and opens only through "Abrir vertical". A category
  created under an existing parent is visible exactly when its vertical is.
- **Audit:** recorded in the audit log:
  - creating a category;
  - every change to its `is_active`, `is_assignable`, parent, type, slug
    or name;
  - adding or removing a link.
- **Concurrency:** switching off locks providers, services and requests
  for the moment of the check, so a listing created at the same instant
  cannot land in a category that is closing.
- **Error routing:** errors on the edit page return to that page, which
  makes its own messages reachable. They used to be dead code.

## 6. The verticals (`seed/reference/02_verticals.sql`)

**Seven verticals, all closed:**
- Casa e Reparações
- Beleza e Bem-estar
- Aulas e Explicações
- Transporte e Mudanças
- Auto
- Comida e Catering
- Tecnologia e Profissionais

**What else the seed adds:**
- 35 first categories, all `service`;
- links for maquilhagem (Beleza), buffet (Comida), and fotografia and vídeo
  (Tecnologia);
- icons on the 15 event rows, only where none is set.

**Rules it follows:**
- re-runnable with `on conflict do nothing`;
- the links and the icon backfill run only on the run that adds the
  verticals, so a re-run never restores a link an administrator removed,
  and never fails because one was moved;
- parents found by slug;
- event slugs untouched.

**Not before a restore.** `docs/backup-restore.md` no longer seeds before
a data restore. The dump carries the reference rows as they were, and
seeding first would close every vertical that had been opened.

**Products are not seeded.** `default_supplier_type` has no `product` value
until slice 56. A seller under a `service` category would get a bookable
calendar, and a wrong value seeded now could not be fixed by re-seeding.
They come with slice 63. This departs from decision 3 ("every vertical")
and is listed for the owner.

## Rollout (a person, on live)

1. Apply migrations 0047, 0048 and 0049 (`apply-migrations-from.sh 0047`;
   run 0047's audit first, see slice 51).
2. Check that none of the new slugs already exists on live. A clash is
   skipped silently.
   ```
   psql "$DATABASE_URL" -c "select slug from categories where slug in ('casa-e-reparacoes','beleza-e-bem-estar','aulas-e-explicacoes','transporte-e-mudancas','auto','comida-e-catering','tecnologia-e-profissionais','limpeza','canalizacao','catering','mecanica')"
   ```
3. `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f seed/reference/02_verticals.sql`
4. Nothing changes for visitors until an administrator opens a vertical.

## Review

An adversarial review (three reviewers, each finding checked by a
skeptic) confirmed 10 findings. All are fixed in this slice:

1. The heading trigger fired on edits that did not move a child.
2. Created categories were not audited, and nor were links.
3. A pickable root with children was never rendered in pickers.
4. `?categoria=<vertical>` filtered while the select read "Todas".
5. There was a race between the in-use check and closing.
6. The search page's supply query read every listing on each view.
7. Re-running the seed after an admin move aborted.
8. Re-running the seed restored removed links.
9. Re-running the seed reset icons set to "inherit".
10. The restore procedure seeded before loading data.

## Not in this slice

- **Reading inactive categories in search and the profile page.** A
  listing in a retired category still disappears. The toggle now refuses to
  do that, instead of hiding it.
- **The other drift found while mapping:**
  - the supplier read policy still lacks the expiry and example checks that
    `quote_request_open_and_matches` has;
  - search's provider-or-service `OR` still defeats its indexes. That is
    fine at today's size; a `providers_in_category()` rewrite is noted for
    search v2 (slice 60).
- **Category landing pages, facets, and supply counts on the rail:** slice 60.
- **The owner's decisions:** which vertical opens first, and the optional
  cross-listings (bolos and wedding cars under Eventos, bridal hair).

## Acceptance

- [x] One definition of "pickable" (`assignable_categories`); no `parent_id is not null` left in `app/` or `lib/`.
- [x] A visitor sees only categories whose whole ancestry is active; headings are never pickable (`tests/sql/11_taxonomy_scope.sql`).
- [x] Listings, services and requests cannot name a heading, a retired category or a closed vertical, even by a hand-made POST; the forms say why.
- [x] A category linked under a second vertical is found by search, matched by quote requests (function, policy and notification) and counted as supply there; a loop of links terminates.
- [x] Only administrators write links; links into a closed vertical are invisible to visitors.
- [x] Pickers are grouped by vertical; a select whose current category is no longer offered keeps it.
- [x] `/procurar?categoria=` resolves any open category, a vertical included.
- [x] Icons render from `categories.icon` with nearest-ancestor fallback; an icon is a key, never markup.
- [x] An administrator opens or closes a vertical as a whole; switching off anything in use is refused; both are audited.
- [x] `02_verticals.sql` seeds every non-product vertical closed and is re-runnable.
- [x] Gates pass; `spec/schema.sql` in sync; screens checked by hand at 390px (no e2e suite exists).
