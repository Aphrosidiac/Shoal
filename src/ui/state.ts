import type { DB } from '../store/db.js'
import type { Config } from '../config.js'
import { build } from '../report/build.js'
import * as map from '../store/repo/map.js'
import * as accountsRepo from '../store/repo/accounts.js'
import * as recordings from '../store/repo/recordings.js'
import * as queue from '../store/repo/queue.js'
import { currentRun } from '../store/repo/run.js'
import { live } from './live.js'

/** Everything the dashboard shows, rebuilt from the store each time. */
export function state(db: DB, cfg: Config, appUrl: string, build_: string): Record<string, unknown> {
  const r = build(db, appUrl)
  const run = currentRun(db, appUrl)
  const l = live.snapshot()
  const recent = recordings.recent(db, 120)
  const feed = l.feed.length
    ? l.feed
    : recent.slice(0, 60).map((x) => ({
        at: x.started_at, method: x.method, path: pathOf(x.url), status: x.status ?? 0, ms: x.ms, worker: x.worker,
      }))
  // `shoal ui` is a second process reading the same file, so it has none of
  // the in-memory state the run keeps. The traffic is on disk though, and the
  // first question the dashboard exists to answer — is it alive and doing
  // something useful — has to be answerable from a detached window too.
  const workers = l.workers.length ? l.workers : workersFromTraffic(recent)
  // Same reason: the config that matters is the one the run was started with,
  // not whatever happens to be in the directory this window was opened from.
  const ran = runConfig(run?.config_json) ?? cfg

  return {
    app: {
      url: appUrl,
      uptimeMs: Date.now() - (run?.started_at ?? Date.now()),
      build: build_,
      running: Date.now() - (run?.last_seen_at ?? 0) < 30_000,
      driver: shortModel(ran.driver.provider, ran.driver.model),
      planner: shortModel(ran.planner.provider, ran.planner.model),
      config: { explorers: ran.explorers, hammerers: ran.hammerers, confirmers: ran.confirmers },
    },
    counters: {
      pages: r.coverage.pages,
      pagesExplored: r.coverage.pagesExplored,
      endpoints: r.coverage.endpoints,
      endpointsHammered: r.coverage.endpointsHammered,
      writeEndpoints: r.coverage.writeEndpoints,
      fields: r.coverage.fields,
      fieldsPoked: r.coverage.fieldsPoked,
      accounts: r.coverage.accounts,
      recordings: r.coverage.recordings,
      findings: r.findings.filter((f) => f.state === 'open').length,
      unconfirmed: r.unconfirmed.length,
      frontier: queue.frontier(db),
      perAction: r.spend.perAction,
      spend: r.spend.usd,
    },
    tenancy: r.tenancy,
    workers,
    feed,
    hammers: l.hammers,
    starved: r.starved,
    events: r.events,
    findings: r.findings.map((f) => {
      const repro = (r.repro[f.id] ?? {}) as { steps?: unknown[]; detail?: string }
      return {
        id: f.id, kind: f.kind, title: f.title, reproduced: f.reproduced, attempts: f.attempts,
        reach: f.reach, state: f.state, occurrences: f.occurrences,
        firstSeen: f.first_seen_at, lastSeen: f.last_seen_at,
        detail: repro.detail ?? '', steps: repro.steps ?? [],
        recordings: r.recordingIds[f.id] ?? [],
      }
    }),
    unconfirmed: r.unconfirmed,
    map: {
      // Untouched first. Showing what you covered is flattering; showing what
      // you missed is useful.
      endpoints: map.endpoints(db).map((e) => ({
        method: e.method, path: e.path_pattern, calls: e.calls, writes: e.writes,
        hammered: e.hammered,
        statuses: Object.entries(JSON.parse(e.statuses_json) as Record<string, number>).map(([s, n]) => `${s}x${n}`).join(' '),
      })),
      pages: map.pages(db).map((p) => ({ pattern: p.url_pattern, title: p.title, visits: p.visits, explored: p.explored })),
      forms: map.forms(db).map((f) => {
        const fields = map.fieldsOf(db, f.id)
        return {
          name: f.name,
          fields: fields.length,
          poked: fields.filter((x) => (JSON.parse(x.tried_json) as string[]).length).length,
        }
      }).sort((a, b) => a.poked / Math.max(1, a.fields) - b.poked / Math.max(1, b.fields)),
    },
    accounts: accountsRepo.all(db).map((a) => ({
      email: a.email, role: a.role, verified: a.verified, state: a.state, created: a.created_at,
      requests: (db.prepare('SELECT COUNT(*) c FROM recordings WHERE account_id = ?').get(a.id) as { c: number }).c,
    })),
  }
}

function runConfig(json: string | undefined): Config | null {
  if (!json) return null
  try {
    return JSON.parse(json) as Config
  } catch {
    return null
  }
}

/**
 * Who was doing what, reconstructed from the last few minutes of traffic.
 * Coarser than the live view — it cannot tell thinking from acting — but it is
 * the difference between a detached window saying "no explorer has started
 * yet" under a run that is plainly working, and one that shows the run.
 */
function workersFromTraffic(rows: recordings.Recording[]): Array<Record<string, unknown>> {
  const seen = new Map<string, { at: number; path: string; status: number }>()
  for (const r of rows) {
    if (seen.has(r.worker)) continue
    seen.set(r.worker, { at: r.started_at, path: pathOf(r.url), status: r.status ?? 0 })
  }
  const now = Date.now()
  return [...seen.entries()]
    .map(([name, last]) => ({
      name,
      kind: name.startsWith('explorer') || name.startsWith('scout') ? 'explorer' : name.startsWith('confirmer') ? 'confirmer' : 'hammerer',
      state: now - last.at < 20_000 ? 'acting' : 'idle',
      account: null,
      where: last.path,
      did: `${last.status} · ${Math.round((now - last.at) / 1000)}s ago`,
      goal: '',
      at: last.at,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The rail is 196px wide, so this is a name, not a description. */
function shortModel(provider: string, model: string): string {
  if (provider === 'claude-code') return 'claude code'
  const name = model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
  return name.length > 16 ? name.slice(0, 15) + '…' : name
}

function pathOf(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + (u.search || '')
  } catch {
    return url
  }
}
