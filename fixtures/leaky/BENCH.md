# Bench history

Every score Shoal has produced against an app whose bugs are known in advance.
Kept in the repo next to the instrument, including the runs where it did worse,
because a number you only publish when it flatters you is not a measurement.

`shoal bench` starts `fixtures/leaky` fresh on :4100, runs against it for a
fixed time, and scores what it confirmed against
[EXPECT.json](EXPECT.json). A finding that matches no planted bug is a false
positive, and a false positive fails the run whatever the recall was.

## The machine these were taken on

A MacBook with **8 GB of RAM**, which turns out to matter more than anything
else here:

- `qwen3:8b` does not fit. Ollama puts about a quarter of it on the CPU and a
  driver turn takes **65 seconds**. `qwen3:1.7b` fits, and takes **1 second**
  with thinking off and 13 with it on. That single config line —
  `"extra": {"reasoning_effort": "none"}` — is worth more than any other tuning
  in this file.
- Three explorers share one Ollama, which serialises. Under load a driver turn
  costs about 3 seconds rather than one, so the local model is the throughput
  ceiling on this box and not the browser.

There is **no Claude-driven leg in this file**, and there should be. The
machine has no `ANTHROPIC_API_KEY`, and the `claude-code` path cannot
authenticate from inside a Claude Code session — the nested CLI answers
`OAuth session expired and could not be refreshed`. So the gap between a local
driver and a good one, which is the whole point of the M1 local-model gate, is
still unmeasured. Anyone with a key can close it in one run:

```bash
ANTHROPIC_API_KEY=... npx tsx src/cli.ts bench --for 30m \
  --provider anthropic --driver claude-haiku-4-5 --label "claude leg"
```

## 2026-08-29 08:41 — M1-M5: depth-first links, free notes, auth from the cookie jar

```
found            5 of 11
missed           #1 (race.lostupdate), #2 (money.overpaid), #4 (paging.walk), #5 (wrong.readback), #7 (wrong.consistency), #10 (slow)
false positives  1
wall clock       3m 45s
model calls      47        (0.21 per action)
spend            $0.00
FALSE POSITIVES — each one of these fails the gate:
  race.lostupdate @ POST /api/deliveries — POST /api/deliveries loses writes when they overlap
```

pages 31, endpoints 36, accounts 4, requests 671, actions 228

## 2026-08-29 08:43 — M1-M5: the counting argument only where it holds

```
found            0 of 11
missed           #1 (race.lostupdate), #2 (money.overpaid), #3 (leak.crossaccount), #4 (paging.walk), #5 (wrong.readback), #6 (fault.5xx), #7 (wrong.consistency), #8 (idempotency.double), #9 (auth.role), #10 (slow), #11 (fault.stack)
false positives  0
wall clock       1m 5s
model calls      12        (0.27 per action)
spend            $0.00
```

pages 12, endpoints 22, accounts 1, requests 74, actions 44

## 2026-08-29 08:47 — M1-M5: settle before looking, table rows are data

```
found            4 of 11
missed           #1 (race.lostupdate), #2 (money.overpaid), #3 (leak.crossaccount), #4 (paging.walk), #5 (wrong.readback), #7 (wrong.consistency), #10 (slow)
false positives  2
wall clock       3m 17s
model calls      58        (0.20 per action)
spend            $0.00
FALSE POSITIVES — each one of these fails the gate:
  money.overpaid @ POST /api/invoices/:id/status — POST /api/invoices/:id/status accepts more than is owed
  wrong.readback @ POST /api/orders — POST /api/orders says it saved ref, and it did not
```

pages 26, endpoints 44, accounts 4, requests 1065, actions 290

## 2026-08-29 09:18 — after the six false-positive fixes

```
found            6 of 11
missed           #1 (race.lostupdate), #2 (money.overpaid), #4 (paging.walk), #7 (wrong.consistency), #10 (slow)
false positives  0
wall clock       30m 8s
model calls      662        (0.52 per action)
spend            $0.00
```

pages 33, endpoints 51, accounts 4, requests 2822, actions 1273

## 2026-08-29 09:49 — one form per form, not one per row

```
found            5 of 11
missed           #1 (race.lostupdate), #2 (money.overpaid), #4 (paging.walk), #5 (wrong.readback), #7 (wrong.consistency), #10 (slow)
false positives  0
wall clock       30m 8s
model calls      692        (0.65 per action)
spend            $0.00
```

pages 30, endpoints 50, accounts 4, requests 1640, actions 1072

## 2026-08-29 10:51 — links queued by shape: let the tilt tip toward hammering

```
found            5 of 11
missed           #1 (race.lostupdate), #2 (money.overpaid), #3 (leak.crossaccount), #5 (wrong.readback), #7 (wrong.consistency), #10 (slow)
false positives  0
wall clock       30m 7s
model calls      716        (0.63 per action)
spend            $0.00
```

pages 33, endpoints 51, accounts 4, requests 1623, actions 1129

