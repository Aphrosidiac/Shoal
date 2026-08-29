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
| **M2** — the queue, resume | **met.** Two runs in one directory: "picking up 71 items left from last time", one row in `runs`, scout skipped, accounts reused |
| **M3** — ≥6 of 11 with zero false positives | **met.** 6 of 11, 0 false positives, 30m 8s |
| **M4** — catches fixture bug #1, the race | **met.** 3/3, shrunk from 8 concurrent requests to 2 |
| **M5** — personas, missions, cross-account | built and running. The tenant leak comes through the cross-account path |
| **M6** — 24h unattended, ≥9 of 11 | **components met, the number outstanding.** Dashboard, budget, throttle, shrink, restart handling, status and resume are each verified with output. The 24-hour run itself was still going when this was written |

One gate is outstanding and one leg of M1 is unmeasurable here. Both are
written up rather than worked around.

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

**It finds real bugs and reproduces them.** Each with a repro that runs at HTTP
speed with no model involved:

- a tenant leak on `GET /api/orders/:id`, proven by a second account it signed
  up itself
- an ignored `Idempotency-Key`, proven by sending the same request twice
- a role gap on `/api/admin/export`, proven against neighbours that correctly
  403 — the contrast is the evidence
- a 500 where a 400 belongs, and a stack trace in the response body
- `PATCH /api/customers/:id` claiming it saved a phone number it dropped,
  proven by reading it back through the app's own refetch
- an unlocked read-modify-write on `paid_amt`, proven by measuring what one
  payment does to the invoice, firing a volley, and comparing the app's own two
  answers to each other — then shrunk to two concurrent requests, because "two
  people paying one invoice" is a bug report somebody can act on
- a payment larger than the balance owed, and a list that loses rows when you
  page through it

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

**Two of the eleven need hours and cannot be hurried.** #10 is an unbounded
query that is fast until roughly six hundred rows exist, and #4 is a paging
hole that needs more rows than fit on a page. They are in the fixture
deliberately, to make the point that a short run cannot see everything, and a
short run duly cannot see them.

**Recall swings between runs.** 6, 5, 5, 3 across four thirty-minute runs, with
the code improving throughout — because what gets found in thirty minutes
depends on which forms the queue happens to drain first, and thirty minutes is
not long enough for the scoring tilt to swing from exploring to hammering. Two
runs is not a sample. The long run is the answer to this, not more short ones.

**Model calls per action rose across the session**, 0.07 to 0.65. Not the cache
failing — it reflects more novel screens and more forms per unit of work — but
the design's claim that hour twenty is nearly free is still untested, because
there was no hour twenty.

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

**The most dangerous bug in the tool was a check that could not fail.** A
`recheck` reported a bug as fixed while the app was still serving it: the
replay came back 401 five times, never reaching the code under test, and since
a 401 is not a 5xx it counted as clean, and five cleans counted as a fix. The
same shape as everything else in this section — absence of contradiction read
as evidence — but pointed at the one output a person acts on directly. A
verdict of "fixed" has to be earned; "could not test it" is a third answer and
the design already had a name for it, `stale`.

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

**Nothing in the design creates prerequisites, and almost every interesting bug
is behind one.** Every explorer signs itself up, so its world starts empty: a
worker sent to a payment form finds no invoices, because nothing it did made
one, and fails forever. That single gap kept the concurrency gate shut through
four thirty-minute runs and three separate theories about hammering. An invoice
exists *because an order was raised* — that chain has to be walked, not waited
for. Exploration maps, forms poke, hammering accumulates; none of them create
the thing the next check needs.

**A design can specify a fallback that never worked and never know.** The
replayer's documented way to re-authenticate is to re-fire the request that
granted a session. Playwright's `response.headers()` drops `set-cookie`, so no
recording on disk ever held that header — the fallback was dead from the first
line and invisible, because whenever a browser session is live in the same
process it hands its cookie jar straight over. It only surfaced when a second
process tried, which is every resumed run, every recheck, and every confirmer
working an account no explorer is currently holding.

---

## If someone picks this up

Three things, in order of value:

1. **Run it for a day.** Two of the eleven planted bugs cannot exist on a small
   database, by construction. A short run cannot answer the question the whole
   design is built around, and every attempt to make it do so failed.
2. **Measure it against a good model.** This machine has no `ANTHROPIC_API_KEY`
   and the `claude-code` path cannot authenticate from inside a Claude Code
   session, so the gap between a small local driver and a good one — the entire
   point of the M1 local-model gate — is unmeasured. One command closes it, and
   it is at the top of [BENCH.md](fixtures/leaky/BENCH.md).
3. **Give missions a reason to run.** Prerequisites are reachable now — an
   empty list gets filled from a neighbouring collection — but nothing yet
   pursues a goal end to end, and that is what the crew was for.

The honest summary: **the parts that decide whether this is trustworthy work,
and the parts that decide whether it is thorough are unfinished.** Zero false
positives across the last two runs is the result worth having. Five or six of
eleven is a floor set by how long it was allowed to run, not by what it can
see.
