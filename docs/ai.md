# The AI layer

Where the intelligence comes from, what it costs, and what happens when it is
not there.

## One model, and it is not an LLM

Shoal drives the browser and judges every screen with
[Jev](https://docs.typesafe.ai/introduction), TypeSafe's System One model.
Jev does not generate text. It takes a `state` — JSON — and a map of typed
questions, and returns typed answers with calibrated probabilities:

| Primitive | Asked | Comes back |
|---|---|---|
| **Choice** | which of these controls advances the goal? | one of the offered ids, a probability per id, a confidence |
| **Noul** | does this screen show two facts that cannot both be true? | a probability of yes |
| **Score** | (unused so far) | a position along described levels |

Every question in a request is evaluated in parallel over the same state.
Thirty questions about one screen cost the tokens of the questions and no
extra round trip. That single property is what makes the whole design
affordable: the request that chooses the next action carries the judgment of
the last one for nothing.

Measured on the fixture (`src/bench/judge.ts`): about 3,000 input tokens per
step, 280–800 ms, and $0.042 per million tokens — a step costs roughly a
hundredth of a cent. Output is free.

## Why a decision model can judge when an LLM cannot

The first Shoal banned models from judging. That was the right reaction to
LLM-as-judge and the wrong conclusion: it left only the bugs an `if` statement
can prove from HTTP recordings, and no bug you would see on a screen.

A Noul at 0.93 is a different kind of object from a paragraph that says "this
looks like a bug". It is a number, it is calibrated against outcomes, it is
self-consistent across repeated evaluations, and there is no prose to drift
into. Code thresholds it (`SUSPECT`, 0.85), files a suspicion, and the gate is
unchanged: nothing reaches the report until it reproduces. For a screen
suspicion, reproducing means walking the same steps again in a brand new
account and asking the same question of the same screen, and every walk has
to agree.

The rule, rewritten: **agents find, calibrated judgments filter, reproduction
decides.**

## What Jev is never asked

[docs.typesafe.ai/model-jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)
is the list of what it is bad at, and each item is a rule here:

- **It does not count or do arithmetic.** Row counts, totals, "is 1300 the
  same as RM 1,300.00" — code (`agent/judge.ts`). Jev is asked whether a
  phone number is *shown*; code decides whether it is the one typed.
- **It does not compare dates.** Not asked.
- **It does not generate.** It never writes a value that gets typed. It says
  what *kind* a field is (a Choice over fourteen kinds); a persona says which
  *class* of value to try; code owns the string (`agent/typist.ts`). Every
  value is therefore reproducible on a rewalk.
- **It reads literally.** Every Noul in `jev/bank.ts` carries `true` and
  `false` criteria with a `not_for` clause naming the boundary case — a
  field hint is not an error, an empty state is not a dead end, a disabled
  control with a reason is not a contradiction.
- **It suffers context rot.** The `before` screen is pruned to headings,
  messages, fields and 1,200 characters; visible text is capped at 6,000;
  the element table at 120 rows.
- **Choice and Noul do not agree with each other.** Each decision is asked
  one way, and thresholds are per question.

## What a day actually costs

Measured, not estimated. The first swarm run on the fixture: 1,037 Jev
requests in 8 minutes for $0.13, three explorers. That is about $1 an hour,
or $23 for a day — before the explore-mode judgment cache, which makes a
screen already judged after the same action free for the rest of the run.

The `jev.maxUsd` config is a hard stop for the run directory. `shoal doctor`
sends one planted contradiction and refuses to start a run if Jev does not
see it.

## The optional generative tier

A planner (`planner` in config, `null` by default) can write extra missions
from the map. Nothing needs it: missions are written by code from the map's
own shape — a form on `/app/invoices/:id/pay` is a mission to pay an
invoice, and its success test is always the same: the thing you made is shown
with the values you gave it. The planner is never on the path of a judgment.

## When it is not there

`Jev.up()` is false after a refused key or thirty seconds of unreachability,
and the explorer pool sleeps while hammerers and confirmers — pure HTTP —
carry on. Budget exhausted is the same: the free work continues, the paid
work stops, and the log says so.
