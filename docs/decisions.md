# Decisions

Agreed in one session, 29 August 2026. Recorded so we do not re-argue them, and
so it is obvious which parts are still soft.

## Settled

| # | Decision | Notes |
|---|---|---|
| 1 | The old Shoal is deleted | Restarting from the original intention: a swarm of agents that tests a running app. The old code is in git history and stays there |
| 2 | Agents + browser + URL. No target files, no source access, no database | Point it at any app and go |
| 3 | **Localhost only. Never live, never production** | The developer runs their own SaaS locally. This kills the entire safety problem and is not to be relaxed later |
| 4 | **Agents sign themselves up** with random emails and passwords | No credentials handed over. Setup is a URL |
| 5 | Signup is the reset | A fresh account is a fresh world. No database clone needed |
| 6 | **It keeps going. The report compiles over time** | Ten minutes finds a few things; twenty-four hours finds everything. Slow by nature, so it must be flexible about how long it runs |
| 7 | Agents decide what to do; dumb deterministic checks decide if it went wrong | The LLM is a finder, never a judge |
| 8 | Agents file suspicions, not bugs. Replay confirms before anything is reported | The defence against a report full of nonsense |
| 9 | Browser to learn, HTTP to repeat | How a slow agent design still catches races |
| 10 | Everything in one SQLite file, resumable | A day-long run cannot lose its work |
| 11 | Scored queue, no hardcoded phases | Exploration and hammering balance themselves |
| 12 | Deduplication is load-bearing | Three fingerprints: action, screen state, finding |
| 13 | Node + TypeScript + Playwright + SQLite, own agent loop | No browser-use, no Stagehand dependency, no CAMEL dependency |
| 14 | Accessibility tree, never screenshots | 20–50x cheaper per look |
| 15 | **Worker counts are the user's to set**, with sensible defaults | Depends on their budget and compute. Defaults tuned for a MacBook |
| 16 | Local SMTP catcher on port 1025 for email verification | The only setup step beyond the URL, and only for apps that verify email |

