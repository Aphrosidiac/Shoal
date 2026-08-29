# Claude Code integration

The goal: open Claude Code, tell it to start the dev app and start Shoal, and
have the expensive thinking run on a Claude subscription while the cheap
grinding runs on a local model. No API bill.

That is three separate connections, and it is worth being precise about which
is which, because Claude Code appears twice in the picture doing two different
jobs.

## The topology

```
  ┌─ Claude Code — your session ──────────────────────────────┐
  │                                                            │
  │   MCP tools  ─────────────────►  Shoal daemon              │
  │   "start shoal against :3000"    (start, status, findings) │
  │                                                            │
  │   channel    ◄─────────────────  Shoal daemon              │
  │   "confirmed bug #7"             (pushed, not polled)      │
  └────────────────────────────────────────────────────────────┘

  ┌─ Shoal daemon ────────────────────────────────────────────┐
  │                                                            │
  │   driver tier   ──►  Ollama on :11434      free, ~90%      │
  │   planner tier  ──►  Claude Code           subscription,   │
  │                      (spawned, separate)   ~10%            │
  │   browser + hammerers ──►  your app on :3000               │
  └────────────────────────────────────────────────────────────┘
```

**Claude Code is in there twice.** Once as the *operator* — your session,
driving Shoal through MCP tools. Once as the *planner* — a separate headless
process that Shoal spawns when it needs to think.

They are different processes. They share one subscription quota. That matters,
and it is the main constraint on the whole design — see Limits below.

## 1. Shoal as an MCP server — the operator surface

A stdio MCP server, installed once:

```bash
claude mcp add --scope user --transport stdio shoal -- npx shoal mcp
```

Tools it exposes:

| Tool | Does |
|---|---|
| `shoal_start` | start a run against a URL, with knobs |
| `shoal_status` | coverage, frontier size, spend, what it is doing now |
| `shoal_findings` | confirmed findings, newest first |
| `shoal_finding` | one finding in full, with its repro |
| `shoal_map` | what it knows about the app |
| `shoal_recheck` | re-run one finding's repro right now |
| `shoal_stop` | stop the run, leave the file |

So the workflow you described is one sentence to Claude Code: *start my dev
server and point Shoal at it.* Claude Code runs your dev server itself and
calls `shoal_start`.

## 2. The channel — findings arrive without being asked for

Claude Code supports MCP **channels**: a server can push messages into a live
session. Installed with one extra flag:

```bash
claude mcp add --channels --scope user --transport stdio shoal -- npx shoal mcp
```

Now a confirmed finding lands in your Claude Code conversation the moment it is
confirmed, while you are working. No polling, no watching a terminal, no
remembering to go and look.

This is the part that makes it fit a real workflow rather than being another
dashboard you forget to open.

## 3. Claude Code as the planner tier

A third provider adapter alongside `anthropic` and `openai-compatible`:

```
driver:  openai-compatible -> ollama         free
planner: claude-code                          subscription
```

Two ways to call it, both running on the same credentials:

**Agent SDK** (preferred — we are already TypeScript):

```ts
import { query, startup } from "@anthropic-ai/claude-agent-sdk"

// pre-warm once at boot so a planner call is not paying startup latency
const warm = await startup({ options: { model: "claude-opus-5" } })

for await (const m of warm.query(prompt, {
  maxTurns: 1,
  disallowedTools: ["Bash", "FileEditor", "FileViewer"],
})) { ... }
```

`maxTurns: 1` and no tools makes it a plain "give me an answer" call rather
than a filesystem agent, which is all the planner needs.

**CLI subprocess** (fallback, no dependency):

```bash
claude -p "<prompt>" --output-format json --json-schema '<schema>'
```

`--json-schema` gives us the structured-output guarantee that `strict: true`
gives us on the API path, so the planner returns a validated object either way.

### The trap: never pass `--bare`

`--bare` looks appealing for a daemon — it skips hooks, skills, MCP and
auto-memory, which is exactly what you want for a clean programmatic call.

**It also refuses to read subscription OAuth credentials.** In bare mode only
`ANTHROPIC_API_KEY` or an `apiKeyHelper` works, which is the precise opposite
of the thing we are trying to do. Bare mode turns "free" into "billed at API
rates" silently.

So: no `--bare` on the planner path, ever, and a startup check that asserts
which credential source is actually in use before a run begins.

### Auth for a daemon

An interactive `/login` works while you are sitting there. For something meant
to run overnight, generate a long-lived token once:

```bash
claude setup-token          # one-year OAuth token
export CLAUDE_CODE_OAUTH_TOKEN=...
```

Credential precedence puts `ANTHROPIC_API_KEY` **above** the OAuth token, so if
that variable is set anywhere in the environment the daemon will quietly bill
you at API rates. Shoal should refuse to start in `claude-code` mode with
`ANTHROPIC_API_KEY` set, and say why.

## Limits — the real constraint

A subscription is not an unmetered API. There is a rolling five-hour session
limit, a weekly limit, and separate per-model quotas. Rate-limit 429s retry
automatically; spend-limit failures do not retry at all.

And remember both Claude Codes share one quota. If you are actively coding
while Shoal's planner is thinking, you are competing with yourself.

Three consequences, all of which the design already leans toward:

**Planner calls must be rare.** Not per turn — per mission, and per *batch* of
suspicions rather than per suspicion. In `claude-code` mode the budget knob
stops being dollars-per-hour and becomes **planner calls per hour**, defaulting
low.

**Hitting a limit must not stop the run.** This is the rule we already have:
degrade to the free work. Explorers pause, hammerers and confirmers carry on,
and the event is logged so the report can say "planner was limited from 14:00
to 19:00" instead of silently going shallow.

**Say it out loud.** Whether an automated overnight daemon on a personal
subscription is within your plan's terms is your call, not Shoal's — but the
tool should never hide what it is doing. `shoal_status` reports which credential
source is live and how many planner calls have been made.

## What this unlocks: the fix loop

The reason to do all of this rather than just paying for API calls.

Claude Code is already in your repo, with your files, in your session. Shoal is
already watching your dev server. So:

```
Shoal confirms a bug
   │
   ▼  pushed into your session over the channel
Claude Code reads the repro, finds the cause, edits the code
   │
   ▼
dev server hot-reloads
   │
   ▼  Shoal notices the restart, stamps a new app version
Shoal re-runs that finding's repro
   │
   ▼
fixed → the finding closes itself, with proof
```

Nothing in that loop needed you except to say yes.

And the machinery for the last step already exists in the design for other
reasons: findings are stamped with an app version, restarts are logged, and
findings that stop reproducing after a restart are marked rather than deleted.
The fix loop is those three things pointed at each other.

## What is not possible

**MCP sampling.** The clean version of this would be Shoal-as-MCP-server asking
your Claude Code session to run a completion on its behalf — one connection
instead of two, sharing your session's context. Claude Code does not document
support for `sampling/createMessage`, so we spawn a separate headless process
instead. If that ever lands, the planner adapter collapses into the MCP server
and this document gets shorter.

## Where it lands in the build

| | |
|---|---|
| `claude-code` planner adapter | **M1**, alongside the other two. It is a third adapter |
| MCP operator surface | **M3**, when there are findings worth reading |
| The channel push | **M3**, same reason |
| The fix loop | **M6**, once findings carry a minimal repro worth acting on |
