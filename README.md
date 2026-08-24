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

The reason BBF is the first target is that some of its races are already found,
fixed and committed. That makes "does this work" a question with an answer:

| Commit | The defect | Shoal should |
|---|---|---|
| `b3f6acb^` | invoice row not locked before recomputing paid_amt — five concurrent RM200 payments against a RM1000 invoice left the invoice claiming RM400 | trip `paid-matches-payments` |
| `9c6e3d2^` | availability is a read and races the booking | trip `slot-capacity` |

Check the parent commit out into a worktree, point `bbf.root` at it, and run a
voyage. If Shoal finds the bug **without being told what to look for**, the
instrument works. If it does not, that is worth more than a green run.

## Findings so far

**`total-equals-lines`, current `main`, seed 4471, reproduces 3/3.**

`PUT /api/sales-docs/:id` replaces a draft's lines with `deleteMany` followed by
`create`, inside a transaction — but unlike the payment path it takes no row
lock. Under READ COMMITTED each concurrent edit deletes only the rows already
committed and visible to it, then inserts its own. Four simultaneous edits of
one draft quotation left **12 line rows summing to RM 72,200 on a document
whose total says RM 18,050** — the lines from every edit survived, the total
came from whichever committed last.

Two people editing the same draft at the same moment is an ordinary Tuesday,
and the figure that comes out wrong is the one the customer adds up.

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
- A UI driver. Everything above is the API surface; the silent-blank-row class
  needs a browser.
