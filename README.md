# Shoal

> A shoal is a school of fish. It is also the shallow water a ship runs aground on.

Shoal points a swarm of concurrent actors at a running system, takes soundings
after every wave, and charts what it ran aground on.

It is not a test runner and it is not a fuzzer. Both of those probably already
exist in your project and both are good at what they do. Shoal exists for the
class of defect neither can reach: the one that needs **two people acting at the
same moment**, or **a world that has been running for a while**, and that leaves
no error behind when it happens.

Point it at any Postgres-backed HTTP API. Describing your system is one
directory; nothing in `src/` knows about it.

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
implementation's bugs and then agrees with them for ever. Every sounding carries
a `because` written from what is true of the *business*, not of the code. If you
cannot write that sentence without looking at the source, the sounding is not
ready.

## What is in the box

```
src/core/        the engine — waves, collisions, seasoning, sweeps, starvation
src/soundings/   checks that hold for ANY system, parameterised
src/triage/      replay, delta-debugging shrinker, charts
src/target/      what you implement
targets/example/ a worked example to copy
```

The split that matters is between two kinds of rule.

**Rules from the business.** "Payments sum to the figure on the invoice." "No
delivery window holds more jobs than it has capacity for." Nobody can write
these for you, they are where nearly all the value is, and they go in your
target.

**Rules from the shape of a system.** "Walking a paged list sees every row
exactly once." "A role reaches exactly the routes it was granted." These are
the same everywhere, so they ship as configurable builders. A new target gets a
real instrument on day one, before a single domain rule exists.

## The generic soundings

| Builder | Catches |
|---|---|
| `pagingIsStable` | ORDER BY a non-unique column with OFFSET: a row on two pages, another on none |
| `listingMatchesCount` | a list quietly showing fewer rows than the table holds |
| `roleGating` | a route answered for a role never granted it — and a role locked out of its own job |
| `frozenAfter` | fields that must stop changing once a row is issued, rewritten later |
| `noOrphanedRows` | references to parents that are not there, read from the FK catalogue |
| `screenAgreesWithTheDatabase` | a page that renders blank over a table full of rows |

Plus one the engine does for free: any 5xx is a server fault, because a wrong
request is a 4xx and anything else is the server admitting fault.

`noOrphanedRows` is vacuous where the database enforces its own keys, and says
so — it earns its place on `relationMode = "prisma"`, PlanetScale, sharded
schemas, and anywhere a migration dropped a constraint nobody replaced.

## How it works

```
reset db from template  →  boot target  →  log in every persona  →  survey
                                                                      │
        ┌─────────────────────────────────────────────────────────────┘
        ▼
   seasoning: N waves of building only. No collisions, no sweeps.
        │      Documents backdated across months, lists grown past one page.
        ▼
   wave: K actors dispatch one action each, simultaneously
        │                                     (with probability `collide`,
        │                                      they contend for one thing)
        ▼
   sweep: SQL soundings on the state, probe soundings on the answers
        │
        ▼
   browser: once, at the end, if asked — every page loaded as a real user
        │
        ▼
   chart: violations + server faults + the log, shrunk to a minimal repro
```

**Seasoning.** A voyage that starts on the seed and runs eighty waves only ever
sees a system with a few dozen rows in it, and one of the five things an audit
is blind to is that real defects live in accumulated data. Seasoning waves run
first, weighted to build rather than to probe, with a third of documents dated
into the past. Two of the four findings so far were unreachable without it: one
needs more than one page of invoices, and it needs them to share dates.

**Two kinds of sounding.** A SQL sounding reads the state the system ended in.
A PROBE sounding asks the system questions and checks the answers against each
other, against the database, and against what it saw last sweep. That second
kind is the only way to reach what the database is right about and the API is
wrong about — a list quietly returning less than it holds, a document that will
not print, a role reading a page it was never granted, a frozen field that
moved. A 200 with an empty body is not an error and leaves no trace in any
table.

**Waves, not streams.** Each wave dispatches one action per actor at once and
waits for all of them before sweeping. The requests genuinely overlap, which is
the only way a race is reachable — and every violation is pinned to a wave, so
the shrinker has a unit to remove.

**A swarm that is being refused is not a swarm that found nothing.** Every
action's success rate is tracked, and anything tried five times without once
succeeding is reported as STARVED, above the verdict. This is not a nicety: it
has caught four false clean runs on one target, including a voyage in which no
delivery was scheduled at all and every delivery sounding still read green.

**Collision is forced, not hoped for.** Five actors picking freely from fifteen
actions over a world of forty rows almost never touch the same row in the same
wave, and a swarm that never collides is an expensive way to run a
single-threaded test. So a fraction of waves are *collision waves*: one action,
one target row, every eligible actor at once. That is the generated form of the
races BBF's own suite writes by hand — except a flag can be put on an action
nobody suspects, which is where the next one will be.

