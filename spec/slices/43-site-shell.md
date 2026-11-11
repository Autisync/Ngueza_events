# Slice 43 — one site shell, a dashboard you can read, and less grey

**Status:** done.
**Closes:** competitive review R056 (shared app shell) and the rest of R068
(an expired session). It also covers NGUEZA's ask: "better navigation, so
the system does not look so dull".

## What changes

**One header on every public page.**
- The wordmark, then Procurar, Pedir orçamento, Para fornecedores and
  Ajuda. The current section is marked.
- **Signed out:** Entrar and Criar conta.
- **Signed in:** Reservas, a notification bell with the unread count, Painel
  (suppliers) or Admin (admins), and an avatar with the account initial.
- On a phone the links fold into a menu (`<details>`, no JavaScript).
- Server-rendered. The account side streams in a Suspense boundary, so it
  never holds up the first paint, and a signed-out visitor costs no
  database call.
- The admin area keeps its own sidebar. The path comes from `proxy.ts` as
  `x-pathname`.

**One footer** with client, supplier and NGUEZA links, the legal pages and
the line "Pagamentos feitos directamente ao fornecedor. A NGUEZA nunca
recebe o seu dinheiro." It replaces three hand-made footers; each page
keeps its own note. About twenty duplicate "NGUEZA" home links were
removed, while real breadcrumbs ("← Painel", "← A minha conta") stay.

**A supplier dashboard you can read.** The column of identical cards is
now a grid of tiles: Reservas, Fotografias, Pedidos de orçamento,
Avaliações, Cancelamento, A sua página. Each shows the number that matters
(requests waiting, photos, quote requests awaiting an offer, reviews with
no reply) and turns blue when something waits on the supplier. A
"Nesta página" jump bar leads to the settings below.

**Less grey.** When a supplier has no photos (all of them, today), cards
and the supplier page showed a generic image icon on flat blue. They now
show the category's own line drawing on a blue gradient with a soft dot
grid, labelled with the category: lively without pretending to be a photo
of the venue. The home hero got room to breathe under the header.

**An expired session says so.** When `proxy.ts` can't renew a session it
sets a five-minute `ngz_expired` flag, and `/entrar` says "A sua sessão
expirou. Entre novamente para continuar onde estava." instead of asking as
if nothing had happened. Signing in clears it.

## Budgets

The header and footer add no client JavaScript; the JS budget is unchanged
at 176 KB. LCP passes on all three measured pages locally. `/procurar` is
the tightest at 2.36 s, held back by the shared ~145 KB framework baseline
rather than this slice.

## Acceptance

- [x] Every public page has the header and footer; `/admin` has neither.
- [x] The phone menu opens without JavaScript and lists the main and account links.
- [x] Signed-in users see Reservas, the unread count, Painel or Admin by role, and their account.
- [x] Painel tiles show live counts and highlight what is waiting.
- [x] No-photo cards and supplier pages show the category illustration.
- [x] An expired session is explained at sign-in.
- [x] Gates, build, the JS budget and the LCP budget pass.
