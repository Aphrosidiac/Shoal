# The report, and how findings are ranked

## Ranking

`risks.md` admitted severity is a guess. It is, so the ranking does not pretend
to score importance. It sorts on three things that can actually be measured.

**1. Category.** A fixed order, because some classes of defect are worse than
others no matter what the app is:

| Rank | Category | Why it sits there |
|---|---|---|
| 1 | `leak` | another account's data. Nothing is worse and nothing is more certain |
| 2 | `data-loss` | a write accepted and lost, or a value silently changed |
| 3 | `money` | a stored figure disagreeing with the rows it is made of |
| 4 | `race` | concurrent requests producing state no serial order could |
| 5 | `auth` | a role reaching something it was not granted, or locked out of its own job |
| 6 | `fault` | 5xx, a crash, a leaked stack trace |
| 7 | `wrong` | read-back mismatch not covered above |
| 8 | `slow` | over the threshold |
| 9 | `noise` | everything else |

**2. Confidence** — the reproduction ratio, shown as a fraction, never hidden.
`5/5` above `2/5`.

**3. Reachability** — how many steps from a fresh account. A bug on the signup
page outranks one behind twelve steps, because more users will hit it.

Sorted in that order. Nothing invented, nothing scored out of ten.

## What a finding looks like

```
─────────────────────────────────────────────────────────────────
#7   LEAK            confirmed 5/5        3 steps from signup
     Another account's order is readable by id

     GET /api/orders/:id returns any order to any authenticated
     user. Account B (crew-2) read an order created by account A
     (crew-1) and got the full body including the customer name
     and total.

     Repro — 3 requests, shrunk from 214
       1  POST /api/auth/register     as A          201
       2  POST /api/orders            as A          201  -> id 4471
       3  GET  /api/orders/4471       as B          200  <- should be 403/404

     Seen           14 times
     First          14:02, app build a91f0c
     Last           23:51, app build a91f0c
     Recordings     #8812 #8813 #9004  (+11)
─────────────────────────────────────────────────────────────────
```

Five rules for that block, each because of a way these reports usually fail:

- **The repro is the shortest thing that still fails**, and it says what it
  shrank from. A 214-step repro is not a bug report.
- **Every claim points at a stored recording.** Nothing is asserted that cannot
  be opened.
- **The count is a count, not fourteen entries.**
- **The app build is stamped**, so a finding from this morning is not confused
  with the code as it is now.
- **No prose written by a model.** The description is assembled from the
  recording by template. Model-written summaries drift from what actually
  happened, and the one thing this report must be is literally true.

## The four sections

**1. Findings.** Confirmed only, ranked as above.

**2. Not confirmed.** Suspicions that never reproduced, collapsed to one line
each, below a rule. Kept visible because a suspicion that recurs and never
reproduces is itself interesting — it usually means something intermittent that
the confirmer is not set up to catch.

**3. Coverage.** What was explored, what was hammered, what was never touched.
This is the section that says whether a clean run means anything.

**4. Events.** Restarts, starvation, rate limits, budget ceilings. Anything
that made the run less than it looked.

Section 4 sits *above* the verdict in the terminal summary, never below it. A
run where every write was refused looks exactly like a run that found nothing,
and the old tool proved that four separate times.

## Formats

`report.html` — the file, regenerated every minute, openable at any moment and
true when you open it. Self-contained, no network.

`report.md` — the same content as text, for pasting into an issue.

The dashboard at `shoal ui` is the same data live rather than a snapshot. See
[ui.md](ui.md).

## When the app changes underneath

Findings are stamped with the app build they were seen against. After a
restart, anything confirmed under the old build is re-checked in the
background, and moves to one of three states:

```
open        still reproduces
fixed       no longer reproduces after a code change   (with the build it went at)
stale       could not be re-checked — the route is gone
```

`fixed` is never deleted. A finding that disappears and comes back three days
later is worth more than either event on its own.
