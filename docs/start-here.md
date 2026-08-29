# Start here

The design is done. This is what to do on day one.

## The repo as it stands

```
README.md
docs/                    the design, 18 files. decisions.md is the index of what is settled
package.json             deps chosen, scripts wired
tsconfig.json            strict, NodeNext, ES2023
shoal.config.example.json
src/                     directory skeleton + store/schema.sql (complete, ready to run)
fixtures/leaky/          BUGS.md written; the app itself is the first thing to build
```

Nothing is implemented. `src/store/schema.sql` is real and finished — every
other file under `src/` is an empty directory waiting for M1.

## Before writing any Shoal code, build the fixture

`fixtures/leaky/` first, not second. Three reasons:

1. It is the only thing you can point Shoal at while Shoal does not work yet.
2. Every bug in it is one you already understand, so when Shoal misses one you
   know it is Shoal's fault.
3. It makes M1 "done" a number instead of a feeling.

It is a small Fastify + better-sqlite3 app with the eleven bugs in
[../fixtures/leaky/BUGS.md](../fixtures/leaky/BUGS.md) and the five
deliberately-correct behaviours. Half a day, maybe.

## Then M1, in this order

```
1  store/          db.ts, schema, the repos you need. Nothing else can start.
2  target/probe.ts is the app up, what is it
3  browser/        pool, session, snapshot, act — and record.ts from the first line
4  signup/         identity, mail catcher on :1025, drive the signup form
5  model/          the interface + all three adapters. anthropic first
6  agent/          the turn loop, the nine tools, the scout prompt
7  report/         plain text is enough at M1
```

`browser/record.ts` exists from the first line of `browser/`, not later. There
is no mode where an agent acts without being recorded, and retrofitting that is
how it ends up with holes.

**M1 is done when** it makes an account on the fixture unaided, maps twenty
pages, and `shoal bench` prints five numbers — then the same run against a
local driver, and the gap between the two is the honest answer about local
models.

## The three questions that can kill this

Answer them in this order, and do not build past one until it is answered.

**M1 — can an agent get into an app unaided?**
Signup, verification, and a map that looks like the app. If this does not work,
nothing above it matters.

**M3 — can we report anything without lying?**
A real bug in one of your own apps, and zero false positives on the fixture.
The second half is the hard half.

**M4 — does browser-to-learn, HTTP-to-repeat actually catch races?**
Fixture bug #1 needs genuine concurrency. If replay cannot reach it, the
central bet of the design is wrong and it is better to know at M4 than at M6.

## Where to look things up

| Question | File |
|---|---|
| what is settled, and what is not | [decisions.md](decisions.md) |
| the source tree and what each module owns | [modules.md](modules.md) |
| the tables | [schema.md](schema.md) |
| what work exists and how it is prioritised | [scheduler.md](scheduler.md) |
| the tool surface, personas, missions | [agent-loop.md](agent-loop.md) |
| fingerprints, replay, hammering | [recording.md](recording.md) |
| how bugs are caught without a database | [finding-bugs.md](finding-bugs.md) |
| models, providers, cost, caching | [ai.md](ai.md) |
| running the planner on a subscription | [claude-code.md](claude-code.md) |
| how we know Shoal works | [calibration.md](calibration.md) |
| commands, config, packaging, privacy | [cli.md](cli.md) |
| ranking and what a finding looks like | [report.md](report.md) |
| the dashboard | [ui.md](ui.md) · [ui-mockup.html](ui-mockup.html) |
| what will go wrong | [risks.md](risks.md) |
