# Product

## Register

product

Primary register is product — the majority of the surface (admin dashboards, the provider/painel panel, booking flows, auth) is workflow-driven, and design there serves the task rather than performing a brand. The public homepage (`/` only — `/procurar` is a filtered results page, task-driven like the rest of the product register, not a brand surface) is the one place brand-level polish is explicitly in scope too: it's simultaneously the front door (hero, trust strip, category rail) and a business display (a "Fornecedores verificados" section rendering real, live, verified suppliers via the same `SupplierCard` component `/procurar` uses, not curated placeholders). It earns more visual ambition than a settings screen, without tipping into a marketing-campaign register the rest of the product doesn't share.

## Users

Two groups, both in Luanda, Angola:

- **Clients** — people planning an event (wedding, corporate function, birthday), searching for a venue or service by category, zone, and date.
- **Suppliers** — venue and service providers (salões, casas de festas, DJs, fotógrafos, decoradores, etc.) registering their business, managing verification documents, pricing, spaces, and bookings.

Binding constraint: most users are on mobile, on mobile data they pay for. This isn't a soft preference — it's a hard product requirement (180KB route JS budget, LCP under 2.5s on throttled 3G, CI fails the build on either). Every design decision is weighed against that budget before anything else.

## Product Purpose

NGUEZA answers one question truthfully: *"Salão de festas em Talatona disponível para dia 15 de Dezembro?"* — a place, a date, a capacity, a price, and an honest answer about availability. It launches with venues in Luanda and is architected to expand into a general services marketplace (cleaning, plumbing, tutoring, transport) without a rewrite, which is why categories and locations are administered database rows, not hardcoded enums.

Success looks like: a client finds a real, verified, available option without a wasted trip; a supplier gets discovered and booked without a commission cut (0% commission is a stated trust signal, not a temporary promo).

## Brand Personality

**Trustworthy, direct, local.**

- Truthful over persuasive — availability, verification status, and pricing are claims the product can back up with data (a verified badge means an admin actually checked; "sob consulta" pricing is disclosed, not hidden behind a fake number).
- Direct — pt-PT/Angola copy that says what's true plainly, no hype language, no invented urgency.
- Local — this is built for Luanda specifically (municípios as real taxonomy, AOA/Kwanza formatting, `Africa/Luanda` timestamps), not a generic template with the city name swapped in.

No specific anti-reference flagged yet — if one comes up (a competitor or pattern to explicitly avoid), add it here.

## Anti-references

None specified yet. Avoid the generic SaaS-marketplace look by default: no invented urgency ("only 2 left!"), no unverifiable trust badges, no stock-photo hero treatment standing in for real supplier photography.

## Design Principles

1. **Never claim more than the data backs up.** A "Verificado" badge, a price, an availability slot — each is only shown because the database can prove it, not because it looks more finished. RLS and the exclusion constraint that prevents double-booking exist so the UI is never allowed to lie by accident.
2. **The budget is a design constraint, not an engineering afterthought.** 180KB JS and a 2.5s LCP ceiling shape every choice — this is why tonight's admin sidebar and form reveals are CSS-only (checkbox-driven), not JavaScript components.
3. **Progressive enhancement, always.** Every interactive pattern (the waitlist's "Outro" reveal, the admin sidebar, form submission) works with JavaScript disabled first, then gets enhanced. Mobile users on unreliable connections are the default case, not the edge case.
4. **One visual language across every surface.** Admin, provider panel, client account, and booking pages share one card/pill/button/motion system (established across slices 26-27) rather than each screen inventing its own — consistency reads as competence to a returning user.
5. **Categories and locations are data, not code.** Anything that would hardcode a category or a município is a shortcut against the product's own reason for existing — the same discipline should extend to how the UI presents them (admin-editable, never a fixed enum-shaped dropdown baked into a component).

## Accessibility & Inclusion

No formal WCAG conformance target set. Keep the current baseline: reduced-motion alternatives on every decorative animation (already implemented via `prefers-reduced-motion` guards), semantic HTML, keyboard-reachable forms, and functional parity with JavaScript disabled. Revisit if a formal target becomes a requirement.
