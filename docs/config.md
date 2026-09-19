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
| `rewalks` | 2 | fresh-account walks a screen suspicion must survive, every one agreeing |
| `logins` | `[]` | `[{ "email", "password" }]` to use when the app has no sign-up; also `--login` and `SHOAL_LOGIN=email:password[,…]`. Shared across the swarm, so the fresh-world guarantee is lost; two of them give the cross-account checks two people |
| `jev.maxUsd` | none | hard stop on TypeSafe spend for the run directory |
| `jev.suspect` | 0.85 | the probability at which a judgment becomes a suspicion |
| `budgetPerHour` | none | optional ceiling in dollars or tokens. It paces itself to fit |
| `pace` | sensible | maximum requests per second at the app, so the dev server survives |
| `mailPort` | 1025 | the local SMTP catcher agents read verification links from |

## The model

One model, TypeSafe Jev, does the driving and the judging. Full reasoning in
[ai.md](ai.md).

| Knob | Default | Notes |
|---|---|---|
| `TYPESAFE_API_KEY` | — | environment or `.env`; `shoal doctor` sends one planted contradiction to check it |
| `jev.model` | `jev-latest` | a versioned id such as `jev-1.13.0` pins a run to one set of weights |
| `jev.maxUsd` | none | measured: about $0.05 per ten minutes with three explorers |
| `jev.suspect` | 0.85 | lower catches more and rewalks more; the rewalk is the safety net |
| `planner` | `null` | optional generative tier for extra missions: `{"provider": "anthropic" \| "openai-compatible" \| "claude-code", "model": ...}` |
| `plannerCallsPerHour` | 20 | meters the planner in `claude-code` mode |

There is no local-model option. The judging depends on calibrated
probabilities, and Jev is the model trained to return them.

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