| 17 | Module layout, process model and SQLite schema | [modules.md](modules.md), [schema.md](schema.md). One process, one file, WAL |
| 18 | Only `store/` touches SQLite; nothing in `watch/` may call a model; agents may only write suspicions | The three rules that keep a day-long run debuggable |
| 19 | Read-back pairs are learned, not configured | The frontend refetches after a write, so it tells us which read shows it |
| 20 | The starvation guard is carried over from the old design | A swarm being refused is not a swarm finding nothing |
| 21 | No `evaluate()` in the agent tool surface | If an agent can change page state directly, no finding is arguable |
| 22 | Two model tiers: driver and planner, configured separately | The driver is ~90% of calls and is a small structured task |
| 23 | Defaults `claude-haiku-4-5` (driver) and `claude-opus-5` (planner) | [ai.md](ai.md). Both are config |
| 24 | Two provider adapters: `anthropic` and `openai-compatible` | The second covers OpenRouter, Ollama, LM Studio, vLLM. Claude never goes through an OpenAI shim |
| 25 | **A local driver is a first-class option, not a fallback** | It makes a 24-hour run cost a couple of dollars instead of fifty |
| 25a | Both adapters ship in M1, but the driver is developed against Claude | Debugging a new harness with a weak model chases two problems at once |
| 25b | M1 does not close until the scout has been measured on a local model | A gate with a number, not "we support it". The prompt breaks, not the adapter |
| 26 | The map is a model cache. Most turns should call no model at all | Watch model-calls-per-action: starts near 1.0, must fall toward 0.1 |
| 27 | Fixed-size turns. Rolling summary, never a transcript | Unbounded history is what kills long-running agents |
| 28 | Volatile content last, so the cached prefix survives | Cache reads are ~10% of input price and it fails silently |
| 29 | When the model layer fails, degrade to the free work | Hammering and confirming need no model; they keep running |
| 30 | **Shoal ships a stdio MCP server**, so Claude Code can operate it | start, status, findings, recheck, stop |
| 31 | **Confirmed findings are pushed into a live Claude Code session** via an MCP channel | Not a dashboard you forget to open |
| 32 | **Third adapter: `claude-code` planner**, on a subscription rather than API billing | Agent SDK `query()` preferred, headless CLI as fallback |
| 33 | Never pass `--bare` on the planner path | Bare mode refuses subscription OAuth and silently bills at API rates |
| 34 | Refuse to start in `claude-code` mode with `ANTHROPIC_API_KEY` set | It outranks the OAuth token in credential precedence |
| 35 | In `claude-code` mode the ceiling is planner-calls-per-hour, not dollars | A subscription has usage limits, not a price |
| 36 | The fix loop is a first-class flow | find -> push -> fix -> hot reload -> re-verify. The machinery already exists for other reasons |
| 37 | MCP sampling is not available, so the planner is a separate spawned process | If Claude Code ever supports it, the adapter collapses into the MCP server |
| 38 | **A calibration fixture with known bugs**, and `shoal bench` | Without it every change to Shoal is a guess. [calibration.md](calibration.md) |
| 39 | The fixture also contains things that are **not** bugs | False positives are measured, not just recall. Recall alone is a vanity metric |
| 40 | Findings rank by category, then reproduction ratio, then reachability | Nothing invented, nothing scored out of ten. [report.md](report.md) |
| 41 | No model-written prose in the report | Descriptions are templated from the recording. The report must be literally true |
| 42 | A `fixed` finding is never deleted | One that disappears and returns is worth more than either event alone |
| 43 | CLI: `run status ui report findings recheck map stop reset doctor bench mcp` | [cli.md](cli.md) |
| 44 | `run` on an existing run **continues** it. Starting over is an explicit `reset` | Losing a day of mapping must not be one keystroke |
| 45 | Config: defaults -> `shoal.config.json` -> `SHOAL_*` -> flags. No credentials anywhere | Shoal makes its own accounts, so there is nothing secret to store |
| 46 | Everything Shoal writes lives in `.shoal/` | Deleting that directory removes Shoal completely |
| 47 | `doctor` runs before anything expensive, and fails loudly on `ANTHROPIC_API_KEY` in claude-code mode | The credential trap costs real money silently |
| 48 | **npm `shoal`, MIT, public repo, Node 20+** | A tool that only talks to localhost should be readable by the people running it |
| 49 | Dashboard on :7717, plain HTML/CSS/vanilla JS, SSE, no build step | A dev tool that can fail to compile is one that stops you shipping. [ui.md](ui.md) |
| 50 | The Map view sorts **untouched first** | Showing what you covered is flattering; showing what you missed is useful |
| 51 | Starvation is pinned above the verdict, never below it | A refused swarm looks exactly like a clean run. It fooled the old tool four times |
| 52 | Tenancy is probed once and stored on the run | Decides whether a cross-account read is a bug or a fact about this app |
| 53 | Personas are a built-in list in code, extendable in config. Not generated | Behaviours are universal; they are not app-specific |
| 54 | The app's own docs become **missions at M5, never checks** | A claim about what an app does is a goal, not an invariant |
| 55 | **No optional database connection. Closed.** | It is the road back to the tool we deleted, and every check works without it |
| 56 | On a 401 mid-run, re-login once; then mark the account broken and make a new one | Signup is the reset, again |
| 57 | Recordings never leave the machine. `--redact` scrubs sensitive-looking fields | Snapshots go to the model tiers; local models mean nothing leaves at all |
| 60 | Nine tools, and `look` is not one of them | The loop looks every turn and hands the snapshot over, so a `look` tool could only ever waste a call. That is what makes the count nine rather than ten |
| 61 | Some checks are **probes**, seeded as `confirm` work, not passive watchers | Walking every page of a list or sending the same request twice means *doing* something. A probe files nothing at all unless it reproduces, which keeps "not confirmed" about genuine near-misses instead of listing every paged list in the app |
| 62 | The replayer gets its session from the live browser context | Rebuilding auth from a recorded login only works on apps that have one. Most only ever issue a session at signup, and re-firing that answers 409. The browser is for learning and HTTP is for repeating — that has to include being logged in |
| 63 | Never fuzz the signup or login form | Submitting them does not test a feature, it changes who the explorer is. An explorer that keeps registering itself spends the whole run on the front door |
| 64 | A screen that names an object is reached through its list, not by URL | `/app/customers/3` belongs to whichever account first saw it. Another explorer gets a 404 and then fills in a form against an object it does not own |
| 65 | Hammering happens in rounds, with novelty decaying, not once | It is also how the app accumulates data, and two of the things worth finding — a list too big to page correctly, a query that is only slow once there are rows — cannot exist until it has |
| 66 | Starvation counts writes only | A read that always answers 403 is the authorisation model working. Counting it turns the one warning that must never be ignored into noise |
| 67 | A cross-account 200 is not evidence; the same object is | Every account can read its own dashboard, its own list, its own summary, and all three answer 200 to everybody. Requiring a matching id *and* a matching field is what took the first build from two confident false positives to none |
| 68 | `openai-compatible` tiers take an `extra` object, merged into the request body | Every local runtime has one knob that matters and no two agree on its name. On qwen3 it is the difference between 13 seconds a turn and one |
| 69 | `claude-code` is allowed as a driver, with a warning | It is the wrong default — one subprocess per turn against a quota you are also using — but on a machine with no API key it is the only way to measure the driver against Claude at all |
| 70 | The counting argument applies to `same-row` only | "N writes accepted, so the figure should have moved N times as far" holds only when every request did the same thing to the same object. `shared-resource` sends each worker at a *different* object on purpose, so a counter moving once while eight were accepted is the shape working. Applying it anyway reported a correctly serialising booking endpoint as a race — twice — which is precisely what the fixture's non-bugs exist to catch. `shared-resource` now looks for a limit that was passed; `cross-action` fires the volley and concludes nothing from it |
| 71 | The number of rows in an answer is not a stored figure | A list caps its own page, so past that the count stops moving, and every write endpoint in the app starts to look like it loses writes |
| 72 | A read-back must be a data read | A create that redirects fires a document GET straight afterwards. Pairing a JSON write with an HTML page teaches the replayer to read the result back off a web page it cannot count anything in |
| 74 | A form's identity is its pattern, not its address | `data-action="/api/invoices/22/status"` made one form into one form per row — sixty forms where the app has twelve, field-tried state split twenty-five ways, every copy scoring as never-tried, and form matching falling through to whichever form happened to be first |
| 75 | Links are queued by shape, capped at three instances per pattern | Keyed on the address, every row the app creates adds a screen to explore, so the explore queue grows as fast as the data does. `unexplored` never falls, the tilt never tips, and hammering never gets a turn — which is the whole reason the concurrency gate stayed shut. A few different invoices are worth opening; thirty-seven is data entry |
| 76 | An empty list is filled before it is given up on — from a neighbouring collection if it has no create button of its own | Every explorer signs up its own account, so its world starts empty. A worker sent to a payment form finds no invoices, because nothing it did made one, and fails forever. Nothing in the design creates prerequisites, and almost every interesting bug is behind one. An invoice exists because an order was raised: that chain has to be walked, not waited for |
| 77 | An agent's own sentence never reaches a finding's title or description | It reaches the suspicion, and suspicions are shown under "not confirmed" labelled as an agent's words. But a confirmed finding is assembled from the recording, always — a surprise that reproduced was putting the model's phrasing straight into the report, which is the rule this design has about model-written prose, broken in the one place nobody looked |
| 78 | "Nothing to measure here" only sticks once a read-back has been learned | Read-backs come from watching the app refetch after a write, so early in a run every endpoint looks unmeasurable. Marking one permanently on that basis starved a run of the endpoint that accumulates data: `POST /api/orders` gave up after three rounds, one payments endpoint then took 123 rounds and 2,564 requests, and 29 orders existed after nineteen minutes when two of the planted bugs need hundreds of rows |
| 79 | Hammer rounds go round-robin across write endpoints, not first-past-the-post | Otherwise whichever endpoint happens to be measurable first takes every hammerer for the rest of the run. Hammering is not only how races are found, it is how the app grows the rows that the other checks need to exist at all |
| 85 | A slow finding needs a fast control at the same moment | Shoal runs eight hammerers, three browsers and a local model on the same machine as the app under test, so "this took four seconds" is as likely to describe the load we are generating as the endpoint. One run reported seventeen slow endpoints: one was the planted bug and sixteen were the laptop. The cheapest call the app is known to make is now fired alongside; if that is slow too, we are the problem and the attempt is inconclusive |
| 84 | The calibration is taken twice and the two must agree | "What does one write do to this object" is measured while fifteen other workers are using the same app, so a single reading picks up whatever else happened in that window. One run measured a create as moving `total` by ten — one of them ours — then expected eight concurrent creates to move it by eighty, saw eight, and reported a create endpoint as losing writes. The counting argument assumes we are the only writer, and in a swarm we never are. A measurement that does not repeat is not a measurement, and disagreement now means inconclusive rather than a finding |
| 83 | A create is measured against its collection, not against the app's own read-back | The read-back learned by watching the front end after a create is the new thing's own page, because that is where the app redirects. Correct for "did my write take"; useless for "how many are there now", since it re-reads one fixed row a create never touches. That single confusion retired `POST /api/orders` as unmeasurable, left four runs at 25 orders, and made bug #10 unreachable in every one of them — and it was quietly corrupting the read-back check too, which was comparing a newly created object against a pre-existing row |
| 82 | An endpoint with nothing measurable is still hammered, for the data | Hammering has two jobs and only one is finding races. A collection POST has no id in its path and so no object to measure against, and refusing to fire left `POST /api/orders` at 25 orders after twenty-two minutes while a measurable endpoint took 41 rounds. Eight concurrent creates still make eight things, and bug #10 does not exist until roughly six hundred of them do |
| 81 | Hammerers are spread by novelty decay, never by a pace-setter | "Nobody may get ahead of the slowest" hands a veto to whichever endpoint is stuck, and there is always one — first `register`, which is never hammered at all, then the payments endpoint, which has nothing to replay until a form worker reaches the pay form. `scoreOf` already decays novelty as an endpoint is hammered, which spreads the load and cannot stall |
| 80 | The door is excluded from the round-robin, not just refused by it | `POST /api/auth/register` is a write endpoint the hammerer always declines, so it sits on round zero forever. Pacing every other endpoint against the least-hammered one then held all of them at round one, and hammering — which is how the app grows the rows other checks need — nearly stopped. Two places have to agree on what the door is, so the test lives in one |
| 73 | `requires_auth` comes from the cookie jar, not from whether we have filed the account yet | The screen you land on straight after signing up is the most important screen in the app, and the first version filed it as public — then steered every explorer away from it |

## Open

Everything that was open at design level is now decided. What is left is
**empirical** — questions that only building answers:

- **Is a local driver actually good enough?** The M1 bench gate answers it, by
  running the same fixture against Claude and against Ollama and comparing the
  five numbers.
- **The scoring weights.** The shape is settled in
  [scheduler.md](scheduler.md); the numbers are a first guess and get tuned
  against the fixture, where a change can be measured instead of felt.
- **Does unaided signup work across real apps?** M1's whole risk. OAuth-only
  and invite-only apps are out of scope until told otherwise.

## Corrected while building

Recorded here rather than edited away, because a design that changed on contact
with the machine is worth seeing.

| # | Was | Is | Why |
|---|---|---|---|
| 58 | `better-sqlite3 ^11` | `better-sqlite3 ^13` | v11 has no prebuild for Node 26 and does not compile against that V8. v13 has prebuilds and still supports Node 20 |
| 59 | Fixture bug #4 is a non-unique `ORDER BY` | non-unique `ORDER BY` **plus** an offset that skips a row at each page boundary | SQLite breaks ties on rowid deterministically, so the non-unique sort alone paginates perfectly and the planted bug never fires. The check being tested is unchanged |
