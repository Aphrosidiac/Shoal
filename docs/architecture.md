# Architecture

The overview. The detail lives in [modules.md](modules.md),
[schema.md](schema.md), [scheduler.md](scheduler.md),
[agent-loop.md](agent-loop.md) and [recording.md](recording.md).

## The trick that makes it work

An agent driving a browser takes around three seconds per click. That is fine
for working out how an app behaves. It is useless for hammering it, and races
need requests overlapping inside the same millisecond.

So:

> **The browser is for learning. HTTP is for repeating.**

An agent clicks through the UI. While it does, Shoal sits on the network and
records every request the frontend fires. Now we know the actual API call behind
"click Pay". From then on that call can be fired a thousand times a second with
no browser and no LLM involved.

The agent explores once. The swarm replays forever. That is how a design built
on slow agents still catches races.

## The pieces

### Scout

One agent, slow and smart. Given nothing but a URL, it:

- finds the signup flow and creates itself an account
- clicks around
- works out what kind of app this is and what a user is meant to do with it
- writes everything it learned into the map

The scout is the expensive part and it mostly runs early.

### Map

A growing description of the app, built entirely from the outside. Pages, forms,
fields and their types, the API calls behind each button, which screens lead to
which.

The map is persistent. Run it again next week against the same app and it picks
up where it stopped rather than starting blind. This is what makes run #10
deeper than run #1.

### Crew

Many agents. Each gets a persona and a goal, in plain English:

- "You are an impatient customer. You double-click things when they feel slow."
- "You are someone who changes their mind halfway and hits the back button."
- "You are a careful admin. Set up a team and invite people."
- "You open four tabs and work in all of them."

They use the map to move fast through known ground, and fall back to looking at
the page when they hit something new.

Personas are about **behaviour**, not demographics. "Ahmad, 34, likes coffee"
changes nothing. "Someone who submits the form twice" changes which code runs.

### Recorder

Underneath every agent, all the time. Every request and response, with timing,
which agent, which account, and which screen it came from. This is the raw
material for everything downstream — the checks read it, the replayer replays
it, the report quotes it.

### Watchers

Deterministic checks over the recordings. No LLM anywhere in them. See
[finding-bugs.md](finding-bugs.md) for the full list.

### Replay

Takes a suspicion and tries to make it happen again from the recording alone,
at HTTP speed, several times, sometimes concurrently. This is also where
concurrency bugs get caught: fire the same recorded call from eight workers at
once and read the result back.

### Report

Regenerated continuously. Always openable, always true at the moment you open
it.

## Process model

One Node process, one SQLite file in WAL mode, everything async inside it. One
browser with N contexts, one per explorer. The HTTP workers are ordinary async
tasks. `shoal status` and `shoal report` read the same file while the swarm is
still running. Full reasoning in [modules.md](modules.md).

## The safety story

The whole app is local. Shoal refuses to point at anything that is not
localhost. There is no allowlist to maintain, no dry-run mode, no policy on
destructive actions, no risk of emailing a real customer or charging a real
card.

This is a deliberate constraint, not a limitation to be lifted later. It is what
lets agents be genuinely reckless, which is the whole point of them.

## Accounts

Agents create their own accounts with random emails and passwords. Nobody hands
Shoal credentials. This gives three things:

1. **Setup is a URL.** Nothing else to configure.
2. **Unlimited personas.** Need twelve users? Make twelve.
3. **Signup is the reset.** A new account is a clean world, so a mission can
   always start from a known state without cloning a database.

The one thing in the way is email verification. Shoal runs a small SMTP catcher
on `localhost:1025`; the developer points their app's mail at it with one
environment variable, and agents read their own verification links. That is the
only setup step beyond the URL, and it only exists for apps that verify email.

If an app has teams, invites or roles, the crew discovers them the same way a
person would: one agent creates a workspace and invites another.
