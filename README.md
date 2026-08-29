# Shoal

**A swarm of agents that use your app until it breaks.**

Point it at your app on localhost. It signs itself up, clicks around, works out
what the app does, and then hammers it. Ten minutes finds a few things. A day
finds about everything it is going to find.

You write nothing. No test files, no describing your app, no listing your
routes, no fixtures, no credentials. A URL is the whole setup.

```bash
shoal run http://localhost:3000
```

Not on npm yet — [install from source](#try-it-in-two-minutes), it takes two
minutes.

---

## Why this is not another AI test generator

Most tools in this space ask a model whether something looks wrong. That
produces a report full of confident nonsense, and one bad finding costs more
trust than nine good ones earn.

Shoal splits the job in two, and the split is the entire design:

> **Agents find. Dumb checks judge.**

An agent that sees something odd files a *suspicion* — "I entered two lines of
650 and the total says 650". Nothing reaches the report. A confirmer then
replays the recorded HTTP, five times, **with no model involved at all**, and
only what reproduces becomes a finding. The agent is allowed to be wrong. That
is what the gate is for.

The second idea makes slow agents catch fast bugs:

> **The browser is for learning. HTTP is for repeating.**

An agent takes three seconds to click "Pay". Useless for races. But while it
clicks, Shoal records the request behind the button — so from then on that call
can be fired eight times inside the same millisecond, with no browser and no
model. The agent explores once; the swarm replays forever.

---

## What it actually finds

Every check below needs **zero** knowledge of what your app does, and none of
them require you to write anything.

| | Caught by |
|---|---|
| another account's data readable by id | a second account it signed up itself |
| a role reaching something it was not granted | a locked neighbour under the same path |
| a write accepted and silently dropped | reading it back through the app's own refetch |
| a stored figure disagreeing with its parts | the app's own numbers, compared |
| concurrent writes producing impossible state | a barrier volley, then read-back |
| a list that loses rows when you page it | walking every page and counting |
| a request that happens twice on one key | sending it twice on one key |
| 5xx, stack traces, SQL in a body, slow paths | the traffic alone |
| two endpoints disagreeing about one object | reading it both ways, back to back |

And one class no deterministic check can reach: an agent noticing that the
screen contradicts something it did three steps ago.

---

## Try it in two minutes

Requires **Node 20+**. Playwright downloads Chromium on first run.

```bash
git clone https://github.com/Aphrosidiac/Shoal && cd Shoal
npm install
npx playwright install chromium
```

Shoal needs a driver model. The cheapest good option is a small local one:

```bash
brew install ollama && ollama serve &
ollama pull qwen3:1.7b
```

```bash
cat > shoal.config.json <<'JSON'
{
  "url": "http://localhost:4100",
  "driver":  { "provider": "openai-compatible",
               "baseUrl": "http://localhost:11434/v1",
               "model": "qwen3:1.7b",
               "extra": { "reasoning_effort": "none" } },
  "planner": { "provider": "openai-compatible",
               "baseUrl": "http://localhost:11434/v1",
               "model": "qwen3:1.7b",
               "extra": { "reasoning_effort": "none" } }
}
JSON

npm run fixture          # a deliberately broken app on :4100
npm run shoal -- doctor  # checks the six things that ruin a run
npm run shoal -- run --for 30m
```

Watch it at **http://localhost:7717**. `npm run shoal -- report` prints what it
found.

> `"extra": {"reasoning_effort": "none"}` is worth more than any other line in
> that file. On `qwen3:1.7b` it takes a driver turn from 13 seconds to 1, for
> the same answer. Every local runtime has one knob like this and no two agree
> on its name, so `extra` is merged into the request body verbatim.

Prefer to pay rather than run a model? Set `ANTHROPIC_API_KEY` and use
`{"provider": "anthropic", "model": "claude-haiku-4-5"}`. Either way it only
ever talks to localhost.

---

## How it works

```
   http://localhost:3000
            │
            ▼
   SCOUT ── one agent. Signs itself up, clicks around, works out
     │      what the app is. Writes to the MAP.
     ▼
   MAP ──── pages, forms, fields, the API call behind each button,
     │      what leads where. Persistent — run #10 starts where #9
     │      stopped. Also a cache: most turns call no model at all.
     ▼
   CREW ─── many agents, each with a persona and a goal.
     │      "You submit the form twice because the first click felt slow."
     │
     ├────► RECORDER ── every request and response, per agent, per
     │                  account, per screen, per app build
     ▼
   WATCHERS ─ deterministic checks over the recordings. No LLM. Ever.
     │        They produce suspicions, never findings.
     ▼
   REPLAY ── re-runs it at HTTP speed, several times, sometimes eight
     │       at once behind a barrier. Did it happen again?
     ▼
   REPORT ── only what happened again, with the shortest repro that
             still fails, and a count instead of a thousand rows.
```

Everything is one queue that never empties, scored as
`base(kind) × novelty × staleness × tilt`. Nobody writes a phase schedule:
early on the map is mostly holes so exploring wins, and as they fill it tips
toward hammering on its own.

---

## The six rules everything else follows from

1. **Localhost only.** Never production, never a live system, no exceptions.
   Shoal refuses to start against anything else — that is what lets agents be
   genuinely reckless.
2. **Agents find, dumb checks judge.** No model may declare a bug.
3. **Browser to learn, HTTP to repeat.**
4. **Signup is the reset.** A fresh account is a fresh world. No database
   clone, no seed data, no fixtures.
5. **There is no "run".** A queue that never empties. Stop it whenever.
6. **Never report the same thing twice.** Three fingerprints — action, screen,
   finding — and deduplication is load-bearing, not a nicety.

---

## Running it from Claude Code

Shoal ships an MCP server, so Claude Code can operate it and confirmed findings
arrive in your session instead of a file you forget to open.

```bash
claude mcp add --scope user --transport stdio shoal -- npx shoal mcp
```

Then: *"start my dev server and point Shoal at it."* Tools are `shoal_start`,
`shoal_status`, `shoal_findings`, `shoal_finding`, `shoal_map`, `shoal_recheck`
and `shoal_stop`. Confirmed findings are pushed into the session as they are
confirmed, rather than waiting to be asked for.

The planner can also run on your Claude subscription rather than API billing
(`"planner": {"provider": "claude-code"}`), which closes the loop: a bug lands
in your session, you fix it, the dev server hot-reloads, Shoal notices the new
build and re-checks the finding by itself. Two traps on that path — `--bare`
silently refuses subscription credentials, and `ANTHROPIC_API_KEY` outranks the
OAuth token — are both hard failures in `doctor` rather than surprises on an
invoice. See [docs/claude-code.md](docs/claude-code.md).

---

## How we know it works

Shoal ships the app it is tested against: `fixtures/leaky/`, a small
orders-and-invoices app with **eleven planted bugs** — and, just as
importantly, **five behaviours that look wrong and are not**.

```bash
npm run shoal -- bench --for 30m --label "what changed"
```

starts it fresh, runs against it, and prints five numbers:

```
found            <n> of 11
missed           #1 (race), #10 (needs seasoning), ...
false positives  0
wall clock       30m
model calls      212        (0.07 per action)
spend            $0.00
```

Real numbers live in [BENCH.md](fixtures/leaky/BENCH.md), one entry per run,
because a composite of the best half of two different runs is not a
measurement. The best so far is **6 of 11 with zero false positives**, and
separately a run that held **0.07 model calls per action** against a 0.10
target — the number that says whether the map is doing its job as a cache.

Every one of those five can move in the wrong direction and each says something
different. **A change that raises `found` and also raises `false positives` is
not an improvement** — recall on its own is a vanity metric, which is why the
fixture contains a correctly serialising write, a correctly locked endpoint and
a correctly paged list for Shoal to *not* report.

The whole history, including the runs where it did worse, is in
[fixtures/leaky/BENCH.md](fixtures/leaky/BENCH.md). Six false positives were
found and killed during the build; each is written down in
[docs/decisions.md](docs/decisions.md) with what it cost.

---

## Commands

```
shoal run <url>          start a run, or continue the one in this directory
shoal status             what is happening right now
shoal ui                 the dashboard (default :7717)
shoal report [--open]    regenerate report.md, report.txt and report.html
shoal findings [id]      list findings, or show one in full
shoal recheck <id>       re-run one finding against the app as it is now
shoal map                what it knows about the app, untouched things first
shoal stop               stop, leaving everything on disk
shoal reset [--all]      clear findings and traffic; --all clears the map too
shoal doctor             check the setup before wasting a run on it
shoal bench              score against the calibration fixture
shoal mcp                run as an MCP server on stdio
```

`run` on a directory that already has a run **continues** it — throwing away a
day of mapping should not be one keystroke. Everything Shoal writes lives in
`.shoal/`, so deleting that removes it completely.

Full flags and configuration: [docs/cli.md](docs/cli.md) ·
[docs/config.md](docs/config.md)

---

## What it will not do

Worth knowing before you point it at something.

- **It will not run against anything but localhost.** Not a staging box, not a
  VPN'd internal host. This is not a setting.
- **It cannot get into an OAuth-only or invite-only app.** It needs a signup
  form with an email and a password. If your app verifies email, point its SMTP
  at `localhost:1025` and it reads its own verification links.
- **It needs a model.** A small local one is enough for ~90% of the calls; the
  planner is used rarely.
- **It is slow by nature, and that is the design.** Ten minutes is a smoke
  test. The interesting things — a list too big to page correctly, a query that
  is only slow once there are rows — cannot exist until it has spent hours
  putting data in.
- **A clean report means nothing without the coverage section.** An app where
  every write is being refused looks exactly like an app with no bugs, which is
  why starvation is printed *above* the verdict and never below it.

### Where it stands

Built and running end to end. The best measured score is above; the numbers in
`BENCH.md` are every run, not the flattering ones.

Two gates are honestly still open, and both are written up rather than papered
over. The 24-hour unattended run has not been done. And the local-model gate is
half-measured: the machine this was built on has no `ANTHROPIC_API_KEY`, so the
gap between a small local driver and a good model — the whole point of that
gate — is still unmeasured. One command closes it, and it is at the top of
`BENCH.md`.

---

## Privacy

Recordings contain whatever is in your dev database, and all of it stays in
`.shoal/run.db` on your machine. Two things reach a network: the driver and the
planner, which are sent page snapshots — structure plus visible text. Run with
`--redact` to scrub values from sensitive-looking fields before anything is
stored or sent, or point both tiers at a local model and nothing leaves at all.

---

## The design

Written before the code, and corrected where the code proved it wrong.

| | |
|---|---|
| [idea.md](docs/idea.md) | what this is for, and what it deliberately is not |
| [architecture.md](docs/architecture.md) | the pieces and how they fit |
| [finding-bugs.md](docs/finding-bugs.md) | catching bugs with no database access |
| [long-runs.md](docs/long-runs.md) | the queue, coverage, what 24 hours buys |
| [scheduler.md](docs/scheduler.md) | scoring, leases, the starvation guard |
| [agent-loop.md](docs/agent-loop.md) | the nine tools, personas, missions, surprise |
| [recording.md](docs/recording.md) | fingerprints, replay, hammering, shrinking |
| [ai.md](docs/ai.md) | model tiers, providers, local models, cost, caching |
| [claude-code.md](docs/claude-code.md) | MCP, the channel, and the subscription traps |
| [calibration.md](docs/calibration.md) | the fixture, and `shoal bench` |
| [report.md](docs/report.md) | ranking, and what a finding looks like |
| [ui.md](docs/ui.md) | the dashboard ([mockup](docs/ui-mockup.html)) |
| [modules.md](docs/modules.md) · [schema.md](docs/schema.md) | the source tree and the store |
| [cli.md](docs/cli.md) · [config.md](docs/config.md) | commands, knobs, packaging |
| [risks.md](docs/risks.md) | what will go wrong |
| **[decisions.md](docs/decisions.md)** | **every decision, and the sixteen the build corrected** |

The repo history contains an earlier, different tool that was deleted on
purpose — [idea.md](docs/idea.md) says why.

---

MIT. It is a developer tool that only ever talks to localhost; open source is
the only version of it anybody should trust.
