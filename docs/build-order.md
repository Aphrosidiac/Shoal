# Build order

Each milestone ends with something you can actually run and judge. No milestone
is "infrastructure with nothing to show".

## M1 — it makes an account and draws a map

`config` · `store` · `browser` · `record` · `signup` · `mail` · `scout` ·
**both provider adapters** · a plain text report

Point it at a URL. It signs itself up, reads its own verification email off the
local SMTP catcher, wanders for five minutes, and prints what it found.

**Done when:** run it against one of your own apps on localhost and it comes back
with a real list of pages, forms and endpoints that you recognise.

This is the whole risk of the project in one milestone. If a scout cannot get
through signup and map an app unaided, nothing above it matters.

### Local models: ship the adapter, develop against Claude

Both adapters exist from M1, but the driver is **built and debugged against
Claude**. Debugging a new harness with a weak model means chasing two problems
at once and never knowing which one you are looking at.

The adapter is there from day one for a different reason: a driver prompt only
ever tested against one model quietly grows to depend on it — long
instructions, reliable tool calls, a big context window, a bit of reasoning.
Discover that at M5 and it is a rewrite. An abstraction with one implementation
is a guess.

So four constraints hold from the first line of the driver, and they make the
Claude path better too:

- nine tools, no more
- a short system prompt
- a strict schema plus a two-attempt repair loop
- every element ref validated against the snapshot before it is used
- nothing that depends on the model reasoning at length

**And a gate, not a hope.** M1 does not close until the same scout has been run
against a local model on Ollama and measured:

```
does it complete signup?
does it map twenty pages unaided?
turn success rate, against Claude's on the same app
```

That is the moment it tells you what is welded to Claude, while unwelding is
still cheap. The adapter is not the part that will break. The prompt is.

## M2 — it keeps going

`queue` · `score` · `scheduler` · `explore` and `form` workers · `coverage` ·
resume

Now there is no run, just a queue. Stop it and restart it and it carries on.
The coverage counters start meaning something.

**Done when:** leave it an hour, kill it, restart it, and it picks up rather
than starting over — and the map is visibly bigger than it was at M1.

## M3 — it reports bugs

`watch/*` · `suspicions` · `confirm` worker · `verdict` · dedupe · the live
report · **the MCP server and channel**

The first real output. Server faults, read-back failures, stack traces, slow
responses. Agents start filing surprises and the confirmer starts throwing most
of them away.

**Done when:** it finds a genuine bug in one of your apps that you did not
already know about, and the report has no false positives in it.

The second half of that sentence matters as much as the first.

Also here: Shoal becomes a thing Claude Code can operate, and confirmed
findings get pushed into a live session instead of waiting in a file. See
[claude-code.md](claude-code.md).

## M4 — it hammers

`hammer` worker · `barrier` · the three collision shapes · read-back comparison

Races, with no database access. This is the part that proves the whole
"browser to learn, HTTP to repeat" bet.

**Done when:** it finds a concurrency bug you can reproduce by hand afterwards.

## M5 — the crowd

`personas` · `missions` · `crew` · `crossaccount` worker · multiple accounts at
once

Goal-driven agents, tenant leak checks running constantly in the background,
and enough accounts to make role gaps visible.

**Done when:** a mission completes a real multi-step workflow end to end without
help, and cross-account checks have run against every write endpoint.

## M6 — leave it on for a day

`budget` · `throttle` · `shrink` · app restart handling · report polish ·
`status` while running

Everything that only matters once you stop babysitting it.

**Done when:** twenty-four hours against a real app, unattended, with a spend
ceiling that holds, and a report at the end you would send to someone.

The fix loop closes here too: a finding pushed into Claude Code, fixed in the
editor, hot-reloaded, and re-verified by Shoal without anyone asking.

## The order of the bets

M1 answers *can an agent get into an app unaided.*
M3 answers *can we report anything without lying.*
M4 answers *does the fast-replay trick actually catch races.*

Those are the three that can kill the project. Everything else is work.
