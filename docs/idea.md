# The idea

## What it is for

A developer has a SaaS. It works when they use it. They cannot afford a QA
team, they will not write a thousand tests, and the bugs that hurt are the ones
nobody thought to check for.

Shoal is the thing you leave running against it. A crowd of agents that behave
like users — including the annoying ones — and a report that gets longer the
longer you leave it on.

The target audience is developers testing their own software, locally. Nobody
else.

## Where it came from

Two projects were the inspiration:

- **[CAMEL](https://github.com/camel-ai/camel)** — agents with roles, memory
  and personas, talking to each other in a society.
- **[MiroFish](https://github.com/666ghj/MiroFish)** — builds a whole simulated
  world from seed material and lets thousands of agents live in it.

Both point a crowd of agents at a made-up world. The idea here is to point that
same crowd at a **real** one: the app you are actually building.

Neither is used as a dependency. See [stack.md](stack.md).

## What we are not building, and why

There was an earlier version of Shoal in this repo. It was a concurrency
tester: you hand-wrote every action your app could perform, and hand-wrote every
rule that must hold, and it fired them at your app in parallel waves and checked
the database afterwards.

It worked. It found real bugs — money silently disappearing from invoice
balances under concurrent payments, rows appearing on two pages of a list and
on neither, four chat threads created for one customer.

It was deleted anyway, because of what it cost. Writing the description of one
app took hours, two-thirds of it mechanical, and it had to be redone for every
app. It needed your source code on disk and a Postgres database it could clone.
It only worked on apps you own and can read. That is not "point it at your app
and go", which is the thing worth having.

The trade is honest and worth stating: the old design was better at finding
races, because its actors were dumb and fast and could collide inside the same
millisecond. This design gets that back a different way — see
[architecture.md](architecture.md), "browser to learn, HTTP to repeat".

## The split that matters

There are two jobs: **decide what to do**, and **decide whether it went wrong.**

Give agents the first one. This is what they are genuinely good at, and it is
where the pain was. An agent given a goal — "get a quotation turned into a paid
invoice" — walks the whole workflow naturally. A random action picker never
gets there, and the old tool wasted entire runs on exactly that.

Never give agents the second one. LLM-as-judge floods you with confident
nonsense, costs a fortune, and you stop trusting the output in a week. Bugs get
declared by dumb deterministic checks that are right every time.

**The LLM is a finder. It is never a judge.**

## The correction (2026-09-19)

That rule was right about LLMs and wrong about judging. Banning every model
from the second job left only the bugs an `if` statement can prove from HTTP
traffic — races, leaks, dropped fields, paging holes — and not one bug a user
would see on a screen. The stated goal was a system that goes through the app
in the browser and finds every bug it can. The built system was an HTTP fuzzer
with a browser bolted on to bootstrap it.

The way out is a model that does not generate: TypeSafe's Jev returns typed
answers with calibrated probabilities, in a few hundred milliseconds, for a
hundredth of a cent a screen. A probability is a measurement code can
threshold; a paragraph is a claim code has to believe. So the split stands,
with the second job re-divided:

**Agents find. Calibrated judgments filter. Reproduction decides.**

Jev drives every step — it picks a control from a closed set and never writes
a string — and judges every screen. Code still owns the loop, every count,
every comparison, every value typed. And nothing reaches the report until it
has been walked again in a fresh account and judged the same way twice.
See [ai.md](ai.md).
