# Shoal

> A shoal is a school of fish. It is also the shallow water a ship runs aground on.

Shoal points a swarm of concurrent actors at a running system, takes soundings
after every wave, and charts what it ran aground on.

It is not a test runner and it is not a fuzzer. Both of those already exist in
the systems here and both are good at what they do. Shoal exists for the class
of defect neither can reach: the one that needs **two people acting at the same
moment**, or **a world that has been running for a while**, and that leaves no
error behind when it happens.

## Why this and not another audit

Reading code misses things for five reasons, and they are not the same reason:

1. An audit reasons about what should happen. It never runs.
2. It is single-threaded. It never sees two things happen at once.
3. It sees fresh state. Real defects live in accumulated data.
4. It shares blind spots with the code — the reviewer and the author believe
   the same wrong thing.
5. Some failures are silent. A 200 and a blank row is not an error.

Shoal attacks 1, 2, 3 and 5. It does **not** fix 4, and it makes 4 worse if you
let it: an invariant extracted from the implementation encodes the
implementation's bugs and then agrees with them for ever. Every sounding in
`src/targets/*/soundings.ts` carries a `because` written from what is true of
the *business*, not of the code. If you cannot write that sentence without
looking at the source, the sounding is not ready.

## How it works

```
reset db from template  →  boot target  →  log in every persona  →  survey
                                                                      │
        ┌─────────────────────────────────────────────────────────────┘
        ▼
   wave: K actors dispatch one action each, simultaneously
        │                                     (with probability `collide`,
        │                                      all K hit the SAME row)
        ▼
   sweep: every sounding runs as SQL. Rows returned are violations.
        │
        ▼
   chart: violations + server faults + the log, shrunk to a minimal repro
```

**Waves, not streams.** Each wave dispatches one action per actor at once and
waits for all of them before sweeping. The requests genuinely overlap, which is
the only way a race is reachable — and every violation is pinned to a wave, so
the shrinker has a unit to remove.

**Collision is forced, not hoped for.** Five actors picking freely from fifteen
actions over a world of forty rows almost never touch the same row in the same
wave, and a swarm that never collides is an expensive way to run a
single-threaded test. So a fraction of waves are *collision waves*: one action,
one target row, every eligible actor at once. That is the generated form of the
races BBF's own suite writes by hand — except a flag can be put on an action
nobody suspects, which is where the next one will be.

## Determinism, honestly

The seed fixes every choice Shoal makes about **what** to do. It has no say in
the order the target's event loop, its connection pool and Postgres serve those
requests in. So:

- Same seed, same actions, **not necessarily the same outcome**.
- `replay` answers *did it reproduce*, not *is it identical*.
- The shrinker asks for N attempts and treats one reproduction as a yes. A race
  that fires one time in five is still a race.

Pretending otherwise would be the more comfortable lie and a useless tool.

## Use

```bash
npm install
npm run shoal -- doctor bbf
```

`doctor` clones the target's database into a template, resets a working copy,
boots the target against it, logs every persona in, and runs the soundings on
the seed data. If anything trips before a voyage has done a thing, the sounding
is wrong or the seed is — fix that first.

```bash
npm run shoal -- run bbf --seed 4471 --waves 60 --collide 0.4
```

```bash
npm run shoal -- run bbf --seed 4471 --minimise --attempts 2
```

```bash
npm run shoal -- replay charts/bbf-4471.json --attempts 5
```

```bash
npm run shoal -- soundings bbf
```

Flags: `--waves` `--collide` `--sound-every` `--attempts` `--verbose`
`--rebuild-template` (re-clone after reseeding the target).

## The database

A voyage never touches the target's own database. Shoal clones `bbfsystem` once
into `bbfsystem_shoal_tpl` and re-creates `bbfsystem_shoal` from that template
before every run — a file copy, about 200ms, and byte-identical every time,
which a reseed is not.

The target is **not** started through its own `npm run dev`. That script passes
`--env-file`, and whether a file value beats an inherited one has moved between
Node versions, so a voyage would occasionally run against the real development
database without saying so. Shoal reads the `.env` itself, overrides
`DATABASE_URL` and `PORT`, and spawns tsx directly. Outbound channels
(OpenRouter, WhatsApp, AutoCount) are blanked in the child environment: a
voyage must never reach a real customer.

Cloning requires no other connection to the source database. Stop the target's
dev server and Prisma Studio before the first `doctor`.

## Proving the instrument

