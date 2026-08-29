# Module layout

## Process model

**One Node process. One SQLite file. Everything async inside it.**

Playwright manages the browser as its own child process; we run one browser
with N contexts, one per explorer. The HTTP workers are ordinary async tasks —
hammering is IO-bound, so there is nothing to gain from threads or extra
processes.

SQLite runs in WAL mode, which means a second process could read the file while
a run is in progress. That is how `shoal report` and `shoal status` work while
the swarm is going.

If we ever outgrow one process, WAL already allows a second writer process and
the queue is already lease-based. Nothing in the design has to change. We just
do not start there.

## The tree

```
src/
  cli.ts                 commands: run, status, report, map, reset
  config.ts              knobs, defaults, validation
  supervisor.ts          boots everything, owns the lifecycle, handles shutdown

  store/                 the ONLY code that touches SQLite
    db.ts                open, WAL, pragmas, busy_timeout
    schema.sql           the tables
    migrate.ts           versioned migrations
    repo/
      run.ts  map.ts  accounts.ts  recordings.ts
      queue.ts  suspicions.ts  findings.ts  coverage.ts  spend.ts

  target/                knowing the app under test
    probe.ts             is it up, what is it, SPA or server-rendered
    watch.ts             notices crashes and restarts
    version.ts           an app fingerprint, so findings are stamped

  browser/               the Playwright layer
    pool.ts              one browser, N contexts, checkout/checkin
    session.ts           a context + an account + a recorder. an agent's hands
    snapshot.ts          accessibility tree -> compact text with stable refs
    act.ts               click, type, select, press, goto, back
    observe.ts           what is actionable here
    extract.ts           structured read of a page
    record.ts            network interception -> recordings table

  model/                 where the intelligence comes from
    index.ts             the Model interface. one function, three adapters
    anthropic.ts         official SDK. strict tools, prompt caching
    openai-compat.ts     OpenRouter, Ollama, LM Studio, vLLM
    claude-code.ts       Agent SDK query(), CLI subprocess as fallback
    repair.ts            schema validation + two-attempt repair for weak models

  mcp/                   Shoal as a tool Claude Code can operate
    server.ts            stdio MCP server
    tools.ts             start, status, findings, finding, map, recheck, stop
    channel.ts           pushes confirmed findings into a live session

  agent/                 the LLM part
    loop.ts              look -> decide -> act -> record, until done or stuck
    tools.ts             the small tool surface the model is given
    prompts/             system prompts, one per role
    scout.ts             the explorer
    crew.ts              the mission runner
    personas.ts          behaviours, not demographics
    missions.ts          goals, generated from the map
    surprise.ts          filing a suspicion

  map/                   the model of the app, built from outside
    pages.ts  forms.ts  endpoints.ts  edges.ts
    normalise.ts         /invoices/8123 -> /invoices/:id
    fingerprint.ts       action, screen and finding fingerprints

  signup/                accounts
    identity.ts          random email, password, name
    signup.ts            drive a signup flow from the map
    mail.ts              SMTP catcher on :1025, reads verification links
    vault.ts             store and reuse accounts

  queue/                 the work
    kinds.ts             the item types and their payloads
    score.ts             the scoring function
    scheduler.ts         pull, lease, retry, backoff, starvation guard
    workers/
      explore.ts         look at a page never seen
      form.ts            fill a form with an untried class of value
      mission.ts         chase a goal end to end
      hammer.ts          fire a recorded call from N workers at once
      confirm.ts         replay a suspicion and decide
      crossaccount.ts    replay a recording as a different account

  watch/                 the dumb checks. no LLM anywhere in here
    faults.ts            5xx, error-in-a-200, stack traces, slow responses
    readback.ts          did the write actually take
    crossaccount.ts      tenant and role leaks
    listwalk.ts          paging loses or repeats rows
    idempotency.ts       same request twice
    reversible.ts        do and undo
    index.ts             the registry every recording is passed through

  replay/
    request.ts           re-fire one recording, with token refresh
    barrier.ts           hold N requests, release them together
    shrink.ts            cut a repro down to the smallest thing that still fails
    verdict.ts           N attempts -> reproduced or not

  report/
    build.ts             regenerate from the store
    render.ts            html and markdown
    dedupe.ts            fold repeats into counts

  budget/
    meter.ts             tokens and dollars spent, per worker
    throttle.ts          pacing at the app, and self-limiting to the ceiling
```

## The rules about this tree

**Only `store/` touches SQLite.** Everything else goes through a repo. This is
what keeps a 24-hour run debuggable.

**Nothing in `watch/` may call a model.** If a check needs judgment, it is not
a check — it belongs in `agent/` and it produces a suspicion instead.

**Nothing in `agent/` may write to `findings`.** Agents write suspicions. Only
`replay/verdict.ts` promotes a suspicion to a finding.

**`browser/record.ts` runs under every session, always.** There is no mode where
an agent acts without being recorded, because the recording is the product.
