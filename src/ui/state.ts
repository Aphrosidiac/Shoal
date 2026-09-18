import type { DB } from '../store/db.js'
import type { Config } from '../config.js'
import { build } from '../report/build.js'
import * as map from '../store/repo/map.js'
import * as accountsRepo from '../store/repo/accounts.js'
import * as recordings from '../store/repo/recordings.js'
import * as queue from '../store/repo/queue.js'
import { currentRun } from '../store/repo/run.js'
import { live } from './live.js'
import * as steps from '../store/repo/steps.js'
import * as suspicions from '../store/repo/suspicions.js'
import * as spend from '../store/repo/spend.js'

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

  const running = Boolean(run) && Date.now() - (run?.last_seen_at ?? 0) < 30_000 && !run?.stopped_at
  return {
    run: {
      exists: Boolean(run),
      running,
      startedAt: run?.started_at ?? null,
      stoppedAt: run?.stopped_at ?? null,
      forMs: ran.forMs ?? null,
      endsAt: run && ran.forMs ? run.started_at + ran.forMs : null,
      url: appUrl,
      dir: cfg.dir,
      maxUsd: ran.jev?.maxUsd ?? null,
      explorers: ran.explorers,
    },
    app: {
      url: appUrl,
      uptimeMs: Date.now() - (run?.started_at ?? Date.now()),
      build: build_,
      running,
      driver: `typesafe / ${ran.jev?.model ?? 'jev-latest'}`,
      planner: ran.planner ? shortModel(ran.planner.provider, ran.planner.model) : 'code',
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
      const repro = (r.repro[f.id] ?? {}) as { steps?: unknown[]; detail?: string; check?: string; screen?: string }
      const ep = f.endpoint_id ? map.endpointById(db, f.endpoint_id) : undefined
      return {
        id: f.id, kind: f.kind, title: f.title, reproduced: f.reproduced, attempts: f.attempts,
        reach: f.reach, state: f.state, occurrences: f.occurrences,
        firstSeen: f.first_seen_at, lastSeen: f.last_seen_at,
        detail: repro.detail ?? '', steps: repro.steps ?? [],
        check: repro.check ?? f.kind,
        where: repro.screen ?? (ep ? `${ep.method} ${ep.path_pattern}` : ''),
        surface: repro.screen ? 'screen' : 'http',
        recordings: r.recordingIds[f.id] ?? [],
        evidence: evidenceFor(db, f.fingerprint),
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
    judge: judgeState(db),
    steps: steps.recent(db, 48).map(stepSummary),
    suspicions: suspicions.all(db).slice(0, 300).map(suspicionSummary),
  }
}

/**
 * A screen finding's proof is a picture: the rewalk step that reproduced it
 * in a fresh account, and the step that first saw it. Found through the
 * suspicion that carries the finding's fingerprint.
 */
function evidenceFor(db: DB, fp: string): Array<{ stepId: number; shot: string | null; phase: string; at: number }> {
  const sus = db.prepare("SELECT id FROM suspicions WHERE note LIKE ? ORDER BY id").all(`%"fp":"${fp}"%`) as Array<{ id: number }>
  if (!sus.length) return []
  const out: Array<{ stepId: number; shot: string | null; phase: string; at: number }> = []
  for (const s of sus) {
    const rows = db
      .prepare("SELECT id, shot, phase, at FROM steps WHERE (rewalk_of = ? AND verdicts_json != '[]') OR suspicion_ids LIKE ? ORDER BY id DESC LIMIT 3")
      .all(s.id, `%${s.id}%`) as Array<{ id: number; shot: string | null; phase: string; at: number }>
    for (const r of rows) out.push({ stepId: r.id, shot: r.shot, phase: r.phase, at: r.at })
  }
  return out.slice(0, 4)
}

function judgeState(db: DB): Record<string, unknown> {
  const st = steps.stats(db)
  const jev = spend.byTier(db, 'jev')
  const sus = suspicions.counts(db)
  return {
    steps: st.steps, withVerdict: st.withVerdict, rewalks: st.rewalks, medianMs: st.judgedMs,
    calls: jev.calls, tokens: jev.in_tokens, usd: jev.usd,
    suspicions: { open: sus.open ?? 0, confirmed: sus.confirmed ?? 0, unreproduced: sus.unreproduced ?? 0 },
  }
}

export function stepSummary(r: steps.StepRow): Record<string, unknown> {
  const answers = safe(r.answers_json) as Record<string, unknown>
  const top = Object.entries(answers)
    .filter(([k, v]) => typeof v === 'number' && k !== 'goal.done' && !k.startsWith('shows.'))
    .map(([k, v]) => [k, v as number] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
  const action = safe(r.action_json) as { op?: string; target?: { role: string; name: string }; text?: string }
  const decision = r.decision_json ? (safe(r.decision_json) as Record<string, unknown>) : null
  return {
    id: r.id, at: r.at, worker: r.worker, phase: r.phase, account: r.account, goal: r.goal,
    path: r.path, pattern: r.url_pattern, kind: r.kind,
    action: action.op === 'goto' ? `open ${r.path}` : action.target ? `${action.op} ${action.target.role} "${action.target.name}"${action.text ? ` = ${action.text.slice(0, 30)}` : ''}` : action.op ?? '',
    decision: decision
      ? { operation: decision.operation, target: decision.target, option: decision.option, confidence: decision.confidence, targetConfidence: decision.targetConfidence }
      : null,
    top, verdicts: safe(r.verdicts_json), entered: safe(r.entered_json), changed: !!r.changed,
    tokens: r.tokens, ms: r.ms, cached: !!r.cached, shot: r.shot, rewalkOf: r.rewalk_of,
    suspicions: safe(r.suspicion_ids),
  }
}

export function stepDetail(r: steps.StepRow): Record<string, unknown> {
  return { ...stepSummary(r), answers: safe(r.answers_json), decisionFull: r.decision_json ? safe(r.decision_json) : null, actionFull: safe(r.action_json) }
}

function suspicionSummary(s: suspicions.Suspicion): Record<string, unknown> {
  const n = safe(s.note) as Record<string, unknown>
  const trail = (n.trail as unknown[] | undefined) ?? []
  return {
    id: s.id, at: s.created_at, state: s.state, source: s.source, worker: s.worker,
    check: (n.check as string) ?? (s.source === 'screen' ? 'screen' : 'http'),
    kind: (n.kind as string) ?? null,
    p: typeof n.p === 'number' ? n.p : null,
    screen: (n.urlPattern as string) ?? null,
    title: (n.title as string) ?? s.expected,
    expected: s.expected, observed: s.observed,
    retries: Number(n.retries ?? 0),
    trail: trail.slice(-14),
    recording: s.recording_id,
  }
}

function safe(json: string | null): unknown {
  if (!json) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
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

/** Before any run exists in the directory: enough for the front door to draw itself. */
export function emptyState(cfg: Config): Record<string, unknown> {
  return {
    run: { exists: false, running: false, startedAt: null, stoppedAt: null, forMs: null, endsAt: null, url: cfg.url, dir: cfg.dir, maxUsd: cfg.jev.maxUsd, explorers: cfg.explorers },
    app: { url: cfg.url, uptimeMs: 0, build: '', running: false, driver: `typesafe / ${cfg.jev.model}`, planner: cfg.planner ? 'planner' : 'code', config: { explorers: cfg.explorers, hammerers: cfg.hammerers, confirmers: cfg.confirmers } },
    counters: { pages: 0, pagesExplored: 0, endpoints: 0, endpointsHammered: 0, writeEndpoints: 0, fields: 0, fieldsPoked: 0, accounts: 0, recordings: 0, findings: 0, unconfirmed: 0, frontier: 0, perAction: 0, spend: 0 },
    tenancy: null, workers: [], feed: [], hammers: [], starved: [], events: [], findings: [], unconfirmed: [],
    map: { endpoints: [], pages: [], forms: [] }, accounts: [],
    judge: { steps: 0, withVerdict: 0, rewalks: 0, medianMs: 0, calls: 0, tokens: 0, usd: 0, suspicions: { open: 0, confirmed: 0, unreproduced: 0 } },
    steps: [], suspicions: [],
  }
}
