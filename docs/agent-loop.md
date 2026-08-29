# The agent loop

## One turn

```
look   -> compact accessibility snapshot of the page
decide -> the model picks one tool call
act    -> we perform it
record -> every request it caused goes to the store
```

Repeat until the goal is met, the agent is stuck, or the turn budget runs out.

The snapshot is an accessibility tree, not a screenshot, and not raw HTML.
Every interactive element carries a stable ref the model can point at:

```
heading "Invoices"
button  [e3] "New invoice"
table
  row "INV-2081  Acme  RM 1,300  UNPAID"
  row "INV-2082  Bolt  RM 640    PAID"
link    [e9] "Next page"
```

## The tool surface

Kept small on purpose. A big tool surface makes a cheap model wander.

| Tool | Notes |
|---|---|
| `look()` | fresh snapshot |
| `click(ref)` | |
| `type(ref, text)` | |
| `select(ref, value)` | |
| `press(key)` | Enter, Escape, Tab |
| `goto(path)` | same origin only |
| `back()` | |
| `note(fact)` | writes something learned into the map |
| `surprise(expected, observed)` | files a suspicion |
| `done(result)` | mission over |

**There is no `evaluate()`.** No arbitrary JavaScript. If an agent can reach
into the page and change state directly, then the recording no longer matches
what a user could actually do, and every finding becomes arguable.

## The roles

**Scout.** Given a URL and nothing else. Signs itself up, wanders, and fills in
the map. Runs mostly at the start, and again whenever the app changes under us.
Cares about breadth: new pages, new forms, new endpoints. Does not chase goals.

**Crew.** Given a persona and a goal. Uses the map to move quickly through known
ground and only thinks hard when it hits something new. Cares about depth:
finishing a real workflow end to end.

## Personas

Behaviour, not demographics. "Ahmad, 34, likes coffee" changes nothing about
which code runs. These do:

- submits the form twice because the first click felt slow
- hits back halfway through and then goes forward again
- opens four tabs and works in all of them
- types a quantity of 0, then -1, then 999999
- pastes an emoji into a name field
- fills everything except one required field
- leaves a form open for ten minutes, then submits it
- refreshes right after pressing pay
- is brand new and has no data at all
- has been using the app for a while and has hundreds of rows

The last two matter more than they look. An app with three rows and an app with
three hundred are different programs, and only one of them is normally tested.

## Missions

Goals in plain English, generated from the map rather than written by us. When
the scout finds a page called "Invoices" with a "New invoice" button, that is a
mission: *create an invoice and get it paid.*

A mission carries its own success test, which is what makes read-back automatic:
"I should end up with an invoice showing RM 1,300 as paid." The agent then has a
reason to look, and something concrete to be surprised by.

Missions run in a fresh account by default, so they start from a clean world.
Some are deliberately run in an old, cluttered account instead, because
accumulated data is where a whole class of bug lives.

## Surprise

The one thing an agent can do that no dumb check can: remember what it did three
steps ago and notice that the screen now disagrees.

```
surprise(
  expected: "the invoice total should be 1,300 — I entered two lines of 650",
  observed: "the invoice page shows 650"
)
```

That writes a suspicion and **nothing else happens yet.** It does not go in the
report. It does not get counted. A confirmer picks it up, replays the recorded
requests without any model involved, and only then does it become a finding.

Agents are allowed to be wrong. That is the point of the gate.

## Two model tiers

- **driver** — cheap and fast. Runs the turn loop. Most of the calls.
- **planner** — good. Writes missions from the map, and looks at anything the
  driver flagged as surprising.

Roughly ninety percent of calls should hit the cheap one.

## What we do not do

**No LLM in the checks.** Ever. Nothing in `watch/` may call a model.

**No LLM in the replay.** A repro that needs a model to reproduce is not a
repro.

**No agent memory across missions**, beyond the map. The map is shared, durable
and structured. Agent conversation history is not: it is expensive, it drifts,
and it makes runs impossible to reason about.
