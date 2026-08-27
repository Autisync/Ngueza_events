# spec/

The contract. Written by hand, once. Everything else is derived from it.

| File | Role |
|---|---|
| `schema.sql` | **Generated.** Flattened migrations, for reading. Never edit. |
| `states.md` | The booking state machine: states, transitions, who may trigger each. |
| `slices/` | One file per unit of work. |

## Anatomy of a slice

Every slice file carries: a user story, the tables it touches, the routes it
adds, and **acceptance criteria written as statements a test can assert**.

That last part is the whole point. "The calendar should work" is not a
criterion. "A client selecting a date already confirmed sees «Data
indisponível» and no booking row is created" is.

If a slice cannot pass its own acceptance criteria, the spec was too vague.
Fix the spec file, not the prompt.
