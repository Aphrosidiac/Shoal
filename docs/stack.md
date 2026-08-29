# Stack

Researched 29 August 2026. The brief was "whatever gives the best
implementation", not "whatever is quickest".

## The decision

**Node + TypeScript, Playwright, SQLite, the Anthropic SDK, and our own thin
agent loop. No agent framework.**

## Why each part

**Playwright, and specifically the TypeScript one.** TypeScript is the native
implementation; the Python and Go bindings are ports and get features later.
Shoal uses Playwright in an unusual way — network recording running underneath
an agent loop, across dozens of logged-in browser contexts at once, for
twenty-four hours. That is the kind of thing you want on the native binding.
Playwright also gives the browser, the network interception and the parallel
contexts in one library instead of three.

**The accessibility tree, never screenshots.** A snapshot of the page as an
accessibility tree is roughly 2–5KB. A screenshot of the same page is 100KB or
more — [twenty to fifty times the token
cost](https://qaskills.sh/blog/playwright-mcp-accessibility-snapshots-reference).
Over a day-long run that is the difference between viable and absurd. It is also
how every serious agent drives a browser now.

**SQLite, one file.** See [long-runs.md](long-runs.md). `better-sqlite3`.

**One language, including for the hammering.** Go or Rust was considered for the
concurrent HTTP part. Not worth it: hammering is IO-bound, Node's event loop
handles it, and a second language doubles maintenance for no real gain.

## What we turned down

**[browser-use](https://github.com/browser-use/browser-use)** — the biggest
LLM browser agent library, around 100k stars. Rejected on shape, not quality:
it is Python, and it *takes over* the browser. The agent loop owns everything
and the network layer is abstracted away. For Shoal the network recording **is
the product**.

**[Stagehand](https://github.com/browserbase/stagehand)** — TypeScript, sits on
real Playwright, and its three verbs (`act`, `observe`, `extract`) are exactly
the right shape. Not taken as a dependency because it is built for "do this one
task well", not "explore an app forever and remember everything". Our browser
layer has to be fused with recording, fingerprinting and coverage, and no
library knows about those. Copy the verbs, skip the dependency — it is about
three hundred lines.

**[CAMEL](https://github.com/camel-ai/camel)** — the inspiration, not a
dependency. It is a Python research framework for agent societies and world
simulation. Taking the code would drag the whole project into Python for
something we would write ourselves anyway. Same reasoning for
[MiroFish](https://github.com/666ghj/MiroFish), which is Python because it is
built on OASIS for social simulation. We are not simulating a world; we are
beating on a real one.

**Any agent framework at all.** The loop is: snapshot the page, ask the model
what to do, do it, record what happened. Writing that ourselves is smaller than
learning someone else's abstraction, and every one of them would fight the
recording layer.

## Two model tiers

- a **cheap, fast model** for driving the browser — this is the bulk of the calls
- a **good model** for planning goals and for looking at anything surprising

Sources:
[Playwright best practices](https://playwright.dev/docs/best-practices) ·
[browser agent comparison 2026](https://www.nxcode.io/resources/news/stagehand-vs-browser-use-vs-playwright-ai-browser-automation-2026) ·
[accessibility snapshots reference](https://qaskills.sh/blog/playwright-mcp-accessibility-snapshots-reference)
