# Shoal

A swarm of agents that use your app until it breaks.

Point it at your app running on localhost. It signs itself up, clicks around,
works out what the app does, and then hammers it. Leave it ten minutes and it
finds a few things. Leave it a day and it finds about everything it is going
to find.

You write nothing. No test files, no describing your app, no listing your
routes. A URL is the whole setup.

## Try it

```bash
npm install
npx playwright install chromium

# a deliberately broken app on :4100, with eleven known bugs in it
npm run fixture

# in another terminal
echo '{"url":"http://localhost:4100",
       "driver":{"provider":"openai-compatible","baseUrl":"http://localhost:11434/v1",
                 "model":"qwen3:1.7b","extra":{"reasoning_effort":"none"}}}' > shoal.config.json
npx tsx src/cli.ts doctor
npx tsx src/cli.ts run --for 30m
```

The dashboard is on <http://localhost:7717>. `shoal report` prints what it
found; `shoal bench` runs it against the fixture and scores itself.

Set `driver.provider` to `anthropic` (and `ANTHROPIC_API_KEY`) if you would
rather pay than run a model locally. Either way it only ever talks to
localhost.

## Status

Built and running. It signs itself up on an app it has never seen, maps it,
hammers it, and reports what reproduced. `fixtures/leaky/BENCH.md` is the
honest record: every score it has ever produced against an app whose bugs are
known in advance, including the ones it missed.

The repo history contains an earlier, different tool that was deleted on
purpose — see [docs/idea.md](docs/idea.md) for why.

## How it works

```
   http://localhost:3000
            │
            ▼
   SCOUT ── one agent. Slow, smart. Signs up, clicks around,
     │      works out what the app is. Writes to the MAP.
     ▼
   MAP ──── a file that grows. Pages, forms, fields, the API calls
     │      behind each button, what leads where.
     │      Run #10 starts where run #9 stopped.
     ▼
   CREW ─── many agents. Each gets a persona and a goal.
     │      "You are an impatient customer. Buy something."
     │      Uses the map, wanders off it when stuck.
     │
     ├────► RECORDER ── every request and response, per agent,
     │                  per account, timestamped
     ▼
   WATCHERS ─ dumb checks over the recordings. No LLM involved.
     │
     ▼
   REPLAY ── takes anything suspicious and re-runs it at HTTP
     │       speed, many times, concurrently. Did it happen again?
     ▼
   REPORT ── only the things that happened again.
```

## The six rules everything else follows from

1. **Localhost only.** Never production, never a live system, no exceptions.
2. **Agents find, dumb checks judge.** The LLM is never allowed to declare a bug.
3. **Browser to learn, HTTP to repeat.** Learning is slow and smart. Repeating
   is fast and stupid.
4. **Signup is the reset.** A fresh account is a fresh world. No database clone.
5. **There is no "run".** It is a queue that never empties. Stop it whenever.
6. **Never report the same thing twice.** Deduplication is load-bearing, not
   a nicety.

## Read next

- [docs/idea.md](docs/idea.md) — what this is for, and what it deliberately is not
- [docs/architecture.md](docs/architecture.md) — the pieces and how they fit
- [docs/finding-bugs.md](docs/finding-bugs.md) — how you catch bugs with no database access
- [docs/long-runs.md](docs/long-runs.md) — the queue, coverage, and what 24 hours buys
- [docs/stack.md](docs/stack.md) — what we build it in, and what we turned down
- [docs/config.md](docs/config.md) — the knobs and their defaults

The design proper:

- [docs/modules.md](docs/modules.md) — process model and the whole source tree
- [docs/schema.md](docs/schema.md) — the SQLite store, table by table
- [docs/scheduler.md](docs/scheduler.md) — the queue, the scoring, the starvation guard
- [docs/agent-loop.md](docs/agent-loop.md) — tools, personas, missions, surprise
- [docs/ai.md](docs/ai.md) — model tiers, providers, local models, cost, caching
- [docs/claude-code.md](docs/claude-code.md) — driving Shoal from Claude Code, and running the planner on a subscription
- [docs/recording.md](docs/recording.md) — interception, fingerprints, replay, hammering
- [docs/calibration.md](docs/calibration.md) — the fixture with known bugs, and `shoal bench`
- [docs/report.md](docs/report.md) — ranking, and what a finding looks like
- [docs/ui.md](docs/ui.md) — the dashboard ([mockup](docs/ui-mockup.html))
- [docs/cli.md](docs/cli.md) — commands, config, packaging, privacy
- [docs/build-order.md](docs/build-order.md) — six milestones, and the three that can kill it
- [docs/risks.md](docs/risks.md) — what will go wrong
- [docs/decisions.md](docs/decisions.md) — what is settled, and what changed on contact with the machine

**[docs/start-here.md](docs/start-here.md) — what to do on day one.**
