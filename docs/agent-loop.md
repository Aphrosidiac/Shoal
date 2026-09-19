# The agent loop

## One turn

```
look   -> compact snapshot: controls, forms, tables, messages, visible text
ask    -> ONE Jev request: the judgment of the last action, and (in a mission)
          which operation and which control come next
judge  -> code checks, then thresholds; suspicions carry the trail
act    -> perform it; the persona's bad habits fire around a submit
record -> every request it caused goes to the store
```

Repeat until the goal is visibly met, the agent is stuck, or the turn budget
runs out. `src/agent/loop.ts`.

## Two modes, one loop

**Explore** (the scout, and `explore` work): code picks where to go —
depth-first over untried links, then screens nobody has opened — for free.
Jev judges every screen it lands on and says what kind of screen it is. The
same action on the same screen leading to the same screen is judged once per
run.

**Mission** (the crew): Jev drives. The request carries an operation head and
one speculative target head per operation, ported from
[browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast):

```
drive.operation      choice { CLICK, TYPE_TEXT, SELECT, WAIT, DONE, BLOCKED }
drive.click_target   choice { e3, e9, ... }   only clickables
drive.type_target    choice { e4, e7 }        only editables
drive.select_target  choice { "e5:2", ... }   element and option index
kind.e4, kind.e7     choice over fourteen field kinds
```

Code reads only the head that matches the chosen operation. An answer that is
not one of the offered ids, whose probabilities do not sum to one, or whose
argmax disagrees with the choice is a refusal, never an action. Destructive
controls — log out, delete account, change password — are not on the table,
so they cannot be chosen.

**There is no `type(text)`.** Jev says what kind of field it is; the persona
says which class of value to try; `typist.ts` owns the string. There is no
`evaluate()` either: no arbitrary JavaScript, because the recording has to
match what a user could actually do.

## Personas

Behaviour, not demographics. Each changes which code runs:

| | Value classes | Hooks |
|---|---|---|
| the impatient one | | clicks a submit twice |
| the one who changes their mind | | back, forward, type it again, submit |
| the extremist | 0, −1, 999999 on numbers | |
| the copy-paster | emoji, quotes, `<tag>` in text | |
| the incomplete one | | leaves the first required field empty |
| the one who wandered off | | waits before a submit |
| the refresher | | reloads after a submit |
| the beginner / the regular / the tidy one | | a fresh or a cluttered account |

The `<tag>` in the copy-paster's value found bug #22 in the fixture on the
first run — user input rendered as HTML.

## Missions

Goals in plain English, written from the map by code (`missions.ts`). A form
on a screen is a mission to use it; a list is a mission to open one of its
rows. The success test is always the same shape — *the thing you made is
shown with the values you entered* — which is what makes read-back automatic:
the judge has `entered` to compare against on the next screen.

Shallow screens first, so the thing an invoice depends on is made before the
invoice. Missions run in a fresh account by default; some deliberately in a
cluttered one.

**Chains.** A form on `/app/invoices/:id` needs an invoice to exist, and in a
fresh account none does. So the mission is two links walked in one account:
*create an order*, then *open an invoice and set its status*. The
prerequisite is read off the map — the create form for the same noun if there
is one, else the create form for a noun whose record page links into this one
(an order's page links to invoices, because making the order made one). A
navigation bar on every screen makes that inference ambiguous, so it is a
guess that gets corrected: a crew that ends on an empty list is queued again
with the next untried prerequisite in front. Links before the last are walked
plainly; the persona misbehaves on the last one only.

**One form, one mission per persona that changes it.** The same create form is
a different test with a number below zero in it, with a required field left
empty, with the button pressed twice — so form missions are written once for
each of those personas rather than once for whoever is next. A persona with
bad numbers in its pockets empties one into an untouched number field before
every submit: the extremist never used to reach the quantity box, because it
already said 1.

**A button with no fields is still a mission.** "Mark all as read" is a thing
the app can be told to do and a screen to read afterwards.

**A form without a `<form>`.** A single-page app draws three inputs in a
dialog and a button called "Add customer". The snapshot groups loose fields
by their nearest container and pairs them with the submit-like button that
follows them; a label ending in `*` marks its field required. When a modal
is in front, the snapshot reads only what is inside it — what is behind
cannot be clicked, and reading it made a three-field dialog look like the
whole page with three extra fields.

## What we do not do

**No model in the checks.** Nothing in `watch/` calls anything.

**No model in an HTTP replay.** A repro that needs a model to reproduce is
not a repro. (A screen repro asks the *same question* of the *same screen*
again — that is a measurement repeated, not a judgment invented.)

**No agent memory across missions**, beyond the map and the trail. Agent
conversation history is not kept: it is expensive, it drifts, and it makes
runs impossible to reason about. The judge sees the last ten actions as one
line each, and in explore mode none at all.
