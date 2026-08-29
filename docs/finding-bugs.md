# Finding bugs with no database access

Shoal never touches your database. It sees what a user sees: pages, and the
HTTP traffic behind them. The question is what you can still catch from there.
The answer is: most of it.

Every check below needs **zero knowledge of what the app does**. None of them
require the developer to write anything.

## Free, from the traffic alone

| Check | Why it is always a bug |
|---|---|
| any 5xx | a bad request is a 4xx; a 5xx is the server admitting its own fault |
| a 200 that says "error" in the body | success codes on failures hide real breakage |
| a stack trace or SQL string in a response | leaked internals, and usually an unhandled path |
| a request that takes 30 seconds | something is unbounded or blocking |
| a page that renders blank over data that exists | the API and the screen disagree |

## Cross-account

The strongest one for SaaS, and it costs nothing.

Agent A creates something. Agent B, on a completely different account it signed
up for itself, asks for that thing's id. If B gets it, that is a tenant leak.

Because agents make their own accounts, this can run constantly in the
background rather than being a special test somebody remembered to write.

The same shape covers roles: if the app has an admin, try every endpoint an
admin can reach as a normal user, and try every endpoint a normal user needs as
an admin. Both directions are bugs — a locked-out role is as broken as an
over-permitted one.

## Read-back

After every write, go and read it back.

Created an invoice for 500? Open it. Says 50? Bug. Set a delivery address to
Kuala Lumpur? Reload. Says null? Bug.

Enormously effective and needs no idea what the app is for. A silent write
failure leaves no error anywhere and this is the only thing that sees it.

## Do and undo

- Add a thing, delete it. Is the count back where it started?
- Read the same page twice with nothing in between. Same answer?
- Send the same request twice with the same idempotency key. Did it happen once?
- Walk a paged list. Did every row appear exactly once?

Relations between actions, not facts about your data. Free of domain knowledge
by construction.

## Races

The old design needed a database to see these. This one does not.

Fire the same recorded call from several workers at the same instant, then read
the result back. If what the workers were told disagrees with what is actually
there — four payments accepted but only two counted — that is a race, and the
read-back proves it without a single SQL query.

Three shapes are worth generating on purpose:

- **same row** — everyone hits one object. Five people paying one invoice.
- **shared resource** — different objects competing for one scarce thing. Five
  bookings for the last slot. Identical arguments here prove nothing; each
  worker needs a different object.
- **cross action** — two different operations reaching for the same thing. One
  agent closes a date while another books onto it. Repeating a single action
  can never produce this.

## The agent's own memory

The one class only an agent can notice, because it needs to remember what it
did three steps ago and care that the screen now contradicts it.

"I set the quantity to 12 and the confirmation page says 1."

These come out as suspicions in plain English, and go through the same
confirmation gate as everything else.

## Suspicion, then confirmation

The rule that keeps the report trustworthy:

> **Agents do not report bugs. Agents report surprise.**

An agent that sees something odd files "I expected X, got Y" plus the recording.
Nothing reaches the report yet.

Replay then tries to reproduce it from the recording alone, with no model
involved. Reproduces three times out of five? It is a bug, and it ships with a
repro. Never reproduces? Binned quietly, and never mentioned.

This is the entire defence against a report full of confident nonsense, and it
is why the LLM being occasionally wrong does not matter.

## Deduplication

Get this wrong and a 24-hour run produces the same click four thousand times and
a report listing one bug nine hundred times. Nothing else matters if this is
broken.

Three fingerprints, in from the start:

- **action** — method + path shape + which fields were set. Seen it? Score it
  lower next time.
- **screen state** — the structural shape of a page, ignoring content. Been
  here before? Do not re-explore it.
- **finding** — endpoint + check + failure shape. Same one again increments a
  counter; it does not add a row.
