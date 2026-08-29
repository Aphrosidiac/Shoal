# Calibration

## The problem this solves

You change the scoring weights. You swap the driver to a local model. You
rewrite the exploration prompt. The next run finds six bugs instead of nine.

Did it get worse, or did the app just have fewer bugs that day?

Without an answer to that, every improvement to Shoal is a guess, and a
regression is invisible. So there is one app whose bugs are known in advance,
and every change is measured against it.

## The fixture

`fixtures/leaky/` — a small order-and-invoice app. Fastify, better-sqlite3, one
file per route, no build step, no Postgres, no external services. `npm run
fixture` starts it on `:4100` with a fresh database.

It is deliberately ordinary. Signup with email and password, a list of
customers, orders, invoices, payments, an admin area. The kind of thing every
one of these tools is pointed at.

## The planted bugs

Eleven, one per class of check, written down in `fixtures/leaky/BUGS.md` and
never referred to by Shoal.

| # | Bug | Should be caught by |
|---|---|---|
| 1 | `paid_amt` updated with read-then-write, no lock | race + read-back |
| 2 | no outstanding-balance guard — an invoice accepts more than it is owed | money |
| 3 | `GET /api/orders/:id` never scopes by account | leak |
| 4 | orders paged by `created_at` with OFFSET, non-unique | paging |
| 5 | `PATCH /api/customers/:id` silently drops `phone` | read-back |
| 6 | a malformed date returns 500, not 400 | fault |
| 7 | status written directly by one route, derived by another | inconsistent state |
| 8 | double submit creates two orders, no idempotency | idempotency |
| 9 | `/api/admin/export` reachable by a normal user | role gap |
| 10 | an unbounded query on a list endpoint, slow past ~500 rows | slow, and needs seasoning |
| 11 | a 500 body carrying the raw stack trace | fault |

Two of them are chosen on purpose to be unreachable without the harder parts of
the design. **#1 needs genuine concurrency.** **#10 needs accumulated data** —
it is fast on an empty database, so a run that never builds anything up will
never see it.

## The things that are not bugs

Just as important, and the half most tools skip.

The fixture also contains behaviour that **looks** wrong and is not:

- an endpoint that correctly answers 403 to the wrong role
- a write that is correctly locked and correctly serialises
- an endpoint that correctly returns 400 for bad input
- a list that is correctly paged with a stable key
- two accounts that correctly cannot see each other

If Shoal reports any of those, that is a false positive, and a tool that cries
wolf is worse than no tool. Recall alone is a vanity metric.

## The score

```
shoal bench
```

Runs against the fixture for a fixed budget and prints:

```
found            9 of 11
missed           #10 (needs seasoning), #7
false positives  0
wall clock       18m
model calls      412        (0.14 per action)
spend            $0.31
```

Five numbers. Every one of them can move in the wrong direction, and each says
something different:

- **found** — did the checks work
- **false positives** — is it trustworthy
- **model calls per action** — is the map doing its job as a cache
- **wall clock** — is the scheduler spending time well
- **spend** — is it affordable to leave on

A change that raises `found` and also raises `false positives` is not an
improvement.

## When it runs

- before and after any change to the scheduler, the prompts, or a check
- as the **M1 local-model gate** — the same bench against Claude and against
  Ollama, and the gap between the two scores is the honest answer to whether a
  local driver works
- on every release

Results are appended to `fixtures/leaky/BENCH.md`, so the history of the
instrument is visible next to the instrument.

## Honest limits

The fixture is a small app whose bugs we planted, which means Shoal will
gradually become good at exactly it. That is real and unavoidable.

Two things keep it useful anyway. The bugs are shapes, not instances — an
unlocked read-modify-write is the same defect everywhere, and one of the old
tool's findings on one system turned out to be the identical defect on another
that shared no code. And the fixture is never the only target: a real app is
run alongside it before every release, and anything the fixture cannot explain
gets added to it.

When Shoal scores 11 of 11 with no false positives and stops improving, the
fixture has stopped being an instrument and needs more bugs in it.
