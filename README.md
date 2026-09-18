# Shoal

**A swarm that uses your app in the browser and reads every screen for bugs.**

Point it at your app on localhost. It signs itself up, walks every screen,
works out what the app does, then sends in a crew with goals and bad habits —
the one who double-clicks Pay, the one who types −1, the one who leaves a
required field empty. After every action, every screen is judged against a
contract of what a screen may not do. Ten minutes finds a few things. A day
finds about everything it is going to find.

You write nothing. No test files, no describing your app, no listing your
routes, no fixtures, no credentials. A URL and a
[TypeSafe](https://typesafe.ai) key are the whole setup.

```bash
shoal run http://localhost:3000
```

Not on npm yet — [install from source](#try-it-in-two-minutes), it takes two
minutes.

---

## Why this is not another AI test generator

Most tools in this space ask a language model whether something looks wrong.
That produces a report full of confident nonsense, and one bad finding costs
more trust than nine good ones earn. The first version of Shoal reacted by
banning models from judging anything at all — and found only what an `if`
statement can prove from HTTP traffic. Backend bugs. Not one thing you would
see on a screen.

This version uses a different kind of model for the judging, and the
difference is the design:

> **Agents find. Calibrated judgments filter. Reproduction decides.**

The judge is [Jev](https://docs.typesafe.ai/introduction), a System One model.
It does not write. Send it a screen and a typed question — *does this screen
show two facts about one record that cannot both be true?* — and it returns a
calibrated probability, in about 300 ms, for a fiftieth of a cent. Thirty
questions about one screen cost the same round trip as one. Every answer is a
number code can threshold, not a paragraph code has to believe.

A probability above 0.85 files a *suspicion*. Nothing reaches the report. A
confirmer then walks the same steps again **in a brand new account** and asks
the same question of the same screen, twice, and only what holds every time
becomes a finding. HTTP suspicions are still replayed at HTTP speed, eight at
once behind a barrier, with no model involved — the race-catching half of the
old design is intact. It just stopped being the only half.

And where the answer is a comparison, a count, a number or a date, there is no
model at all. Jev is asked whether the phone number is *shown*; code decides
whether the one shown is the one that was typed.

---

## What it actually finds

Every check below needs **zero** knowledge of what your app does, and none of
them require you to write anything.

**Through the screen** — judged after every action, confirmed by walking it
again in a fresh account:

| | Caught by |
|---|---|
| a Save that does nothing | no change, no request, and a judgment that a user expected one |
| "Saved." on a request that failed | the recorder's status and the screen's word, side by side |
| a value accepted and shown differently afterwards | Jev says the field is shown; code says it is not that value |
| "Saved." over a list that was never refreshed | the list, counted, and the confirmation, read |
| a status and a control that cannot both be true | one question, one probability |
| a refused form that wipes what was typed | field values before and after, with an error on screen |
| a validation message about the wrong field, or a field the form does not have | two questions over `entered` and `messages` |
| a link that opens the wrong screen | the label and the heading, compared |
| `undefined`, `NaN`, `{{template}}`, a stack frame, lorem ipsum | a regex, then a judgment for the ones a regex cannot name |
| a screen that never finishes loading | the network went quiet and "Loading…" is still the content |
| an ordinary click that lands on the login page | a password field that was not there before |
| user input rendered as HTML | a `<tag>` typed in, and the text came back without it |

**Through the traffic** — replayed at HTTP speed, no model:

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

---

## Try it in two minutes

Requires **Node 20+**. Playwright downloads Chromium on first run.

```bash
git clone https://github.com/Aphrosidiac/Shoal && cd Shoal
npm install
npx playwright install chromium
```

Shoal drives and judges with [TypeSafe Jev](https://docs.typesafe.ai). Get a
key from [console.typesafe.ai](https://console.typesafe.ai) and put it in
`.env`:

```bash
echo 'TYPESAFE_API_KEY=...' > .env

cat > shoal.config.json <<'JSON'
{ "url": "http://localhost:4100", "jev": { "maxUsd": 1 } }
JSON

npm run fixture          # a deliberately broken app on :4100
npm run shoal -- doctor  # checks the six things that ruin a run
npm run shoal -- run --for 30m
```

Watch it at **http://localhost:7717**. `npm run shoal -- report` prints what it
found.

`maxUsd` is a hard stop for the run directory. A step costs about 3,000 input
tokens and Jev charges $0.042 per million of them, so a dollar is roughly eight
thousand judged screens. There is no local-model option: the judging depends
on calibrated probabilities, and that is what Jev is trained for. The only
thing that leaves your machine is the visible text and control table of your
app's screens.

To measure the judge on its own before trusting it with a run:

```bash
npx tsx src/bench/judge.ts   # every planted screen bug and non-bug, judged, for about a cent
```

---

## How it works

```
   http://localhost:3000
            │
            ▼
   SCOUT ── signs itself up and walks every untried link, in code.
     │      Jev reads each screen and says what kind it is. Writes the MAP.
     ▼
   MAP ──── pages, forms, fields, the API call behind each button,
     │      what leads where. Persistent — run #10 starts where #9 stopped.
     │      Missions are written from it by code: "make one, check it is there."
     ▼
   CREW ─── many agents, each with a persona and a goal. One Jev request
     │      per step: which control advances the goal (a closed set, never
     │      a string), what kind each field is (code picks the value), and
     │      thirty questions about what the last action did to the screen.
     │
     ├────► RECORDER ── every request and response, per agent, per
     │                  account, per screen, per app build
     ▼
   JUDGE ── code first (a regex, a count, a status against a message),
     │      then Jev's probabilities, thresholded. Suspicions, never findings.
   WATCHERS ─ deterministic checks over the recordings. No model. Ever.
     ▼
   CONFIRM ─ an HTTP suspicion is replayed at HTTP speed, eight at once
     │       behind a barrier. A screen suspicion is walked again in a fresh
     │       account and judged again. Did it happen every time?
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
2. **Agents find, calibrated judgments filter, reproduction decides.** No
   generative model may declare a bug. A typed probability may file a
   suspicion; only a second walk or a replay can confirm one.
3. **Anything code can compute, code computes.** Jev is never asked to count,
   compare a number, read a date, or write a value.
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

An optional generative planner can write extra missions on your Claude
subscription (`"planner": {"provider": "claude-code"}`); missions are written
from the map by code without one. The loop it closes: a bug lands in your
session, you fix it, the dev server hot-reloads, Shoal notices the new build
and re-checks the finding by itself. See [docs/claude-code.md](docs/claude-code.md).

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
- **It needs a TypeSafe key.** The judging depends on calibrated
  probabilities, and Jev is the model trained for them. There is no local
  option.
- **It reads text, not pixels.** Overlap, overflow, contrast and colour are
  not judged. That is a different piece of work.
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
`.shoal/run.db` on your machine. One thing reaches a network: Jev, which is sent
page snapshots — headings, messages, the control table and visible text. Run with
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
