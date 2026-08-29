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
  const feed = l.feed.length
    ? l.feed
    : recordings.recent(db, 60).map((x) => ({
        at: x.started_at, method: x.method, path: pathOf(x.url), status: x.status ?? 0, ms: x.ms, worker: x.worker,
      }))

  return {
    app: {
      url: appUrl,
      uptimeMs: Date.now() - (run?.started_at ?? Date.now()),
      build: build_,
      running: Date.now() - (run?.last_seen_at ?? 0) < 30_000,
      driver: shortModel(cfg.driver.provider, cfg.driver.model),
      planner: shortModel(cfg.planner.provider, cfg.planner.model),
      config: { explorers: cfg.explorers, hammerers: cfg.hammerers, confirmers: cfg.confirmers },
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
    workers: l.workers,
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