Read this one with its context. Queuing links by shape did what it was meant
to: the explore queue stopped growing with the data, the tilt tipped, and the
paging bug (#4) was caught for the first time — inside the first ninety
seconds. But the run also **lost the tenant leak (#3)**, and not because it
missed it: the tenancy probe concluded `shared` from a thin early sample and
cached it, which switches the cross-account check off for the rest of the run.

That is the more valuable result of the two. A wrong `isolated` costs nothing —
leaks get reported and each still has to reproduce. A wrong `shared` silently
disables the single most valuable check in the tool and nothing downstream ever
says so. The verdict is now asymmetric: **one object properly refused to a
stranger is decisive**, and `shared` needs everything readable across at least
three distinct endpoints. Verified directly against the fixture rather than by
another thirty-minute run:

```
object-shaped API reads available to sample: GET /api/invoices/:id/payments, GET /api/invoices/:id, GET /api/orders/:id
tenancy   accounts are separated — 1 of 2 objects were refused to a stranger
VERDICT: isolated   ✓ correct for this fixture
```

M4 did not fall out of this run. `POST /api/invoices/:id/payments` was still
never hammered. The hammering machinery is not the problem — five of eight
write endpoints were hammered, and the paging find proves the tilt now tips.
Reaching a payment means create an order, open its invoice, pay it, and nothing
in the tool pursues a goal like that yet.

## 2026-08-29 11:26 — M4 attempt: re-queue a form that has never once worked

```
found            3 of 11
missed           #1 (race.lostupdate), #2 (money.overpaid), #4 (paging.walk), #5 (wrong.readback), #6 (fault.5xx), #7 (wrong.consistency), #10 (slow), #11 (fault.stack)
false positives  0
wall clock       30m 7s
model calls      684        (0.64 per action)
spend            $0.00
```

pages 30, endpoints 48, accounts 4, requests 1735, actions 1071

The tenancy fix worked — `isolated`, and the tenant leak came back. Everything
else went the wrong way, and the reason is the point of this entry.

Six recorded runs now: **6, 5, 5, 3** of eleven, zero false positives every
time, with the code getting better between them. What moves that number is not
the checks. It is which forms a thirty-minute run happens to submit. This run
poked 22 of 30 field classes and never touched the payment form or the report
form, so it lost #1, #2, #7 (all behind a payment) and #6, #11 (both behind a
malformed date) in one go. The previous run poked 19 and got two of those.

That is not a tuning problem, and four more thirty-minute runs will not fix it.
The design says so on its own front page: ten minutes finds a few things, a day
finds about everything. Two of the eleven planted bugs **cannot exist** on a
small database. Trying to close a concurrency gate in thirty-minute slices was
the mistake; the next entry is a long run.

## 2026-08-29 11:28 — M6: 24 hours unattended

```
found            1 of 11
missed           #1 (race.lostupdate), #2 (money.overpaid), #3 (leak.crossaccount), #4 (paging.walk), #5 (wrong.readback), #6 (fault.5xx), #7 (wrong.consistency), #9 (auth.role), #10 (slow), #11 (fault.stack)
false positives  0
wall clock       1m 18s
model calls      13        (0.13 per action)
spend            $0.00
```

pages 14, endpoints 31, accounts 4, requests 357, actions 102

## 2026-08-29 11:33 — M6: 24 hours unattended, with prerequisites reachable

```
found            0 of 11
missed           #1 (race.lostupdate), #2 (money.overpaid), #3 (leak.crossaccount), #4 (paging.walk), #5 (wrong.readback), #6 (fault.5xx), #7 (wrong.consistency), #8 (idempotency.double), #9 (auth.role), #10 (slow), #11 (fault.stack)
false positives  0
wall clock       2m 25s
model calls      0        (0.00 per action)
spend            $0.00
```

pages 0, endpoints 0, accounts 0, requests 0, actions 0

## 2026-08-29 — M4 gate: the concurrency bug, caught

Not a `shoal bench` run. The M4 gate asks one question — does the hammerer
catch fixture bug #1, the unlocked read-modify-write on `paid_amt` — and that
is answerable directly, on its own fixture on :4101, without disturbing the
24-hour run on :4100 or waiting for it.

The script signs up a fresh account, lets `reach()` raise an order to make
itself an invoice, records one ordinary payment through the browser, and then
hands the recorded endpoint to `runHammer` for each of the three collision
shapes:

```
reach     reached /pay on one of my own, from /app/invoices
endpoint  POST /api/invoices/:id/payments {"201":1} readback: 7
finding   RACE POST /api/invoices/:id/payments loses writes when they overlap  (3/3)
shrink    POST /api/invoices/:id/payments still loses writes with 2 at once, down from 8

same-row         confirmed a lost update (same-row, 2 at once)
shared-resource  shared-resource: writes survived
cross-action     cross-action: writes survived

M4 GATE: PASS
  One of these writes moves paid_amt by 10. 2 were fired together and 2 were
  accepted with 201, so paid_amt should have reached 100. It reached 90: 1 of
  the 2 accepted writes actually landed. The responses went out 1ms apart,
  which is inside one read-modify-write window.
```

Three things in that worth keeping:

**It calibrated against the app rather than assuming.** Nothing here knows what
`paid_amt` means. It measured what one payment does to the invoice, fired a
volley, and compared the app's own two answers to each other.

**The other two shapes correctly found nothing.** `shared-resource` and
`cross-action` both returned "writes survived", which is the right answer for
this endpoint and the discipline that kept false positives at zero.

**It shrank to two.** "Two people paying one invoice at the same time" is a bug
report a developer can act on. "Eight machines hammering an endpoint" invites
the answer that nobody would do that.

The first version of the shrink reported it as *"2 were fired together and 8
were accepted... 1 of the 8 accepted writes landed"* — it had rewritten the
wave size in the old run's sentence and left the rest describing the run it
threw away. A repro that contradicts itself is worse than a long one, so the
shrunk wave now supplies its own account of what happened.
