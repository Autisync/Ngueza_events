# Slice 03 — administering categories and locations

**Status:** done.
**Ownership:** agent + review.

An administrator manages the category and location trees from the
dashboard, at runtime (§44, §43). This is what makes the CLAUDE.md hard
rule concrete: *"categories and locations are self-referencing tables
managed by administrators at runtime"* was true in the schema since
slice 01, but until this slice the only way to act on it was raw SQL.

## A real bug this slice surfaced before it shipped

Building the edit form meant, for the first time, actually testing what
happens when an administrator reparents a node — and reparenting "Eventos"
under its own child ("Salões de festas") **succeeded silently**. The very
next call to `category_descendants()` — which `lib/search.ts` runs on
every search — **never returned**. `categories_not_own_parent` (0003)
only catches the one-level case, `id = parent_id`; a cycle two or three
levels deep sails straight through it.

This was not a hypothetical. It was reproduced directly, confirmed to
hang the exact recursive function search depends on, fixed with a guard
trigger (0020) that walks `category_descendants()`/`location_descendants()`
before allowing a reparent, confirmed the attack now fails cleanly, and
confirmed a legitimate reparent to a genuinely different parent still
works. Deployed to Supabase and re-confirmed live, inside a rolled-back
transaction.

The general lesson, and the reason this shipped as a schema migration
rather than only a UI validation: **a UI check protects the UI.** The
same reparent is reachable through the RLS policy directly, by an
admin's own script, or by a future feature nobody has written yet. The
guard belongs where every path to the data goes through it.

## Deactivation, not deletion

There is no delete button anywhere in this slice. A category or location
referenced by a provider or a service is protected by `ON DELETE
RESTRICT` — offering delete and then showing a raw foreign-key error is a
worse experience than never offering it. `is_active` does the real job:
it disappears from every dropdown a supplier or client would pick a *new*
category or location from. It does not touch anyone already using it —
confirmed directly, since `lib/search.ts`'s join carries no `is_active`
predicate at all, deliberately. A provider's listing looks exactly the
same the day after its category is deactivated as the day before.

## Verified

`tests/integration/taxonomy.test.ts` (12): creation, duplicate-slug
rejection with a readable reason rather than a raw `23505`, the cycle
guard on both trees, provider counts, deactivation leaving existing
listings untouched, and RLS refusing a non-administrator.

Walked by hand against the running app, with JavaScript disabled: signed
in as an administrator, created a category ("Limpeza" — exactly the kind
of category §44's closing note imagines NGUEZA adding one day), hit the
duplicate-slug error, attempted the cycle attack through the real edit
form and watched it fail with the Portuguese error message instead of
hanging the server, created and deactivated a province, and confirmed a
signed-in client is bounced from both admin pages.

## Not in this slice

Bulk import of a full administrative division dataset for Angola — the
eighteen provinces and their municípios are seeded once (`seed/reference/
00_taxonomy.sql`) and grow by hand from here, which is appropriate at
launch scale and revisited if `/admin/localizacoes` ever needs to hold
hundreds of rows at a sitting.
