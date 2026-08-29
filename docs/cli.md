# CLI and configuration

## Commands

```
shoal run <url>          start a run, or continue the one in this directory
shoal status             what is happening right now
shoal ui                 open the dashboard (default http://localhost:7717)
shoal report [--open]    regenerate the report file
shoal findings [id]      list findings, or show one in full
shoal recheck <id>       re-run one finding's repro against the app as it is now
shoal map                dump what Shoal knows about the app
shoal stop               stop the run, leave everything on disk
shoal reset [--all]      clear findings and traffic; --all clears the map too
shoal doctor             check the setup before wasting a run on it
shoal bench              run against the calibration fixture and score
shoal mcp                run as an MCP server on stdio (Claude Code uses this)
```

### `run`

```
shoal run http://localhost:3000
shoal run http://localhost:3000 --explorers 6 --hammerers 32
shoal run http://localhost:3000 --for 24h
shoal run --continue
```

`run` against a directory that already has a run **continues it**. It does not
start over, and it does not ask. Starting fresh is `shoal reset` first — an
explicit act, because throwing away a day of mapping by accident is not a
mistake anyone should be able to make in one keystroke.

Flags: `--explorers` `--hammerers` `--confirmers` `--for` `--pace`
`--budget` `--driver` `--planner` `--no-ui` `--redact` `--verbose` `--headed`

`--headed` opens the browser windows so you can watch, which is worth ninety
seconds once and never again.

`--for` accepts `30m`, `24h`, or nothing at all, in which case it runs until
stopped.

### `bench`

```
shoal bench --for 30m --label "what changed"
```

Starts `fixtures/leaky` on :4100 by itself, runs against it, scores what it
confirmed against the planted bugs, and appends the five numbers to
`fixtures/leaky/BENCH.md`. `--append false` to keep it out of the history,
`--report` to print the whole report, `--provider`/`--driver`/`--baseUrl` to
score a different model against the same app.

It reads the driver and planner out of the `shoal.config.json` where you ran
it, not out of the scratch directory it wipes — a bench that quietly falls back
to different models is not an instrument.

### `doctor`

Runs before anything expensive and checks the six things that ruin a run:

```
app        http://localhost:3000        up, responds in 40ms
signup     found at /register           email + password, no OAuth wall
mail       localhost:1025               catcher listening
driver     ollama / <model>             responded in 800ms
planner    claude-code                  subscription OAuth  ✓ no ANTHROPIC_API_KEY set
disk       .shoal/                      writable, 2.1 GB free
```

The credential line matters most. In `claude-code` mode, `doctor` fails loudly
if `ANTHROPIC_API_KEY` is set anywhere in the environment, because that
variable outranks the OAuth token and would quietly bill you at API rates.

## Configuration

Four layers, later wins:

```
defaults  ->  shoal.config.json  ->  SHOAL_* env vars  ->  CLI flags
```

`shoal.config.json` lives in the directory you run Shoal from — beside the app
it tests, not inside Shoal. Nothing in it is secret; there are no credentials
anywhere, because Shoal makes its own accounts.

```json
{
  "url": "http://localhost:3000",
  "explorers": 3,
  "hammerers": 16,
  "confirmers": 2,
  "pace": 40,
  "mailPort": 1025,
  "ui": { "port": 7717 },
  "driver":  { "provider": "openai-compatible",
               "baseUrl": "http://localhost:11434/v1",
               "model": "<a small local model>" },
  "planner": { "provider": "claude-code" },
  "plannerCallsPerHour": 20
}
```

Env vars are the same keys, screaming and prefixed: `SHOAL_EXPLORERS`,
`SHOAL_DRIVER_MODEL`, `SHOAL_UI_PORT`.

## Where things live

Everything Shoal writes goes in one directory, so removing it removes Shoal:

```
.shoal/
  run.db          the store. the whole memory of every run in this directory
  report.html     the live report
  report.md       the same thing, for pasting somewhere
  shoal.log
```

`.shoal/` belongs in `.gitignore`. The installer offers to add it.

## Packaging

Published to npm as **`shoal`**, MIT licensed, public repository. Node 20+.
Playwright's Chromium downloads on first run, which is the only heavy step and
is announced before it happens.

```bash
npx shoal run http://localhost:3000
```

It is a developer tool that only ever talks to localhost. Open source is the
only version of it anybody should trust.

## Privacy

Recordings contain whatever is in the app's database — real names, real
addresses, whatever your dev seed holds. All of it stays in `.shoal/run.db` on
your machine. Nothing is uploaded, and the report is a local file.

Two things reach a network: the driver and the planner, which are sent page
snapshots. A snapshot is structure plus visible text, so it can contain data.
Run `--redact` to scrub values from fields whose names look sensitive before
anything is stored or sent, or point both tiers at a local model and nothing
leaves the machine at all.
