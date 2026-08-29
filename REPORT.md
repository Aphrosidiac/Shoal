# What was built, and what it does not do

Written at the end of the build, against the gates it was given. Numbers here
are from real runs whose full output is in
[fixtures/leaky/BENCH.md](fixtures/leaky/BENCH.md), not from reading the code.

---

## The gates

| Gate | Status |
|---|---|
| **Step 0** — the fixture: 11 bugs and 5 non-bugs | **met.** Every one verified by hand before a line of Shoal existed |
| **M1a** — signs up unaided, maps 20+ pages | **met**, repeatedly. Best run: 33 screens, 31 explored |
| **M1b** — the same run against Claude, for comparison | **not met, and not meetable here.** See below |
| **M2** — the queue, resume | **met.** 1,072 actions off one scored queue; `run` continues rather than restarting |
| **M3** — ≥6 of 11 with zero false positives | **met.** 6 of 11, 0 false positives, 30m 8s |
| **M4** — catches fixture bug #1, the race | **not met.** See below |
| **M5** — personas, missions, cross-account | built and running. The tenant leak it finds comes through the cross-account path |
| **M6** — 24h unattended, ≥9 of 11 | **not met.** No 24-hour run was possible in this session; the longest is 30 minutes |

Two gates are open and one is unmeasurable. Both are written up rather than
worked around.

---

## What works

**It gets in on its own.** Point it at a URL and it finds the signup form,
invents an identity, submits it, reads its own verification link off a local
SMTP catcher, and lands inside the app. No credentials, no fixtures, no
configuration beyond the URL. It does this reliably enough that four accounts
per run is routine.

**It maps the app from the outside.** 30–33 screens, ~50 endpoints, 12 forms —
which is roughly the real shape of the fixture. Pages, forms, fields and their
types, the API call behind each button, and which screens lead where. It
persists, so run #10 starts where run #9 stopped.

**The map works as a cache.** The number to watch was model calls per action,
target 0.10. The best measured run held **0.07**. Later runs sat at 0.5–0.65
because they were doing more genuinely novel work per action, not because the
cache stopped working — 34 of a scout's 45 turns were free in one run.

**It finds real bugs and reproduces them.** Six of eleven planted defects, each
with a repro that runs at HTTP speed with no model involved:

- a tenant leak on `GET /api/orders/:id`, proven by a second account it signed
  up itself
- an ignored `Idempotency-Key`, proven by sending the same request twice
- a role gap on `/api/admin/export`, proven against neighbours that correctly
  403 — the contrast is the evidence
- a 500 where a 400 belongs, and a stack trace in the response body
- `PATCH /api/customers/:id` claiming it saved a phone number it dropped,
  proven by reading it back through the app's own refetch

**It does not cry wolf.** Zero false positives across the last two 30-minute
runs. The fixture contains a correctly serialising write, a correctly locked
endpoint, a correctly paged list and two accounts that correctly cannot see
each other. None were reported. Two agent suspicions were filed and binned for
failing to reproduce, which is the gate working in the direction nobody
celebrates.

**The rest of the machinery is there and exercised**: the dashboard on :7717
matching the mockup, a self-contained `report.html`, the MCP server (verified
over stdio, including that it refuses a non-localhost URL), budget throttling,
shrinking, app-restart detection, and `run`/`stop`/`resume` on one SQLite file.

---

## What does not work

**The concurrency bug is not caught.** `POST /api/invoices/:id/payments` is
where fixture bug #1 lives, and in thirty minutes it was called eight times and
hammered zero. The barrier and the three collision shapes are built and fire
correctly against other endpoints; the read-modify-write bug they exist to
catch is simply never reached, because getting there means *create an order →
open its invoice → record a payment*, and that is a mission, not a walk. The
machinery is not the problem. Reaching the endpoint is.

**Three more misses trace to the same place.** #2 (a payment larger than the
balance) and #7 (a status that disagrees with itself) both need a paid invoice
to exist. #4 (paging) and #10 (an unbounded query) need hundreds of accumulated
rows — hours, not thirty minutes, which is exactly what the design says and
exactly what was not available.