BBF was chosen because two of its races are already found, fixed and committed,
which turns "does this work" into a question with an answer. Each fix was
un-applied against today's code — a cleaner experiment than a worktree, because
it isolates the single change — and a voyage was run on a seed chosen before
anything was touched. Shoal was told nothing about what to look for.

| Fix un-applied | Shoal found | Control with the fix restored |
|---|---|---|
| `b3f6acb` invoice row lock | `paid-matches-payments` **by wave 4** | clean, same seed |
| `9c6e3d2` delivery-day advisory lock | `slot-capacity` — **7 jobs in a window of 4** | clean, same seed |

The payment case: invoice INV2608/2928, total RM 1,300. Two payments landed in
one wave, RM 325 and RM 1,300, **both accepted with a 201**. The payment rows
summed to RM 1,625; `paid_amt` read RM 325. RM 1,300 of a customer's money gone
from the balance with the invoice still on the chase list — the same shape as
the RM600 the fix was written for, and the same 7-in-a-window-of-4 the
overbooking commit measured.

### The run that found nothing, and why it mattered

The first two attempts at the overbooking bug came back clean, and BBF was not
the thing at fault.

**A collision wave gave every actor identical arguments.** For a payment that is
exactly right — five people paying the same invoice is the race. For a booking
it is wrong: five actors scheduling *the same delivery* into a window book one
job, not five. There are two kinds of contention and only one had been built.
`collideVariants` is the second: one contended resource, a different row per
actor.

**Contention is bounded by who can legally reach the action.** Booking is
page-gated to LOGISTICS and MANAGER, so a collision wave mustered two actors
against a capacity of four and could not overbook it however hard it tried.
Personas now declare `instances` — the planner runs four tabs, which is an
ordinary way for a person to work.

**Every scheduling call was a 400 and the log did not say so.** A swarm whose
requests are all being turned away looks identical to a swarm finding nothing.
Log entries now carry the refusal reason, and collision waves aim at recently
created jobs rather than ones another actor has already advanced out of
PLANNING.

A clean run is a claim about the target. Two of these three were claims about
the instrument.

## Findings so far

**`total-equals-lines` — current `main`, not previously known.** Seed 4471,
reproduces 3/3 as a full log and 11/39 once shrunk to its minimum.

`PUT /api/sales-docs/:id` replaces a draft's lines with `deleteMany` followed by
`create` inside a transaction, but unlike the payment path it takes no row lock.
Under READ COMMITTED each concurrent edit deletes only the rows committed and
visible to it, then inserts its own; every edit's rows survive and `total` comes
from whichever transaction committed last.

Four simultaneous edits of one draft quotation left **12 line rows summing to
RM 72,200 on a document whose total said RM 18,050**. All four returned 200.
Nothing was logged and nothing was thrown.

Shrunk from 253 actions to 9 across 2 waves:

```
wave  35  sales-pj   create-invoice    → 201
wave  46  sales-jb   edit-doc-lines    → 200
wave  46  sales-pj   edit-doc-lines    → 200
wave  46  office     edit-doc-lines    → 200
wave  46  manager    edit-doc-lines    → 200
```

Two people editing the same draft at the same moment is an ordinary Tuesday, and
the figure that comes out wrong is the one the customer adds up.

## Adding a target

`src/targets/<name>/` needs three things:

- **`soundings.ts`** — SQL that returns violating rows, each with a `because`
  written from the business. This is the product; everything else is delivery.
- **`actions.ts`** — what an actor can do. Mark `collidable` on anything worth
  pointing several actors at simultaneously.
- **`index.ts`** — personas, database names, port, and a `survey` that reads the
  starting world back off the API. The survey must run as an ungated role; a
  403 during setup looks exactly like an empty system.

Personas are **operational**, not demographic. Role, competence, intent,
environment and tenure change which code runs. "Ahmad, 34, likes coffee" does
not.

## Not yet

- Snapshot immutability (a sent document's customer details must never be
  rewritten) needs Shoal to remember field values across waves, not just query
  the end state.
- Cross-role leakage — actor A receiving actor B's rows — is a driver-level
  sounding, not SQL.
- Fault injection at the boundary: webhooks delivered twice, never, or out of
  order. This is where several production incidents here actually came from.
- Cross-ACTION collisions. Every collision wave is currently one action many
  times. The blackout race — closing a date while somebody books onto it — needs
  two different actions contending for one resource, and BBF's day lock covers
  a case Shoal cannot yet generate.
- A UI driver. Everything above is the API surface; the silent-blank-row class
  needs a browser.
