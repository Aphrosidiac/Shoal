# The dashboard

`shoal ui` — or automatically, on `shoal run`, unless `--no-ui`.
`http://localhost:7717`.

A mockup with realistic data is at [ui-mockup.html](ui-mockup.html). Open it in
a browser; it is the reference the real thing gets built against.

## The flow

The dashboard is the front door. `shoal ui` in a directory — no run needed —
and the Overview is a form: a URL, a duration, a Jev budget, and — only if
the app has no sign-up — an account to sign in with. One green button. That spawns `shoal run` detached (`--no-ui`, because this is the
UI) and the header carries the run state on every page: *running · 9m left*
and a Stop button, or *Report* and *Run again* once it ends.

The rail is grouped by what a person came to do, the way ANK Ops' is:

| | | |
|---|---|---|
| **Run** | Overview | KPI strip (findings, screens judged, coverage, spend) → *Do these first* and *Not looked at yet* → Agents and the Judge in the right column |
| | Live | the filmstrip: every judged screen with its picture, the action that led there, what Jev chose next, the top probabilities, the verdicts; click for the whole contract |
| **Results** | Findings | two-pane: the list with kind and reproduction, the detail with evidence pictures, the repro steps and a Recheck button |
| | Suspicions | two-pane: what looked wrong, what happened when it was checked, the trail a confirmer replays |
| **Coverage** | Map, Accounts | untouched first |
| **System** | Reports | one report per run — findings first seen in that run, screens judged, suspicions, spend — with the HTML and Markdown written when it ended as exports (`.shoal/reports/run-N.*`) |
| | Log | the run's own words, live |

## The language

ANK Ops', carried value for value (`src/ui/css.ts`): one warm ground shared
by rail, head and page; white cards with a hairline and a soft lift; the
primary action is charcoal; the green is the active nav item and the one
obvious next step on a page and carries ink, never white; status is a tinted
chip with regular-weight text; table headers are sentence-case grey; Inter
14/20. Hand-rolled, no build step.

## What it is for

Three questions, and it exists to answer them in the order you actually ask
them:

1. **Is it alive and doing something useful?** — the first ten seconds
2. **What has it found?** — the reason you left it on
3. **What has it not looked at yet?** — whether a clean run means anything

And since the rebuild, a fourth that the other three depend on:

4. **What did the judge see, and what did it say?** — every screen, with a
   picture, the action that led there, the probability of every question in
   the contract, and what code made of it. A verdict you cannot inspect is
   a verdict you cannot trust.

Everything else is secondary.

## How it is built

Served by the Shoal process itself. Plain HTML, CSS and a little vanilla
JavaScript. **No framework, no bundler, no build step.**

That is a decision, not laziness. This is a dev tool that must start reliably
at 2am on someone else's machine; a dashboard that can fail to compile is a
dashboard that stops you shipping. The files are served as they are written.

Live updates over Server-Sent Events from the same SQLite file the workers
write to. If the stream drops, the page falls back to polling every few
seconds and says so rather than quietly going stale.

Read-only, with three exceptions: start, stop, and recheck a finding.

## Steps and Suspicions

**Steps** is a filmstrip, newest first. One card per judged screen: the
screenshot the agent was looking at, who it was and in which account, the
action that led there, the screen kind Jev assigned, the operation and target
Jev chose next (in a mission) with its confidence, the four highest
probabilities from the contract as bars, and the verdicts that fired as
badges. The footer is the cost of that step in tokens and milliseconds. Click
the picture for the full request: every question and its probability, the
operation distribution, what was entered, the goal.

The list is not redrawn under the reader. New steps slide in at the top only
while the view is scrolled to the top; otherwise a pill counts them.

**Suspicions** is the pipeline: open (being walked again), confirmed,
unreproduced. Each carries what was expected and observed, the screen, and
the trail — the steps a confirmer replays in a fresh account, as a user
would see them.

The **Judge** strip on Now: screens judged and per minute, how many fired,
suspicions by state, rewalks, Jev's median latency and spend. Under it, the
latest verdicts as thumbnails.

Every step is a row in the `steps` table and a JPEG in `.shoal/shots/`; both
are off with `--no-ui`.

## The five views

### Now

The default, and the one you leave open on a second monitor.

- **A counter strip** across the top: pages, endpoints, hammered, findings,
  accounts, frontier, spend, uptime
- **The explorers**, one card each — which account it is using, which page it is
  on, what it did last, and whether it is thinking or acting. If an explorer is
  stuck, you see it here first
- **A live request feed** — method, path, status, milliseconds, which worker.
  Non-2xx tinted. This is the heartbeat; if it stops moving, something is wrong
- **What the hammerers are doing** — which endpoint, which collision shape, how
  many workers

### Findings

The report, live. Ranked as in [report.md](report.md), with the category and the
reproduction ratio visible in the list rather than hidden behind a click.

Click one and it opens with the full repro, the recordings behind it, its
history, and a **Recheck** button that re-runs it against the app as it is right
now. That button is what makes the fix loop feel immediate: change the code,
press it, watch the finding go green.

Below a rule, unconfirmed suspicions, one line each, collapsed.

### Map

What Shoal knows about the app, and — more usefully — what it does not.

- endpoints, with method, calls, statuses seen, and a bar for hammered/not
- pages, with visit counts and whether they are fully explored
- forms and their fields, with how many classes of value have been tried

Sorted so the **untouched things are at the top**. A dashboard that shows you
what you have covered is flattering; one that shows you what you have missed is
useful.

### Accounts

Every account Shoal made, its role, when it was created, and what it has been
used for. Also where the tenancy verdict lives — whether accounts can see each
other's data, which decides whether a leak is a bug or a fact about this app.

### Log

Restarts, starvation, rate limits, budget ceilings, stuck agents, replay
failures. Everything that made a run less than it appears.

Starvation entries are pinned to the top and coloured, because a swarm being
refused is the single most misleading thing that can happen and it must never
be something you have to scroll for.

## Design

Dark, dense, monospace for anything that is data. It sits next to a terminal
and an editor and should not look like a marketing page.

One accent colour, used only for things that are live. Severity has its own
small palette and nothing else is allowed to use those colours.

No animation except the request feed moving, because a page that animates for
twenty-four hours is a page you close.

## What it is not

Not a control panel. You cannot edit config, write checks, or change scoring
from it — those live in the config file where they can be committed.

Not a viewer for the browser sessions. Watching an agent click is fun for
ninety seconds and then it is a video player nobody uses. The request feed says
the same thing in a form you can actually read.
