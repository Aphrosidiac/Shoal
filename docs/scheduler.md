# The scheduler

The engine of the whole thing. Everything Shoal does is an item on one queue,
and what it does next is whatever scores highest right now.

## The work items

| Kind | Payload | Who runs it | Costs a model call? |
|---|---|---|---|
| `explore` | a page or a link never followed | explorer | yes |
| `form` | a form + a class of value not yet tried | explorer | yes, cheap |
| `mission` | a persona + a goal | explorer | yes, the most |
| `hammer` | an endpoint + a collision shape | hammerer | no |
| `confirm` | a suspicion | confirmer | no |
| `crossaccount` | a recording + a different account | hammerer | no |

Note the right-hand column. Only three of the six cost anything, and the two
that dominate a long run — `hammer` and `confirm` — are free. That is why hour
twenty is cheap.

## Scoring

```
score = base(kind) x novelty x staleness x tilt
```

**base** — what this kind is worth in principle.

```
confirm       200    a suspicion is worth more than more wandering
explore       100
form           80
mission        70
crossaccount   60
hammer         40
```

`confirm` sits at the top deliberately. The moment something looks wrong, find
out whether it is real. Suspicions going stale is how a report fills with
maybes.

**novelty** — have we done this before?

- a page never seen: `1.0`. Seen once: `0.4`. Seen five times: `0.05`.
- a form: `untried value classes / total classes`
- an endpoint never hammered: `1.0`, and falls off fast after that
- a write endpoint scores double a read one

**staleness** — an item that has sat in the queue for an hour gets a slow lift,
so nothing starves forever.

**tilt** — the thing that produces phases without anyone writing phases.

```
unexplored = frontier items of kind explore/form / total frontier

explore, form, mission   x  unexplored
hammer, crossaccount     x  (1 - unexplored)
```

Early on the map is mostly holes, `unexplored` is near 1, and exploring wins.
As the holes fill, it slides toward 0 and hammering wins. Nobody switches a
mode. It just tips.

## Leases, retries, and giving up

Pulling an item leases it for a few minutes. A worker that dies loses one item;
the lease expires and it comes back. That is the whole crash story.

Three attempts, then `failed`. Failures are not silent — a kind of work that
keeps failing is an event, and it shows in the report.

## The starvation guard

Carried over from the old design, because it was the single most valuable
guard rail there and it cost almost nothing.

**A swarm being refused is not a swarm finding nothing.**

Track the success rate of every action fingerprint. Anything tried five times
that has never once succeeded is reported **above the verdict**, not buried:

```
STARVED
  POST /api/orders          0/14   always 400 "customer required"
  POST /api/invoices/:id/send  0/9  always 403
```

An app where every write is being refused looks exactly like an app with no
bugs. Without this, a clean report is meaningless.

Same idea one level up: if an agent has been stuck on the same screen
fingerprint for six turns, it is looping. Kill the mission, log it, move on.

## Pacing and budget

Two independent limits:

- **pace** — requests per second at the app, so a dev server does not fall over
  and rate limiting does not make everything look like starvation.
- **budget** — an optional dollars-or-tokens-per-hour ceiling. As spend
  approaches it, the scheduler stops issuing the kinds that cost model calls and
  keeps issuing the free ones. It slows down rather than stopping, and it says
  so.

That combination is the honest answer to "how much will a day cost me": you set
the number and it fits inside it.