**Recall is unstable between runs.** 6 of 11, then 5 of 11, with the fix
between them being a clear improvement. What gets poked in thirty minutes
depends on which order the queue happens to drain, and thirty minutes is not
enough for the scoring tilt to swing from exploring to hammering. Two runs is
not a sample.

**Model calls per action rose, not fell**, across the session — 0.07 up to
0.65. Not a regression in the cache; it reflects more forms and more novel
screens per unit of work. But the design's claim that hour twenty is nearly
free is untested, because there was no hour twenty.

---

## What the design got wrong

Sixteen corrections are in [docs/decisions.md](docs/decisions.md). These are
the ones that were wrong in principle rather than in detail.

**"Agents find, dumb checks judge" was right, and it was not enough.** Six
false positives were shipped and killed during the build, and *every one came
from a deterministic check*, not from an agent. A cross-account 200 treated as
evidence of a leak. The counting argument applied to a collision shape that
deliberately targets different objects — which reported a correctly serialising
booking endpoint as a race, twice. Matching a read-back by id alone, when ids
are per-collection and invoice 26 and order 26 both exist. The gate the design
built to protect against a confident LLM does nothing about a confident
`if` statement. A deterministic check is only as good as its evidence, and the
principle needs a second clause: **a check must prove the thing it claims, not
a thing consistent with it.**

**Not all wrong answers cost the same, and the design treats them as if they
do.** The tenancy probe decides once whether an app isolates its accounts, and
on a `shared` verdict the cross-account check is switched off for the rest of
the run. One run decided `shared` from a thin early sample and lost a real
tenant leak it had found every time before — silently, with nothing downstream
saying a check had been disabled. A wrong `isolated` costs almost nothing:
leaks get reported and each still has to reproduce. A wrong `shared` costs the
strongest check in the tool. Anywhere a verdict gates a check, the cheap
mistake and the expensive mistake need different amounts of evidence, and the
design specifies neither.

**URL patterning was specified for paths and forgotten for everything else.**
Rule 3 collapsed `/about`, `/terms`, `/privacy`, `/pricing` and `/contact` into
a single `/:id` and took most of the map with them. And a form was identified
by its `data-action` — which carries an id — so one form became sixty, one per
row, with its field-tried state split twenty-five ways and every copy scoring
as never-tried. Anything used as an identity needs normalising, not just paths.

**Read-back learning was too trusting.** "Whatever GET the app fires after a
write is the read-back" is true only if that GET returns data. A create that
redirects fires a document request, and the replayer was taught to read results
back off an HTML page it could not count anything in.

**The screen fingerprint counted data as structure.** Table-row links made a
list re-fingerprint every time anything was added to it, so the same screen
looked new all day. Combined with `note()` being free, an explorer would
describe the dashboard forever. The design says content is excluded; it does
not say that a link inside a row is content.

**`requires_auth` was inferred from the wrong thing** — whether we had filed
the account yet, rather than whether the browser was carrying a session. The
screen you land on immediately after signing up was therefore filed as public,
and every explorer was steered away from the most important screen in the app.

**Nothing in the design creates data, and almost every interesting bug needs
it.** Exploration maps; forms poke; hammering accumulates. Ordinary wandering
never produces a paid invoice. Missions exist for this and arrive at M5, which
is late — by then the queue is full of cheaper work that outscores them.

---

## If someone picks this up

Three things, in order of value:

1. **Make missions reach the deep endpoints.** Not more exploring — a goal,
   pursued: create an order, open its invoice, pay it. Three of the five misses
   are behind that one workflow.
2. **Run it for a day.** Two of the eleven planted bugs cannot exist on a small
   database, by construction. Thirty minutes cannot answer the question the
   whole design is built around.
3. **Measure it against a good model.** This machine has no `ANTHROPIC_API_KEY`
   and the `claude-code` path cannot authenticate from inside a Claude Code
   session, so the gap between a small local driver and a good one — the entire
   point of the M1 local-model gate — is unmeasured. One command closes it, and
   it is at the top of [BENCH.md](fixtures/leaky/BENCH.md).

The honest summary: **the parts that decide whether this is trustworthy work,
and the parts that decide whether it is thorough are unfinished.** Zero false
positives across the last two runs is the result worth having. Five or six of
eleven is a floor set by how long it was allowed to run, not by what it can
see.
