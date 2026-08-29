# Recording and replay

The recording is the product. Everything else reads from it.

## Interception

Every browser session runs with network interception on, always. There is no
mode where an agent acts without being recorded.

For each request we keep: method, URL, headers, body, status, response headers,
response body (truncated), duration, which worker, which account, which page it
happened on, and which app version was running.

## Turning URLs into patterns

Raw URLs are useless for counting anything. `/api/invoices/8123` and
`/api/invoices/8124` are the same endpoint.

Rules, applied in order:

1. a segment that is all digits becomes `:id`
2. a segment that looks like a UUID or a cuid becomes `:id`
3. a segment that has taken more than five distinct values in the same position,
   with the same neighbours, becomes `:id`
4. everything else stays literal

Rule 3 is what catches slugs and reference numbers that do not look like ids.
It needs traffic to fire, which is fine — the map improves as the run goes on,
and patterns get merged retroactively.

## Three fingerprints

Deduplication is load-bearing. Without these, a long run repeats itself forever
and the report is unreadable.

**Action fingerprint** — `method + path pattern + the set of body fields that
were set` (names only, never values).

```
POST /api/invoices/:id/payments {amount,method,reference}
```

Two payments of different amounts are the same action. A payment without a
reference is a different one, because it takes a different branch.

**Screen fingerprint** — the sorted roles and accessible names of every
interactive element on the page, plus the headings, hashed. Content is
excluded, so every invoice detail page fingerprints identically. This is what
stops an agent exploring the same screen two hundred times, and what detects an
agent stuck in a loop.

**Finding fingerprint** — `endpoint + check + failure shape`. The same bug seen
nine hundred times increments a counter.

## Read-back, learned for free

After a write, how do you check it took? You need to know which read shows it.

The frontend already tells us. Watch a `POST /api/invoices`, and whatever `GET`
the app fires immediately afterwards **is** the read-back for that write. Store
it as `endpoints.readback_id`.

Nobody configures this. It is derived from watching a real app refetch its own
data, which every frontend does.

## Replaying a recording

Re-firing a recorded request at HTTP speed, no browser and no model. Three
things have to be handled or every replay fails for boring reasons:

**Auth.** Tokens expire. The replayer holds a live session per account and
refreshes the header rather than replaying a stale one.

**CSRF and signed forms.** Some apps put a one-shot token in the page. A replay
with a used token is rejected, and that looks like a bug when it is not. Where a
token is detected, the replayer fetches a fresh one first — and if it cannot,
that endpoint is marked replay-hostile and only gets tested through the browser.

**Ids that must exist.** A recording referencing invoice 8123 is useless once
that invoice is gone. Replay either recreates its prerequisites from the
recorded sequence, or rewrites the id to something that exists now.

## Hammering

Where races come from, with no database in sight.

1. pick a write endpoint that has not been hammered
2. build N requests in one of three shapes
3. pre-open the sockets so connection setup is not part of the timing
4. hold every request at a barrier, release them in the same tick
5. read back — fetch the object, list it, count it
6. compare what the N responses *claimed* against what is actually there

The three shapes, and only the first is obvious:

**Same row.** Every worker hits one object. Five people paying one invoice.

**Shared resource.** Different objects competing for one scarce thing. Five
different bookings for the last slot. Identical arguments here would book one
thing five times and prove nothing — each worker needs a different object.

**Cross action.** Two different operations reaching for the same thing. One
worker closes a date while another books onto it. No amount of repeating a
single action can generate this, and it is where the interesting ones live.

## Shrinking

A confirmed finding arrives with everything that happened before it, which is
useless as a bug report. The shrinker cuts it down: drop a request, replay,
does it still fail? Keep cutting until nothing more can go.

Because the target is genuinely non-deterministic, the shrinker asks for N
attempts and treats one reproduction as a yes. A race that fires one time in
five is still a race, and pretending otherwise would throw away real bugs.

## Verdict

```
attempts   5
reproduced 3   ->  finding
reproduced 0   ->  dismissed, silently, never mentioned
reproduced 1   ->  finding, marked "intermittent, 1 in 5"
```

Nothing reaches the report without going through this.
