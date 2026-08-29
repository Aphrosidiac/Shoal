-- Shoal store. One file, WAL mode. See docs/schema.md for the reasoning.

PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS runs (
  id            INTEGER PRIMARY KEY,
  app_url       TEXT NOT NULL,
  config_json   TEXT NOT NULL,
  tenancy       TEXT,                        -- unknown | isolated | shared
  started_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  stopped_at    INTEGER
);

CREATE TABLE IF NOT EXISTS app_versions (
  id            INTEGER PRIMARY KEY,
  fingerprint   TEXT NOT NULL UNIQUE,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  restarts      INTEGER NOT NULL DEFAULT 0
);

-- ---------- map ----------
CREATE TABLE IF NOT EXISTS pages (
  id            INTEGER PRIMARY KEY,
  url_pattern   TEXT NOT NULL,
  title         TEXT,
  screen_fp     TEXT NOT NULL UNIQUE,
  example_url   TEXT,                        -- a real address this screen was seen at
  requires_auth INTEGER NOT NULL DEFAULT 1,
  visits        INTEGER NOT NULL DEFAULT 0,
  explored      INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS endpoints (
  id            INTEGER PRIMARY KEY,
  method        TEXT NOT NULL,
  path_pattern  TEXT NOT NULL,
  writes        INTEGER NOT NULL DEFAULT 0,
  calls         INTEGER NOT NULL DEFAULT 0,
  statuses_json TEXT NOT NULL DEFAULT '{}',
  hammered      INTEGER NOT NULL DEFAULT 0,
  readback_id   INTEGER REFERENCES endpoints(id),
  first_seen_at INTEGER NOT NULL,
  UNIQUE(method, path_pattern)
);

CREATE TABLE IF NOT EXISTS elements (
  id       INTEGER PRIMARY KEY,
  page_id  INTEGER NOT NULL REFERENCES pages(id),
  role     TEXT NOT NULL,
  name     TEXT,
  selector TEXT,
  kind     TEXT
);

CREATE TABLE IF NOT EXISTS forms (
  id          INTEGER PRIMARY KEY,
  page_id     INTEGER NOT NULL REFERENCES pages(id),
  name        TEXT,
  endpoint_id INTEGER REFERENCES endpoints(id)
);

CREATE TABLE IF NOT EXISTS fields (
  id         INTEGER PRIMARY KEY,
  form_id    INTEGER NOT NULL REFERENCES forms(id),
  name       TEXT NOT NULL,
  type       TEXT,
  required   INTEGER NOT NULL DEFAULT 0,
  tried_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS edges (
  id           INTEGER PRIMARY KEY,
  from_page_id INTEGER NOT NULL REFERENCES pages(id),
  to_page_id   INTEGER NOT NULL REFERENCES pages(id),
  element_id   INTEGER REFERENCES elements(id),
  taken        INTEGER NOT NULL DEFAULT 0
);

-- ---------- accounts ----------
CREATE TABLE IF NOT EXISTS accounts (
  id         INTEGER PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  password   TEXT NOT NULL,
  display    TEXT,
  role       TEXT,
  tenant_key TEXT,
  verified   INTEGER NOT NULL DEFAULT 0,
  state      TEXT NOT NULL DEFAULT 'ok',
  created_at INTEGER NOT NULL
);

-- ---------- traffic ----------
CREATE TABLE IF NOT EXISTS recordings (
  id             INTEGER PRIMARY KEY,
  run_id         INTEGER NOT NULL REFERENCES runs(id),
  app_version_id INTEGER NOT NULL REFERENCES app_versions(id),
  account_id     INTEGER REFERENCES accounts(id),
  page_id        INTEGER REFERENCES pages(id),
  endpoint_id    INTEGER REFERENCES endpoints(id),
  worker         TEXT NOT NULL,
  method         TEXT NOT NULL,
  url            TEXT NOT NULL,
  req_headers    TEXT,
  req_body       TEXT,
  status         INTEGER,
  res_headers    TEXT,
  res_body       TEXT,
  started_at     INTEGER NOT NULL,
  ms             INTEGER NOT NULL,
  action_fp      TEXT NOT NULL,
  wave_id        TEXT
);
CREATE INDEX IF NOT EXISTS ix_rec_endpoint ON recordings(endpoint_id, started_at);
CREATE INDEX IF NOT EXISTS ix_rec_fp       ON recordings(action_fp);
CREATE INDEX IF NOT EXISTS ix_rec_wave     ON recordings(wave_id);

-- ---------- work ----------
CREATE TABLE IF NOT EXISTS queue (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  score        REAL NOT NULL,
  state        TEXT NOT NULL DEFAULT 'ready',
  leased_by    TEXT,
  leased_until INTEGER,
  attempts     INTEGER NOT NULL DEFAULT 0,
  parent_id    INTEGER REFERENCES queue(id),
  dedupe_key   TEXT UNIQUE,
  created_at   INTEGER NOT NULL,
  done_at      INTEGER
);
CREATE INDEX IF NOT EXISTS ix_queue_pull ON queue(state, score DESC);

-- ---------- output ----------
CREATE TABLE IF NOT EXISTS suspicions (
  id           INTEGER PRIMARY KEY,
  source       TEXT NOT NULL,
  worker       TEXT NOT NULL,
  recording_id INTEGER REFERENCES recordings(id),
  expected     TEXT NOT NULL,
  observed     TEXT NOT NULL,
  note         TEXT,
  state        TEXT NOT NULL DEFAULT 'open',
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS findings (
  id             INTEGER PRIMARY KEY,
  fingerprint    TEXT NOT NULL UNIQUE,
  kind           TEXT NOT NULL,   -- leak data-loss money race auth fault wrong slow noise
  title          TEXT NOT NULL,
  reach          INTEGER NOT NULL DEFAULT 0,   -- steps from a fresh account
  endpoint_id    INTEGER REFERENCES endpoints(id),
  app_version_id INTEGER NOT NULL REFERENCES app_versions(id),
  repro_json     TEXT NOT NULL,
  attempts       INTEGER NOT NULL,
  reproduced     INTEGER NOT NULL,
  occurrences    INTEGER NOT NULL DEFAULT 1,
  first_seen_at  INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  state          TEXT NOT NULL DEFAULT 'open'  -- open | fixed | stale
);

CREATE TABLE IF NOT EXISTS finding_events (
  id           INTEGER PRIMARY KEY,
  finding_id   INTEGER NOT NULL REFERENCES findings(id),
  recording_id INTEGER REFERENCES recordings(id),
  at           INTEGER NOT NULL
);

-- ---------- progress and cost ----------
CREATE TABLE IF NOT EXISTS coverage (
  key        TEXT PRIMARY KEY,
  value      INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY,
  at      INTEGER NOT NULL,
  kind    TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_calls (
  id          INTEGER PRIMARY KEY,
  at          INTEGER NOT NULL,
  worker      TEXT NOT NULL,
  tier        TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model       TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  in_tokens   INTEGER NOT NULL,
  cached_in   INTEGER NOT NULL,
  out_tokens  INTEGER NOT NULL,
  ms          INTEGER NOT NULL,
  chose       TEXT,
  repaired    INTEGER NOT NULL DEFAULT 0,
  usd         REAL NOT NULL,
  prompt      TEXT
);
CREATE INDEX IF NOT EXISTS ix_calls_at ON model_calls(at);
