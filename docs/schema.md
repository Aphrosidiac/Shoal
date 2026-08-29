# The store

One SQLite file, WAL mode. It holds everything: what we learned, what we did,
what we found, and what we still owe. Delete it and Shoal is blind again; keep
it and every future run starts deeper than the last.

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
```

## Identity

```sql
CREATE TABLE runs (
  id            INTEGER PRIMARY KEY,
  app_url       TEXT NOT NULL,
  config_json   TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  stopped_at    INTEGER
);

-- the app changes under us while we work. every finding is stamped with which
-- version of it was running at the time.
CREATE TABLE app_versions (
  id            INTEGER PRIMARY KEY,
  fingerprint   TEXT NOT NULL UNIQUE,   -- build id, asset hash, or /health body
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  restarts      INTEGER NOT NULL DEFAULT 0
);
```

## The map

Built entirely from the outside. No source code was read to fill any of this in.

```sql
CREATE TABLE pages (
  id            INTEGER PRIMARY KEY,
  url_pattern   TEXT NOT NULL,          -- /invoices/:id
  title         TEXT,
  screen_fp     TEXT NOT NULL,          -- structural shape, ignoring content
  requires_auth INTEGER NOT NULL DEFAULT 1,
  visits        INTEGER NOT NULL DEFAULT 0,
  explored      INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  UNIQUE(screen_fp)
);

CREATE TABLE elements (
  id       INTEGER PRIMARY KEY,
  page_id  INTEGER NOT NULL REFERENCES pages(id),
  role     TEXT NOT NULL,               -- button, link, textbox, combobox
  name     TEXT,                        -- accessible name
  selector TEXT,                        -- resolved, cached, reusable
  kind     TEXT                         -- nav, submit, destructive, unknown
);

CREATE TABLE forms (
  id          INTEGER PRIMARY KEY,
  page_id     INTEGER NOT NULL REFERENCES pages(id),
  name        TEXT,
  endpoint_id INTEGER REFERENCES endpoints(id)   -- learned by watching it submit
);

CREATE TABLE fields (
  id           INTEGER PRIMARY KEY,
  form_id      INTEGER NOT NULL REFERENCES forms(id),
  name         TEXT NOT NULL,
  type         TEXT,                    -- text, number, email, date, select
  required     INTEGER NOT NULL DEFAULT 0,
  tried_json   TEXT NOT NULL DEFAULT '[]'  -- which classes of value we have used
);

CREATE TABLE endpoints (
  id            INTEGER PRIMARY KEY,
  method        TEXT NOT NULL,
  path_pattern  TEXT NOT NULL,          -- /api/invoices/:id/payments
  writes        INTEGER NOT NULL DEFAULT 0,   -- POST/PUT/PATCH/DELETE
  calls         INTEGER NOT NULL DEFAULT 0,
  statuses_json TEXT NOT NULL DEFAULT '{}',
  hammered      INTEGER NOT NULL DEFAULT 0,
  readback_id   INTEGER REFERENCES endpoints(id),  -- how to read this back
  first_seen_at INTEGER NOT NULL,
  UNIQUE(method, path_pattern)
);

-- what leads where. lets an agent get somewhere without rediscovering the route.
CREATE TABLE edges (
  id           INTEGER PRIMARY KEY,
  from_page_id INTEGER NOT NULL REFERENCES pages(id),
  to_page_id   INTEGER NOT NULL REFERENCES pages(id),
  element_id   INTEGER REFERENCES elements(id),
  taken        INTEGER NOT NULL DEFAULT 0
);
```

`endpoints.readback_id` is worth calling out. We do not have to guess how to
read something back after a write — **the frontend already does it for us.**
Watch a POST, and whatever GET the app fires immediately afterwards is the
read-back for that write. Learned, not configured.

## Accounts

```sql
CREATE TABLE accounts (
  id         INTEGER PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  password   TEXT NOT NULL,
  display    TEXT,
  role       TEXT,                      -- discovered, not configured
  tenant_key TEXT,                      -- if the app has orgs/teams
  verified   INTEGER NOT NULL DEFAULT 0,
  state      TEXT NOT NULL DEFAULT 'ok',-- ok, locked, broken
  created_at INTEGER NOT NULL
);
```

## Traffic

The raw material. Everything downstream reads from here.

```sql
CREATE TABLE recordings (
  id             INTEGER PRIMARY KEY,
  run_id         INTEGER NOT NULL REFERENCES runs(id),
  app_version_id INTEGER NOT NULL REFERENCES app_versions(id),
  account_id     INTEGER REFERENCES accounts(id),
  page_id        INTEGER REFERENCES pages(id),
  endpoint_id    INTEGER REFERENCES endpoints(id),
  worker         TEXT NOT NULL,         -- scout-1, crew-3, hammer-11
  method         TEXT NOT NULL,
  url            TEXT NOT NULL,
  req_headers    TEXT,
  req_body       TEXT,
  status         INTEGER,
  res_headers    TEXT,
  res_body       TEXT,                  -- truncated past a limit
  started_at     INTEGER NOT NULL,
  ms             INTEGER NOT NULL,
  action_fp      TEXT NOT NULL,         -- method + path pattern + fields set
  wave_id        TEXT                   -- set when part of a hammer volley
);

