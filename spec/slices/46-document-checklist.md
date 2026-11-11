# Slice 46 — the verification document checklist

**Status:** done.
**Closes:** the open part of competitive review R035 (the document
checklist), on top of resubmission, the `submitted_at` clock and the faster
queue from #31 and #30.

The decision stays a person's (CLAUDE.md, "Never automate": supplier
verification). This slice makes the facts visible to both sides and puts a
floor under the decision. It does not make the decision.

## Model (0044)

**`document_kinds`** is a list of rows, replacing the fixed check constraint
on `provider_documents.kind`, which is now a foreign key. Which papers
NGUEZA asks for is policy and can change without a deploy.

| slug | name | required for |
|---|---|---|
| `identity` | Documento de identificação do responsável | all |
| `nif` | NIF | all |
| `commercial_registration` | Alvará ou certidão comercial | venues |
| `space_rights` | Prova do direito de uso do espaço (new) | venues |
| `proof_of_address` | Comprovativo de morada | optional |
| `other` | Outro documento | optional |

> Requiring the alvará only of venues is a starting assumption: many service
> suppliers in Angola work informally. Change `required_for` per row (SQL
> for now) if NGUEZA decides otherwise.

**The floor.** `providers_guard_verification` refuses `→ verified` unless at
least one of the supplier's documents is `accepted`.
- This applies even to administrators (23514). The admin page shows a
  message instead of an error.
- Reinstating a suspended supplier is exempt, because they were verified
  before.

## What changes

**Painel → Estado e documentos.** A checklist, one line per required paper
(plus optional ones that were sent):
- **Aceite**
- **Em análise**
- **Rejeitado**, with the reviewer's note and "Corrija e envie de novo",
  plus an "Enviar outro" link
- **Em falta**, with a hint of what counts, plus an "Enviar" link

The links preselect that kind in the upload form (`?tipo=`); otherwise the
first missing kind is preselected.

**Withdrawing a mistaken upload.** "Ficheiros enviados" lists every file.
One still waiting for review can be withdrawn ("Retirar"): the row and the
stored object are deleted. A decided one can't; the policy refuses, so the
record of the decision stays.

**Submitting.** Submitting for verification (or resubmitting after a
rejection) needs every required kind sent. Until then the button is replaced
by "Para submeter, falta enviar: …", and the action checks too.

**Admin → fornecedor.**
- The documents card opens with the same checklist as pills: what is
  accepted, waiting, rejected or missing.
- Document names no longer run into their filenames.
- "Verificar e publicar":
  - lists required papers not yet accepted, without blocking;
  - is replaced by an explanation when nothing is accepted.
- "Rejeitar" is offered only for a pending supplier (a live one is
  suspended, not rejected). It is now two steps: open "Rejeitar…", pick a
  reason (radio) or write one, then "Confirmar rejeição". A canned reason
  no longer submits in one tap.
- "Suspender…" is two steps too, and says what happens.

**Upload route.** Kinds are checked against the active list instead of a
hard-coded enum.

## Acceptance criteria

- [x] Checklist rules (unit): per type, optional kinds only when sent,
      accepted beats a later rejection, waiting beats an older rejection,
      latest rejection's note, outstanding vs not yet accepted.
- [x] A venue is asked for four papers; owner and admin see the same facts;
      a client sees nothing (integration).
- [x] Withdraw: only one's own, only while waiting (integration).
- [x] An unknown kind is refused by the foreign key (integration).
- [x] Verifying with no accepted document is refused, even for an admin;
      it succeeds once one is accepted (integration).
- [x] Checked at 390px (painel checklist, preselect, withdraw) and on
      desktop (admin checklist, two-step reject).
- [x] `npm run gates` green.
