# Long runs

## There is no "run"

Shoal is not a test suite that starts and finishes. It is a **queue that never
empties**, with workers pulling off it. You stop it whenever you like and it
simply did less or more.

- Ten minutes: it has explored a bit and found a handful of things.
- A few hours: most of the app is mapped, the obvious stuff is hammered.
- Twenty-four hours: everything reachable has been found, everything found has
  been hammered, and the report is long.

It is slow by nature. The design leans into that instead of fighting it.

## What is in the queue

- look at this page I have never seen
- fill this form with a kind of value I have not tried
- chase this goal end to end
- hammer this recorded call with eight workers at once
- confirm this suspicion — replay it five times
- try this endpoint from a different account

## Phases are not hardcoded

Every item carries a score. Unexplored things score high while the app is still
unknown. As the frontier drains, hammering and confirming score highest.

So phases **emerge**. Ten minutes in it is mostly exploring. Twenty hours in it
is mostly beating on things it found in the first hour. Nobody wrote a phase
schedule and there is no mode to switch.

## Everything lives in one SQLite file

A run that lasts a day cannot lose its work because the Mac slept. One file
holds:

- the **map** — pages, forms, fields, endpoints, what leads where
- **accounts** it created, with their passwords, so they can be reused
- every **recording** — request, response, timing, agent, account
- **suspicions** — filed, not yet confirmed
- **findings** — confirmed, deduplicated, with occurrence counts
- **coverage** — what has been touched and what has not

Kill it, restart it, it carries on. Open the same file next month and it goes
deeper rather than starting over.

## The progress bar

For a long run you need to know whether leaving it on is still buying you
anything. All of this is countable without reading any source code:

```
pages found        38
endpoints found    41    hammered 12    29 to go
forms              22    fields poked 88 of 140
accounts made      17    role pairs tested 6 of 12
findings            9 confirmed, 4 unconfirmed
frontier          212 items queued
```

When the frontier stops growing and the "to go" columns reach zero, it is
finished and can say so.

## The report

One file, regenerated every minute, always openable and always true at the
moment you open it.

1. Confirmed bugs, worst first, each with a reproduction
2. Suspicions, clearly marked as unconfirmed
3. Coverage — what has been explored and what has not
4. What it is doing right now

## Your dev server will restart

You will be editing code while it runs. It will hot-reload, and it will crash.

Shoal notices the app went away, waits, and carries on. It logs "app restarted
at 14:22", and every finding is stamped with which version of the app it was
seen against — because a bug found at 11:00 may have been fixed at 14:00, and
the report should not claim otherwise.

## Cost falls as the run gets longer

Worth designing for deliberately.

LLM calls are almost entirely in exploring. Hammering, replaying and confirming
are pure HTTP with no model involved at all. So hour one is expensive and hour
twenty is nearly free.

Twenty-four hours does not cost twenty-four times one hour — more like three or
four times. That is what makes "just leave it running" a reasonable thing to
say.