CREATE INDEX ix_rec_endpoint ON recordings(endpoint_id, started_at);
CREATE INDEX ix_rec_fp       ON recordings(action_fp);
CREATE INDEX ix_rec_wave     ON recordings(wave_id);
```

Bodies get truncated past a size limit, and recordings older than a window get
their bodies dropped once nothing references them — otherwise a day-long run
writes gigabytes of JSON nobody will read.

## Work

A lease-based queue. Anything leased and not finished comes back automatically,
so a crash loses at most one item.

```sql
CREATE TABLE queue (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL,           -- explore, form, mission, hammer,
                                        -- confirm, crossaccount
  payload_json TEXT NOT NULL,
  score        REAL NOT NULL,
  state        TEXT NOT NULL DEFAULT 'ready', -- ready, leased, done, failed, dropped
  leased_by    TEXT,
  leased_until INTEGER,
  attempts     INTEGER NOT NULL DEFAULT 0,
  parent_id    INTEGER REFERENCES queue(id),
  dedupe_key   TEXT UNIQUE,             -- stops the same work being queued twice
  created_at   INTEGER NOT NULL,
  done_at      INTEGER
);

CREATE INDEX ix_queue_pull ON queue(state, score DESC);
```

## Output

```sql
-- what an agent noticed. not yet a bug.
CREATE TABLE suspicions (
  id           INTEGER PRIMARY KEY,
  source       TEXT NOT NULL,           -- agent, watcher
  worker       TEXT NOT NULL,
  recording_id INTEGER REFERENCES recordings(id),
  expected     TEXT NOT NULL,
  observed     TEXT NOT NULL,
  note         TEXT,
  state        TEXT NOT NULL DEFAULT 'open', -- open, confirmed, dismissed
  created_at   INTEGER NOT NULL
);

-- confirmed, deduplicated, reproducible.
CREATE TABLE findings (
  id             INTEGER PRIMARY KEY,
  fingerprint    TEXT NOT NULL UNIQUE,  -- endpoint + check + failure shape
  kind           TEXT NOT NULL,         -- server-fault, leak, readback, race, ...
  title          TEXT NOT NULL,
  severity       TEXT NOT NULL,
  endpoint_id    INTEGER REFERENCES endpoints(id),
  app_version_id INTEGER NOT NULL REFERENCES app_versions(id),
  repro_json     TEXT NOT NULL,         -- the minimal sequence that does it
  attempts       INTEGER NOT NULL,
  reproduced     INTEGER NOT NULL,      -- 3 of 5
  occurrences    INTEGER NOT NULL DEFAULT 1,
  first_seen_at  INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  state          TEXT NOT NULL DEFAULT 'open'  -- open, gone-after-restart
);

CREATE TABLE finding_events (
  id           INTEGER PRIMARY KEY,
  finding_id   INTEGER NOT NULL REFERENCES findings(id),
  recording_id INTEGER REFERENCES recordings(id),
  at           INTEGER NOT NULL
);
```

`occurrences` is the whole deduplication story. The same bug seen nine hundred
times is one row with a counter, never nine hundred rows.

## Progress and cost

```sql
CREATE TABLE coverage (
  key        TEXT PRIMARY KEY,          -- pages.found, endpoints.hammered, ...
  value      INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE events (
  id      INTEGER PRIMARY KEY,
  at      INTEGER NOT NULL,
  kind    TEXT NOT NULL,                -- app-restart, budget-hit, starved, stuck
  message TEXT NOT NULL
);

CREATE TABLE model_calls (
  id           INTEGER PRIMARY KEY,
  at           INTEGER NOT NULL,
  worker       TEXT NOT NULL,
  tier         TEXT NOT NULL,          -- driver, planner
  provider     TEXT NOT NULL,          -- anthropic, openai-compatible
  model        TEXT NOT NULL,
  prompt_hash  TEXT NOT NULL,
  in_tokens    INTEGER NOT NULL,
  cached_in    INTEGER NOT NULL,       -- if this is 0 across turns, caching is broken
  out_tokens   INTEGER NOT NULL,
  ms           INTEGER NOT NULL,
  chose        TEXT,                   -- which tool it called
  repaired     INTEGER NOT NULL DEFAULT 0,
  usd          REAL NOT NULL,
  prompt       TEXT                    -- kept during M1-M3 only
);

CREATE INDEX ix_calls_at ON model_calls(at);
```

`cached_in` earns its column. Prompt caching is most of the difference between
a day-long run costing thirty dollars and costing three hundred, and it fails
silently — see [ai.md](ai.md).
