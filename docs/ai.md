# The AI layer

Where the intelligence comes from, what it costs, and what happens when it is
not there.

## Two tiers

| Tier | Job | Share of calls |
|---|---|---|
| **driver** | run the turn loop. Look at a page, pick one tool call | ~90% |
| **planner** | write missions from the map, and look at anything surprising | ~10% |

The driver does a dumb, repetitive, highly structured job: given a list of
elements, pick one and say what to type. The planner does the thinking.

Splitting them is the single biggest cost decision in the project, because the
driver is where all the volume is.

## Defaults

Anthropic first-party API rates, as of August 2026:

| | Model | Context | In / Out per 1M |
|---|---|---|---|
| driver | `claude-haiku-4-5` | 200K | $1.00 / $5.00 |
| planner | `claude-opus-5` | 1M | $5.00 / $25.00 |

`claude-sonnet-5` ($2 / $10, 1M) is the middle option if someone wants a
cheaper planner. Both tiers are config, and either can point at a different
provider entirely.

## What a day actually costs

Rough arithmetic, stated so it can be argued with. Assumes three explorers, a
turn every three seconds each, so about 3,600 turns an hour.

Per turn: roughly 3.5K input tokens (about 2K of it the stable prefix) and 150
output.

| | Input/hr | Cost/hr |
|---|---|---|
| naive, no caching, no fast path | 12.6M | ~$15 |
| with prompt caching | ~6.1M effective | ~$9 |
| hour twenty, fast path hitting 90% | ~0.6M | ~$1 |
| driver running locally | 0 | planner only, ~$1-2 |

A day comes out somewhere around **$30-50 on the default models**, and near
zero if the driver runs on a local model. That is the honest range, and it is
why the next two sections exist.

## The fast path — the biggest lever

Most turns should not call a model at all.

The map is a cache. Once we know that on screen `X`, the button named "New
invoice" leads to screen `Y`, an agent that wants to get to `Y` **just clicks
it**. No snapshot sent, no model call, no tokens.

Where the model is skipped entirely:

- **navigation through known ground** — the map already knows the route
- **filling a form we have seen** — field types are known, so values are
  generated in code. A number field gets `0`, `-1`, `999999`, `1.5`, empty.
  A model is not needed to think of those
- **repeating a known mission** — replay the recorded action sequence
- **anything a watcher, hammerer or confirmer does** — no model, ever

The model is called when the situation is **novel**: a screen fingerprint never
seen, a form whose fields we cannot type, a goal that has gone off the map.

The number to watch is **model calls per action**. It starts near 1.0 and
should fall toward 0.1 as the map fills. If it does not fall, the map is not
working and a long run will be unaffordable.

## Providers

One narrow interface. No framework, no LangChain, no abstraction over
abstractions.

```ts
interface Model {
  id: string
  call(req: {
    system: string
    messages: Message[]
    tools: ToolDef[]
    maxTokens: number
  }): Promise<{ tool?: ToolCall; text?: string; usage: Usage }>
}
```

Two adapters cover essentially everything:

**`anthropic`** — the official `@anthropic-ai/sdk`. Claude always goes through
this, never through an OpenAI-compatible shim, because the features that matter
here (strict tools, prompt caching, adaptive thinking) do not survive the
translation.

**`openai-compatible`** — one adapter, many backends. OpenRouter, Ollama,
LM Studio, vLLM, Groq, Together all speak the same shape. This is what makes
local models possible.

**`claude-code`** — runs the planner on a Claude subscription instead of API
billing, via the Agent SDK or the headless CLI. Full design, including the
`--bare` trap that silently turns it back into API billing, in
[claude-code.md](claude-code.md).

Each tier is configured independently, so the useful combination is available:

```
driver:  ollama / a small local model   — free, unlimited, runs all night
planner: claude-code                     — your subscription, thinks rarely
```

That combination has no API bill at all. It also has usage limits instead of a
price, which is a different constraint — see [claude-code.md](claude-code.md).

