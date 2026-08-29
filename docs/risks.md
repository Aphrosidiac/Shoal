# What will go wrong

Written before any code, so it is not hindsight. Each of these is a real way
this fails, with what we do about it.

## Signup is a wall

**OAuth, Google login, phone OTP, invite-only, a paid plan gate.** Agents cannot
get through any of those, and an app that has no email-and-password signup is
simply out of scope until told otherwise.

Mitigation: detect it early and say so plainly — "I cannot sign myself up, give
me one account and I will make the rest" — rather than wandering a logged-out
marketing page for an hour and reporting nothing.

## The app is empty and there is nothing to do

A fresh account in a B2B tool is a blank screen. No customers, no products, no
data, and half the app is unreachable until someone sets it up.

Mitigation: agents create their own data first — that is what missions are for.
But some apps need an admin to seed a catalogue before anything is possible, and
for those we may have to accept being pointed at an already-seeded account.

## Agents trash each other's world

If the app is single-tenant, ten agents in ten accounts all see and edit the
same data. One deletes what another was mid-way through using, and the report
fills with nonsense.

Mitigation: detect it. The cross-account check tells us whether account B can
see account A's data. If it always can, the app is single-tenant — which means
that check must be **switched off as a bug detector** and switched on as a fact
about the app, and concurrency has to be interpreted differently.

This is the same signal meaning two opposite things depending on the app, and
getting it wrong makes every finding wrong. Worth solving properly and early.

## Replay fails for boring reasons

Expired tokens, one-shot CSRF tokens, ids that no longer exist. All of these
make a good recording un-replayable, and every one of them looks like a bug.

Mitigation: handled explicitly in [recording.md](recording.md). Anything that
still cannot be replayed gets marked replay-hostile and tested through the
browser only — slower, but honest.

## An agent gets stuck in a loop

Click, error, click, error, for four hours, burning money.

Mitigation: the screen fingerprint. Six turns on the same screen means stuck;
kill the mission, log it, move on. Also the starvation guard, which makes a
swarm being refused visible instead of silent.

## The report drowns you

Nine hundred rows of the same thing, or forty maybes.

Mitigation: the three fingerprints, and the suspicion gate. Nothing unconfirmed
is ever counted as a finding. This is the difference between a tool people use
and one they turn off in week two.

## It costs more than expected

A day of agents is real money, and nobody wants a surprise.

Mitigation: the budget ceiling is first class, spend is recorded per worker, and
the cheap work is deliberately the work that dominates a long run.

## The dev is editing code while it runs

Of course they are. Findings get stale, and a bug reported at 11:00 may have
been fixed at 14:00.

Mitigation: every finding is stamped with an app version, restarts are logged,
and findings that stop reproducing after a restart are marked rather than
deleted.

## It finds things nobody cares about

Technically a bug, practically noise. A 500 on a route no user reaches. A leak
of data that is public anyway.

No clean mitigation. Severity is a guess and we should not pretend otherwise.
The honest version is to sort by "how sure are we" and "how much did it cost to
find", show the repro, and let the developer decide. Better to be trusted and
sometimes boring than clever and wrong.
