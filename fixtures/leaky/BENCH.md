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
