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