## Local models are a real option here, not a consolation

Worth being specific about why. The driver's job is:

> here are 14 interactive elements, here is the goal, call one tool

That is a small, structured, repetitive classification task with a fixed output
shape. It is close to the best case for a small local model, and it is the 90%.

If it works, a 24-hour run costs a few dollars instead of fifty, and the
"just leave it on" pitch becomes true for anyone with a decent machine.

What breaks with weak models, and what we do about it:

| Problem | Fix |
|---|---|
| bad at native tool calling | fall back to constrained JSON output plus a repair loop |
| invents element refs that do not exist | validate every ref against the snapshot; reject and re-ask |
| loops on the same action | already handled by the screen fingerprint stuck-detector |
| ignores long instructions | keep the system prompt short and the tool surface at nine tools |

The repair loop is capped at two attempts. Third failure and the turn falls
back to a code-driven choice — click the first unvisited link — which is worse
but never blocks.

## Tool calling

On Claude, tools are declared with `strict: true` plus
`additionalProperties: false` and a full `required` list. That guarantees the
tool input validates exactly and removes the whole class of malformed-argument
handling.

On weaker models, the same schema is used to validate by hand and to drive the
repair loop. One schema, two enforcement paths.

## What is in a turn

Fixed size. A turn never grows with the length of the run — that is what kills
long-running agents.

```
system prompt + tool defs        ~1.2K   stable, cached
persona + goal                   ~0.3K   stable per mission, cached
map excerpt for this screen      ~0.5K   changes
what I have done so far          ~0.3K   a rolling one-line-per-step summary
the page snapshot                ~1.2K   changes every turn
                                 ------
                                 ~3.5K
```

Two things are deliberately absent:

**No conversation history.** A rolling summary of the last few steps, not a
transcript. History is expensive, it drifts, and it makes runs impossible to
reason about.

**No whole map.** Only the part relevant to the current screen.

The snapshot itself is compressed before it is sent: interactive elements and
headings only, long tables truncated to a few rows plus a count, repeated rows
collapsed.

## Prompt caching

Order matters — the cache is a prefix match, and any byte change invalidates
everything after it. So the layout above is not cosmetic:

```
tools        stable  ─┐
system       stable   ├─ cached
persona      stable  ─┘
map excerpt   varies
summary       varies
snapshot      varies  <- most volatile, always last
```

Cache reads are about a tenth of the input price, which is where most of the
saving in the table above comes from. `usage.cache_read_input_tokens` is
recorded on every call; if it is zero across turns, something is silently
invalidating the prefix and the run just got nine times more expensive without
telling anyone.

## When the model layer fails

A 24-hour run must survive all of this without dying:

| Failure | Response |
|---|---|
| rate limited | back off, and lower the explorer count for a while |
| provider down | pause explorers, keep hammering and confirming — those need no model |
| context overflow | drop the map excerpt, then the summary, then fail the turn |
| malformed output | repair loop, twice, then a code-driven fallback |
| budget ceiling reached | stop issuing work that costs money, keep issuing work that does not |

The pattern is the same every time: **degrade to the free work rather than
stop.** The parts of Shoal that find the most valuable bugs — hammering and
confirming — do not need a model at all.

## Recording every call

Every model call is stored: worker, tier, model, prompt hash, input tokens,
cached tokens, output tokens, latency, which tool it chose, and whether it had
to be repaired.

That gives three things that are otherwise guesswork: what a run actually cost,
whether caching is working, and whether the fast path is improving. During M1
to M3 the full prompt is kept too, because debugging an agent without seeing
what it was sent is hopeless.

## The rules, restated for this layer

- **No model decides whether something is a bug.** The planner may write a
  suspicion. Only replay creates a finding.
- **No model in `watch/`.** If a check needs judgment it is not a check.
- **No model in `replay/`.** A repro that needs a model to reproduce is not a
  repro.
- **Temperature zero on the driver.** Our own random choices are seeded.
