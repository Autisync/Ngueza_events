# Slice 45 — amenities per space, and a filter for them

**Status:** done.
**Closes:** the rest of competitive review R001: amenity facets in search.
Guest count, budget, truthful capacity and the past-date fix shipped in
#31 and #49.

## Model (0043)

**`amenities`** is a list of rows managed by administrators, never an enum.
- Columns: slug, pt-AO name, sort order, `is_active`.
- It starts with nine: Gerador, Ar condicionado, Coberto, Ao ar livre,
  Estacionamento, Cozinha, Catering externo permitido, Som e luz, Acesso
  para cadeira de rodas.
- A cleaning or transport marketplace would need a different list; that is
  why it's data.

**`resource_amenities`** links an amenity to a space (`resources`), not to a
supplier.
- A quinta's jardim is "ao ar livre"; its salão is "coberto, ar
  condicionado".
- Search has to say which space matched, so this can't be per supplier.

**RLS:**
- Anyone reads active amenities; admins also see retired ones and write the
  list.
- A space's amenities are readable exactly when its supplier is public
  (`provider_is_public`), plus by the owner and admins.
- Only the owner (or an admin) ticks and unticks, and only active amenities.
  Rows are never updated, only inserted or deleted.
- Visitors write nothing.

## What changes

**Painel → Espaços.**
- Each space has "O que este espaço tem": checkbox chips, saved together
  with the name and capacity. A new space can be given them at creation.
- A save replaces the set exactly.
- Ids that are unknown, retired, or belong to another supplier's space are
  ignored.

**Supplier page.**
- Each space's chips sit under its name, above its calendar.
- Retired amenities disappear.

**Search (`/procurar`, "Mais filtros").**
- "O espaço tem" offers only amenities that at least one public space has.
  This is the same rule as categories in slice 42, so it's never a dead-end
  filter, and it answers the review's "wait until a zone has enough venues"
  concern automatically.
- The URL is a repeated `?comodidade=gerador&comodidade=estacionamento`.
  Only known slugs survive.
- **Match rule:** the **same space** must have every amenity asked for, and
  also meet the capacity. A jardim with parking plus a salão with a
  generator is not "gerador + estacionamento".
- Service suppliers have no spaces, so asking for an amenity leaves them
  out.
- A retired amenity is no constraint.
- The count line says "· com gerador, estacionamento". Amenity choices are
  recorded with the search event, as recruitment evidence.

**Admin → Comodidades.**
- Rename, reorder, retire and reactivate, with a count of spaces for each.
- Create new ones; the slug is fixed after creation, because it's in search
  URLs.
- The admin stylesheet never defined `.submit`, `.field`, `.label`, `.two`,
  `.select`, `.inline` or `.state`, so the Categorias and Localizações
  forms rendered with browser defaults. They're defined now.

**Example catalogue.** Example spaces get the amenities their own
descriptions mention. The removal script clears them through the cascade.

## Acceptance criteria

- [x] RLS: a visitor sees only public spaces' amenities and only active
      amenities; visitors and suppliers can't create amenities; one supplier
      can't tick or untick another's; a retired amenity can't be ticked;
      admins manage the list (`tests/sql/07_amenities.sql`).
- [x] Profile shows each space's own amenities, in the admin's order.
- [x] Search: one amenity matches; two amenities on different spaces of
      one supplier don't; combined with capacity on the same space.
- [x] Only amenities in use are offered; a retired one disappears from
      profile, filter and constraint.
- [x] Save replaces the set; another owner's save is ignored.
- [x] Checked at 390px: filter chips, profile chips, painel checkboxes
      saving; admin page on desktop.
- [x] `npm run gates` green.
