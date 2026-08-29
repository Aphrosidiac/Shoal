import type { DB } from '../store/db.js'
import * as findings from '../store/repo/findings.js'
import * as suspicions from '../store/repo/suspicions.js'
import * as recordings from '../store/repo/recordings.js'
import * as map from '../store/repo/map.js'
import * as coverage from '../store/repo/coverage.js'
import * as spend from '../store/repo/spend.js'
import { events, currentRun } from '../store/repo/run.js'

export type Starved = { action: string; tries: number; ok: number; statuses: string }

export type Report = {
  generatedAt: number
  appUrl: string
  startedAt: number
  tenancy: string | null
  findings: findings.Finding[]
  repro: Record<number, unknown>
  recordingIds: Record<number, number[]>
  unconfirmed: Array<{ id: number; expected: string; observed: string; worker: string }>
  coverage: {
    pages: number
    pagesExplored: number
    endpoints: number
    endpointsHammered: number
    writeEndpoints: number
    forms: number
    fields: number
    fieldsPoked: number
    accounts: number
    recordings: number
    actions: number
    untouchedPages: string[]
    untouchedEndpoints: string[]
  }
  starved: Starved[]
  events: Array<{ at: number; kind: string; message: string }>
  spend: spend.Spend & { perAction: number }
}

/** Regenerated from the store. Nothing is cached, so it is true when opened. */
export function build(db: DB, appUrl: string): Report {
  const run = currentRun(db, appUrl)
  const pages = map.pages(db)
  const eps = map.endpoints(db)
  const forms = map.forms(db)
  let fields = 0
  let poked = 0
  for (const f of forms) {
    for (const fd of map.fieldsOf(db, f.id)) {
      fields++
      if ((JSON.parse(fd.tried_json) as string[]).length) poked++
    }
  }

  const list = findings.ranked(db).filter((f) => f.kind !== 'noise' || f.state === 'open')
  const repro: Record<number, unknown> = {}
  const recIds: Record<number, number[]> = {}
  for (const f of list) {
    repro[f.id] = JSON.parse(f.repro_json) as unknown
    recIds[f.id] = findings.eventsOf(db, f.id)
  }

  const totals = spend.total(db)
  const actions = coverage.get(db, 'actions')

  return {
    generatedAt: Date.now(),
    appUrl,
    startedAt: run?.started_at ?? Date.now(),
    tenancy: run?.tenancy ?? null,
    findings: list,
    repro,
    recordingIds: recIds,
    unconfirmed: suspicions
      .all(db)
      .filter((s) => s.state === 'unreproduced')
      .slice(0, 40)
      .map((s) => ({ id: s.id, expected: s.expected, observed: s.observed, worker: s.worker })),
    coverage: {
      pages: pages.length,
      pagesExplored: pages.filter((p) => p.explored).length,
      endpoints: eps.length,
      endpointsHammered: eps.filter((e) => e.hammered > 0).length,
      writeEndpoints: eps.filter((e) => e.writes > 0).length,
      forms: forms.length,
      fields,
      fieldsPoked: poked,
      accounts: (db.prepare('SELECT COUNT(*) c FROM accounts').get() as { c: number }).c,
      recordings: recordings.count(db),
      actions,
      untouchedPages: pages.filter((p) => !p.explored).map((p) => p.url_pattern).slice(0, 40),
      untouchedEndpoints: eps.filter((e) => e.writes > 0 && e.hammered === 0).map((e) => `${e.method} ${e.path_pattern}`).slice(0, 40),
    },
    starved: starvation(db),
    events: events(db, 60),
    spend: { ...totals, perAction: actions ? totals.calls / actions : 0 },
  }
}

/**
 * A swarm being refused is not a swarm finding nothing. Anything tried five
 * times that has never once succeeded goes ABOVE the verdict, never below it.
 * An app where every write is refused looks exactly like an app with no bugs,
 * and without this a clean report is meaningless.
 */
const WRITE_ACTION = /^(POST|PUT|PATCH|DELETE) /

export function starvation(db: DB): Starved[] {
  return recordings
    .actionStats(db)
    .filter((r) => r.tries >= 5 && r.ok === 0)
    // A read that always answers 403 is the authorisation model working, and
    // calling that starvation turns the one warning that must never be
    // ignored into noise. Starvation is about writes we could never land.
    .filter((r) => WRITE_ACTION.test(r.action_fp))
    .sort((a, b) => b.tries - a.tries)
    .slice(0, 20)
    .map((r) => ({ action: r.action_fp, tries: r.tries, ok: r.ok, statuses: r.statuses ?? '' }))
}
