import type { Ctx } from '../ctx.js'
import { onRecording, type Observed } from '../browser/record.js'
import * as suspicions from '../store/repo/suspicions.js'
import * as findings from '../store/repo/findings.js'
import * as queue from '../store/repo/queue.js'
import * as coverage from '../store/repo/coverage.js'
import { findingFp } from '../map/fingerprint.js'
import { faults } from './faults.js'
import { readback } from './readback.js'
import { money } from './money.js'
import { parse, rowsOf, idOf, type Signal } from './types.js'
import { scoreOf } from '../queue/score.js'

/**
 * The registry every recording is passed through. Nothing in here may call a
 * model, and nothing in here writes a finding: a check produces a suspicion,
 * and only replay promotes one.
 */
const CHECKS: Array<(ctx: Ctx, o: Observed) => Signal[]> = [faults, readback, money]

const filed = new Set<string>()

export function watch(ctx: Ctx): void {
  onRecording((o) => {
    for (const check of CHECKS) {
      let signals: Signal[] = []
      try {
        signals = check(ctx, o)
      } catch {
        continue
      }
      for (const s of signals) file(ctx, s)
    }
    try {
      seedProbes(ctx, o)
    } catch {
      /* probes are opportunistic */
    }
  })
}

export function signalFingerprint(s: Signal, endpointLabel: string): string {
  const shape = s.check === 'fault.5xx' ? String(s.data?.status ?? '') : String(s.data?.field ?? s.data?.shape ?? '')
  return findingFp(endpointLabel, s.check, shape)
}

/**
 * The same bug seen nine hundred times increments a counter; it does not add a
 * row. Without this a 24-hour run produces a report listing one bug nine
 * hundred times, and nothing else matters if this is broken.
 */
export function file(ctx: Ctx, s: Signal): number | null {
  const label = endpointLabel(ctx, s.endpointId)
  const fp = signalFingerprint(s, label)
  if (findings.touch(ctx.db, fp, s.recordingId)) return null
  if (filed.has(fp)) return null

  const openSame = ctx.db
    .prepare("SELECT id FROM suspicions WHERE state IN ('open','confirmed') AND note LIKE ? LIMIT 1")
    .get(`%"fp":"${fp}"%`) as { id: number } | undefined
  if (openSame) return null

  filed.add(fp)
  const id = suspicions.file(ctx.db, {
    source: 'watch',
    worker: 'watch',
    recording_id: s.recordingId,
    expected: s.expected,
    observed: s.observed,
    note: JSON.stringify({ ...s, fp, endpoint: label }),
  })
  coverage.bump(ctx.db, 'suspicions')
  return id
}

export function endpointLabel(ctx: Ctx, endpointId: number | null): string {
  if (!endpointId) return '(no endpoint)'
  const row = ctx.db.prepare('SELECT method, path_pattern FROM endpoints WHERE id = ?').get(endpointId) as
    | { method: string; path_pattern: string }
    | undefined
  return row ? `${row.method} ${row.path_pattern}` : '(no endpoint)'
}

/** Between processes the dedupe set is rebuilt from the store anyway. */
export const resetFiled = (): void => filed.clear()

// ---------------------------------------------------------------------------
// Probes.
//
// Some checks cannot be made from watching alone — walking every page of a
// list, or sending the same request twice, means doing something rather than
// noticing something. Those are seeded here as `confirm` work and carried out
// by the confirmer, which means they file nothing at all unless they
// reproduce. A probe that finds nothing never appears anywhere, so the
// "not confirmed" section stays about genuine near-misses.
// ---------------------------------------------------------------------------

const seenObjects = new Map<string, number>()
const corridors = new Map<string, { open?: Observed; locked?: Observed }>()

