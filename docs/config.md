# Configuration

Setup is a URL. Everything below has a default and exists only because how hard
Shoal pushes depends on the machine it is on and how much the developer wants
to spend.

## The knobs

| Knob | Default | What it costs |
|---|---|---|
| `explorers` | 3 | browser agents. Heavy — RAM, CPU, and most of the LLM bill |
| `hammerers` | 16 | pure HTTP workers. Nearly free. This is what finds races |
| `confirmers` | 2 | replay suspicions to see if they are real. Nearly free |
| `driverModel` | cheap and fast | clicking around. The bulk of the calls |
| `plannerModel` | good | goals, and looking at anything surprising |
| `budgetPerHour` | none | optional ceiling in dollars or tokens. It paces itself to fit |
| `pace` | sensible | maximum requests per second at the app, so the dev server survives |
| `mailPort` | 1025 | the local SMTP catcher agents read verification links from |

## Models and providers

Each tier is configured independently and either can point at a different
provider. Full reasoning in [ai.md](ai.md).

| Knob | Default | Notes |
|---|---|---|
| `driver.provider` | `anthropic` | or `openai-compatible` for OpenRouter, Ollama, LM Studio, vLLM |
| `driver.model` | `claude-haiku-4-5` | $1 / $5 per 1M. About 90% of all calls |
| `planner.provider` | `anthropic` | |
| `planner.model` | `claude-opus-5` | $5 / $25 per 1M. `claude-sonnet-5` is the cheaper option |
| `driver.baseUrl` | — | e.g. `http://localhost:11434/v1` for Ollama |
| `planner.provider` = `claude-code` | — | runs the planner on your Claude subscription, no API bill |
| `plannerCallsPerHour` | 20 | replaces the dollar ceiling in `claude-code` mode |

The combination worth knowing about:

```
driver:  ollama / a small local model   free, unlimited, runs all night
planner: claude-code                    your subscription, thinks rarely
```

That turns a day-long run from tens of dollars into a couple, because the
driver's job — "here are fourteen elements, pick one" — is close to the best
case for a small local model.

## The defaults, and why

Three explorers, sixteen hammerers, two confirmers. Three Chromium contexts with
an agent each is comfortable on a MacBook; the hammerers cost essentially
nothing.

Someone on a large box sets `explorers` to ten and walks away. Someone watching
their spend sets it to one with a budget ceiling and it simply goes slower —
which is fine, because the whole design is that it does less or more depending
on how long you leave it on.

## The budget ceiling is first class

"How much will twenty-four hours cost me" is the first question anyone will ask.
The answer should be "whatever you tell it" — you set a ceiling and the
scheduler throttles itself to fit, rather than you finding out afterwards.