Collisions come in three shapes, and only the first is obvious. SAME-ROW is
five people paying one invoice. SHARED-RESOURCE is five different jobs
competing for the last place in one delivery window — identical arguments there
book one job five times, which is not a race at all. CROSS-ACTION is two
different operations reaching for the same thing: closing a delivery date while
somebody books onto it, which no amount of repeating a single action can
generate.

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
```

Tell Shoal where the target is and how to log in. Paths are machine-specific and
credentials are secret, so neither belongs in source — a password committed to a
repository does not become secret again when the visibility changes back.

```bash
cp shoal.local.example.json shoal.local.json
```

```json
{
  "example": {
    "root": "/absolute/path/to/the/target/backend",
    "webRoot": "/absolute/path/to/the/target/frontend",
    "password": "the shared password the target's seed sets on its accounts",
    "emailDomain": "example.com"
  }
}
```

Everything except `root` is whatever your target asks for; Shoal does not
inspect it. `shoal.local.json` is gitignored and has no fallback — a built-in
default would put the password back in the source and make the exercise
decorative.

```bash
npm run shoal -- doctor example
```

`doctor` clones the target's database into a template, resets a working copy,
boots the target against it, logs every persona in, and runs the soundings on
the seed data. If anything trips before a voyage has done a thing, the sounding
is wrong or the seed is — fix that first.

```bash
npm run shoal -- run example --seed 4471 --waves 70 --season 30
```

```bash
npm run shoal -- run example --seed 4471 --minimise --attempts 2
```

```bash
npm run shoal -- replay charts/example-4471.json --attempts 5
```

```bash
npm run shoal -- soundings example
```

A target is found at `targets/<name>/index.ts`, or anywhere via
`--target ./path/to/index.ts`. Keep yours beside the system it describes rather
than here.

Flags: `--waves` `--season` `--collide` `--sound-every` `--attempts` `--verbose`
`--target` `--rebuild-template` (re-clone after reseeding) `--ui` (drive the
frontend in a real browser at the end) `--rebuild-ui` (force a frontend build).

## Writing a target

Copy `targets/example/index.ts`. It is a complete, commented example of an
imaginary ordering system and does not run against anything — it is there for
the shape and the reasoning.

A target exports one factory, which receives its entry from
`shoal.local.json`:

```ts
export default defineTarget<MyWorld>((cfg) => ({
  name: 'myapp',
  root: cfg.root,
  password: required(cfg, 'password'),
  sourceDb: 'myapp', workDb: 'myapp_shoal', templateDb: 'myapp_shoal_tpl',
  port: 3920,
  requiresWorld: ['customers'],
  personas, actions, soundings,
  survey,
}))
```

Four things to get right, in the order they will bite you:

1. **`survey` must run as an ungated role.** A 403 during setup looks exactly
   like an empty system, and a swarm that cannot see anything finds nothing
   while reporting clear water.
2. **`requiresWorld` names the collections a voyage cannot sail without**, so an
   empty world is refused rather than reported as calm.
3. **`collidable` versus `collideVariants`.** The first points every actor at
   the same row — five people paying one invoice, which IS the race. The second
   is for a scarce shared resource, where each actor needs a DIFFERENT row
   competing for one thing; identical arguments there book one job five times
   and prove nothing.
4. **Every `because` comes from the business.** If you cannot write that
   sentence without reading the source, the sounding is not ready.

Personas are **operational**, not demographic. Role, competence, intent,
environment and tenure change which code runs. "Ahmad, 34, likes coffee" does
not. `instances` runs one login as several simultaneous sessions, because
contention is bounded by how many actors can legally reach an action.

## The database

A voyage never touches the target's own database. Shoal reads the target's
`DATABASE_URL` out of its `.env`, clones that database once into a template, and
re-creates a working copy from the template before every run — a file copy, about 200ms, and byte-identical every time,
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

## Case study: proving the instrument

Everything below happened on one private system, which is not in this
repository. It is kept because how an instrument was calibrated is the only
reason to trust what it reports.

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

### Four more of the same, caught by the guard rather than by luck

Adding cross-action collisions produced an 80-wave voyage in which **not one
delivery was ever scheduled**. A blackout landed on wave 0, closed one of only
three bookable dates, and the rest followed; every delivery sounding read green
over a half of the system that had been dead since the start. Blackouts now
consume dates from a separate pool that nothing books into.

The starvation guard, added in response, immediately found three more:
`create-customer` had been posting `name` where the route wants `companyName`
and was refused every time; `convert-quotation` was refused 27 times out of 27
because nothing ever reached ACCEPTED; and the reason nothing did was that
documents were being drawn uniformly, so each of twenty got picked well under
twice in a voyage and none walked DRAFT → SENT → ACCEPTED.

Every one of those looked exactly like a passing test.

## The second target, and what it cost

An abstraction with one implementation is a guess. Pointing Shoal at a second,
unrelated system — a different domain, a different codebase generation, a
different schema convention — found **six** things that had been written for the
first one and looked general:

| What broke | Was | Is |
|---|---|---|
| Login | hardcoded `/api/auth/login` returning `{ token }` | `auth.path` and `auth.token(body)` |
| Health check | hardcoded `/api/health` | `healthPath` |
| The surveyor | searched for a persona whose role was literally `MANAGER` | `surveyAs`, by name |
| Logins | one per SESSION, so four tabs burned four | one per PERSONA, plus backoff on 429 |
| Rate limits | assumed absent; a swarm was 429s and read as starvation | `--pace`, and 429 counted and reported separately |
| Refusal messages | read `body.error` only | `body.error ?? body.message` |

Two more were plain bugs the second target simply reached first: a failure
between boot and login leaked the booted process, so the next run found its port
held by a server pointed at a dropped database; and a target's own environment
could not be set, which a Redis-backed rate limiter made necessary.

None of that was visible from one system. All of it looked like design.

### What it found there

The same instrument, on a system it had never seen, using soundings written from
that business rather than from either codebase:

**Four concurrent payments of RM 3,602 against one invoice, all four returning
200.** The payment rows summed to RM 21,612; the invoice's paid figure read
RM 10,806 — exactly half, and RM 10,806 of a client's money missing from the
balance. The handler re-derives the total as a SUM, which is right, and takes no
row lock, which is not. It is the same defect as the one the first target had
already fixed, in a codebase that shares no code with it.

Also: no outstanding-balance guard at all, so an invoice of RM 15,072 accepted
RM 60,288 — not a race, simply unchecked. And a client error thrown without a
status code, so paying a cancelled invoice answers 500.

## Findings so far

Four, none of them previously known, all on current `main`. Two needed
concurrency, one needed aged data, one needed both.

**`total-equals-lines` and `status-follows-money` are the same hole**, and
saying it that way is worth more than either bug: **three routes write the
`sales_docs` row and only one takes the lock.**
`POST /api/invoices/:id/payments` locks; `PUT /api/sales-docs/:id` and
`PUT /api/sales-docs/:id/status` do not.

- The edit route replaces a draft's lines with `deleteMany` then `create`,
  unlocked. Under READ COMMITTED each concurrent edit deletes only the rows
  visible to it and inserts its own, so every edit's rows survive while `total`
  comes from whichever committed last. Four simultaneous edits of one draft left
  **12 line rows summing to RM 72,200 on a document whose total said
  RM 18,050**, all four returning 200. Reproduces 3/3; shrinks from 253 actions
  to 9 across 2 waves.
- The status route writes `status` directly while the payment route derives it
  from `paid_amt`. In one wave a payment of RM 1,637.25 returned 201, deriving
  PARTIAL, and a status write of SENT returned 200. Final state: total RM 6,549,
  paid RM 1,637.25, **status SENT** — an invoice with money against it sitting
  in the chase list. It self-heals only if another payment happens to re-derive
  the status later.

**`paging-does-not-lose-or-repeat`.** Every paged list orders by a single
non-unique column and pages with OFFSET, so Postgres is free to order tied rows
differently per query. Walking six pages of thirty invoices:

```
p1: 2948 2947 2946 2945 2944
p2: 2944 2942 2941 2940 2939     <- 2944 repeated, 2943 on no page at all
p3: 2938 2937 2935 2934 2933     <- 2936 skipped here...
p5: 001  2936 ...                <- ...and surfaces here, out of order
```

Thirty invoices exist; twenty-nine were ever seen. An invoice on no page is
never chased and never collected, and every page answers 200. Reproduces 3/3
seeds — but only with seasoning, because it needs more than one page and enough
tied dates to matter.

**`one-live-conversation-per-contact`.** Eight concurrent inbound webhooks from
one number all returned 200 and left **four live threads for one contact**. The
customer shows up four times in the inbox and a reply goes down whichever thread
the operator opens. `wa_messages.wa_message_id` is unique so a duplicated
message is caught; the contact-and-conversation find-or-create that runs before
it is not. Reproduces 3/3. Realistic without a swarm: Meta retries webhooks, and
a customer sending two messages quickly produces two concurrent POSTs.

## The five blind spots, and where each stands

The whole design is aimed at what reading code cannot see. Stated plainly so
the gaps are as visible as the coverage:

| An audit is blind to | Shoal |
|---|---|
| It reasons, it never runs | every voyage runs the real system |
| Single-threaded — never two things at once | waves, three shapes of forced collision |
| Fresh state — never accumulated data | seasoning, backdating across months |
| Silent failure — a 200 and a blank row | probe soundings, and the browser |
| **It shares blind spots with the code** | **not solved, and made worse if you let it** |

The fifth is the one to keep watching. Every sounding's `because` is written
from the business, and the moment one is written from the implementation
instead, it will agree with the bug it was supposed to catch.

## Not yet

- **Fault injection beyond duplication.** A webhook can be delivered twice; it
  cannot yet arrive out of order, arrive six weeks late, or not arrive at all.
  A callback that never fires is a live open issue on another system here, and
  Shoal could not currently find it.
- **The browser only looks.** It logs in and reads. It does not fill a form,
  submit it, or race another actor from the UI.
- **A third target.** Two systems have been described, which is enough to have
  found six things welded to the first and not enough to claim the abstraction
  is right.
- **Anything but Postgres and HTTP.** The reset is a Postgres template clone and
  the driver speaks HTTP. Neither is deep in the design; both are the only thing
  that has been tried.