function seedProbes(ctx: Ctx, o: Observed): void {
  roleGap(ctx, o)
  if (o.status < 200 || o.status >= 300) return

  if (o.method === 'GET') {
    const body = parse(o.resBody)
    const rows = rowsOf(body)
    const paged = looksPaged(o.url, body)
    if (paged && rows.length) {
      // A list that fits on one page cannot lose a row. As it grows the same
      // list becomes worth walking again, so the key carries a size bucket
      // rather than pinning one verdict forever.
      const bucket = Math.floor(Math.log2(Math.max(1, totalOf(body) ?? rows.length)))
      push(ctx, 'paging.walk', `paging:${o.endpointId}:${bucket}`, { probe: 'paging.walk', endpointId: o.endpointId, recordingId: o.id })
    }
    // the same object turning up under two endpoints is what makes a
    // consistency check possible at all
    for (const r of rows.slice(0, 20)) {
      const id = idOf(r)
      if (!id) continue
      const key = `${o.pattern.replace(/\/:id.*$/, '')}:${id}`
      const other = seenObjects.get(key)
      if (other && other !== o.endpointId) {
        push(ctx, 'wrong.consistency', `consistency:${Math.min(other, o.endpointId)}:${Math.max(other, o.endpointId)}`, {
          probe: 'wrong.consistency',
          endpointId: o.endpointId,
          otherEndpointId: other,
          objectId: id,
          recordingId: o.id,
        })
      } else if (!other) seenObjects.set(key, o.endpointId)
      if (seenObjects.size > 4000) seenObjects.clear()
    }
    const one = rows.length ? null : body
    if (one && typeof one === 'object') {
      const id = idOf(one as Record<string, unknown>)
      if (id) {
        const key = `${o.pattern.replace(/\/:id.*$/, '')}:${id}`
        const other = seenObjects.get(key)
        if (other && other !== o.endpointId) {
          push(ctx, 'wrong.consistency', `consistency:${Math.min(other, o.endpointId)}:${Math.max(other, o.endpointId)}`, {
            probe: 'wrong.consistency',
            endpointId: o.endpointId,
            otherEndpointId: other,
            objectId: id,
            recordingId: o.id,
          })
        } else if (!other) seenObjects.set(key, o.endpointId)
      }
    }
    return
  }

  if (o.method === 'POST' || o.method === 'PUT') {
    // Only where the app's own front end declared the intent. An app with no
    // idempotency keys anywhere is not claiming idempotency, and reporting it
    // for every write would be exactly the cry-wolf failure the fixture exists
    // to catch.
    const key = Object.keys(o.reqHeaders).find((h) => /idempotency|x-request-id|x-idempotency/i.test(h))
    if (key) {
      push(ctx, 'idempotency.double', `idem:${o.endpointId}`, {
        probe: 'idempotency.double',
        endpointId: o.endpointId,
        recordingId: o.id,
        header: key,
      })
    }
  }
}

export function totalOf(v: unknown): number | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  for (const k of ['total', 'count', 'totalCount', 'total_count']) {
    const n = Number(o[k])
    if (Number.isFinite(n)) return n
  }
  return null
}

function looksPaged(url: string, body: unknown): boolean {
  try {
    const q = new URL(url).searchParams
    if (q.has('page') || q.has('offset') || q.has('cursor') || q.has('limit') || q.has('per_page')) return true
  } catch {
    /* not a url we can read */
  }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const o = body as Record<string, unknown>
    return ('total' in o || 'count' in o || 'totalCount' in o) && rowsOf(o).length > 0
  }
  return false
}

function push(ctx: Ctx, check: string, dedupe: string, payload: Record<string, unknown>): void {
  queue.push(ctx.db, {
    kind: 'confirm',
    payload: { ...payload, check },
    score: scoreOf(ctx.db, 'confirm', {}),
    dedupeKey: `probe:${dedupe}`,
  })
}

/**
 * A role gap is only visible against a role check that works. An endpoint
 * called "admin" proves nothing on its own — plenty of apps have an /admin URL
 * and no roles at all, and reporting those would be exactly the cry-wolf
 * failure the fixture exists to catch.
 *
 * So we wait for the contrast: one address under a prefix that refuses an
 * ordinary account, and a neighbour under the same prefix that does not.
 */
function roleGap(ctx: Ctx, o: Observed): void {
  if (o.method !== 'GET' || o.accountId === null) return
  const parts = o.pattern.split('/').filter(Boolean)
  if (parts.length < 2) return
  const prefix = '/' + parts.slice(0, -1).join('/')
  if (prefix === '/api' || prefix === '/') return

  const key = `${o.accountId}|${prefix}`
  const c = corridors.get(key) ?? {}
  if (o.status === 401 || o.status === 403) c.locked = o
  else if (o.status >= 200 && o.status < 300) c.open = o
  else return
  corridors.set(key, c)
  if (corridors.size > 500) corridors.clear()

  if (!c.open || !c.locked) return
  if (c.open.endpointId === c.locked.endpointId) return

  push(ctx, 'auth.role', `role:${c.open.endpointId}`, {
    probe: 'auth.role',
    endpointId: c.open.endpointId,
    recordingId: c.open.id,
    lockedRecordingId: c.locked.id,
    asAccount: o.accountId,
  })
}

export const resetProbeMemory = (): void => {
  seenObjects.clear()
  corridors.clear()
}
