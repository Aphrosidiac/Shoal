import type { Ctx } from '../../ctx.js'
import type { Item } from '../../store/repo/queue.js'
import type { Replayer } from '../../replay/request.js'
import type { Recording } from '../../store/repo/recordings.js'
import * as recordings from '../../store/repo/recordings.js'
import * as map from '../../store/repo/map.js'
import { volley, spread, type Shot, type ShotSpec } from '../../replay/barrier.js'
import { decide, type Attempt, type ReproStep } from '../../replay/verdict.js'
import { endpointLabel } from '../../watch/index.js'
import * as findings from '../../store/repo/findings.js'
import { findingFp } from '../../map/fingerprint.js'
import { firstObject, parse } from '../../watch/types.js'
import { pathOf, readBackUrl } from '../../replay/probes.js'
import { safeHeaders } from '../../replay/request.js'
import { live } from '../../ui/live.js'
import { smallestWave } from '../../replay/shrink.js'
import * as coverage from '../../store/repo/coverage.js'

const WAVE = 8

/**
 * Where races come from, with no database in sight.
 *
 * The trick is that nothing here needs to know what the app means by any of
 * its numbers. It measures what one write does to the object, then fires
 * several at once and checks whether the object moved by as much as the app
 * itself claimed. If four payments were accepted and only one landed, the
 * app's own two answers disagree, and that is the whole proof.
 */
export async function runHammer(ctx: Ctx, rp: Replayer, item: Item): Promise<string> {
  const p = JSON.parse(item.payload_json) as { endpointId: number; shape: 'same-row' | 'shared-resource' | 'cross-action'; round?: number }
  const endpoint = map.endpointById(ctx.db, p.endpointId)
  if (!endpoint) return 'that endpoint is gone'
  const rec = pickSeed(ctx, p.endpointId)
  if (!rec) return 'nothing recorded to fire'
  if (/logout|sign_?out|register|signup/i.test(rec.url)) return 'not hammering the door'

  const label = endpointLabel(ctx, p.endpointId)
  map.markHammered(ctx.db, p.endpointId)

  // Already proven here. Later rounds still fire — hammering is also how the
  // app accumulates the rows that other checks need — but re-running a
  // five-attempt verdict and a shrink on a finding we already have burns the
  // confirmers that everything else is queued behind, and adds nothing but a
  // counter. One volley, recorded, and out.
  const known = findings.byFingerprint(ctx.db, findingFp(label, 'race.lostupdate', p.shape))
  if (known && known.state === 'open') {
    const rec2 = pickSeed(ctx, p.endpointId)
    if (rec2) {
      const waveId = `wave-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const shots = buildShots(ctx, rec2, p.shape, WAVE)
      live.hammer({ endpoint: label, shape: p.shape, workers: shots.length, at: Date.now() })
      await volley(ctx, shots, waveId)
      findings.touch(ctx.db, known.fingerprint, null)
    }
    return `${p.shape}: already known here, fired anyway for the data`
  }

  let width = WAVE
  let unhammerable = false
  const f = await decide(ctx, {
    check: 'race.lostupdate',
    kind: 'race',
    title: `${label} loses writes when they overlap`,
    detail:
      'Concurrent requests produced state no serial order could. The app accepted every one of them and told the ' +
      'caller so, and then kept only some.',
    endpointId: p.endpointId,
    attempts: 3,
    fingerprint: findingFp(label, 'race.lostupdate', p.shape),
    attempt: async () => {
      const a = await attempt(ctx, rp, rec, p.shape, width)
      if (a.verdict === 'inconclusive' && /nothing to read the result back from|no number we can see/.test(a.why ?? '')) {
        unhammerable = true
      }
      return a
    },
  })
  if (!f) {
    if (unhammerable) {
      // Some endpoints have nothing countable behind them at all. Queuing
      // round after round against those crowds out the ones that do, and
      // fills the log with the same sentence forever.
      coverage.set(ctx.db, `nohammer:${p.endpointId}`, 1)
      ctx.log('hammer', `nothing to measure behind ${label}; not hammering it again`)
    }
    return `${p.shape}: writes survived`
  }

  // Now cut it down. The number in the report should be the smallest number of
  // people that can do this to you, not the number we happened to use.
  const small = await smallestWave(ctx, WAVE, (n) => attempt(ctx, rp, rec, p.shape, n))
  width = small.width
  if (small.attempt && width < WAVE) {
    const detail =
      `${small.attempt.detail ?? ''}\n\nShrunk from ${WAVE} concurrent requests to ${width}: it does not take a crowd.`
    ctx.db
      .prepare('UPDATE findings SET repro_json = ?, reach = ? WHERE id = ?')
      .run(
        JSON.stringify({ check: 'race.lostupdate', steps: small.attempt.steps, shrunkFrom: WAVE, detail }),
        small.attempt.steps.length,
        f.id
      )
    ctx.log('shrink', `${label} still loses writes with ${width} at once, down from ${WAVE}`)
  }
  return `confirmed a lost update (${p.shape}, ${width} at once)`
}

function pickSeed(ctx: Ctx, endpointId: number): Recording | undefined {
  const rows = recordings.forEndpoint(ctx.db, endpointId, 30)
  return rows.find((r) => r.status !== null && r.status >= 200 && r.status < 300 && r.account_id !== null)
}

type Snap = Record<string, number>

async function attempt(ctx: Ctx, rp: Replayer, rec: Recording, shape: string, width = WAVE): Promise<Attempt> {
  const objectUrl = objectUrlFor(rec.url) ?? readBackUrl(ctx, rec, null)
  if (!objectUrl) return { verdict: 'inconclusive', steps: [], recordingIds: [], why: 'nothing to read the result back from' }

  const read = async (): Promise<Snap | null> => {
    const r = await rp.fire({ method: 'GET', url: objectUrl, accountId: rec.account_id })
    if (r.status !== 200) return null
    return numbers(r.json)
  }

  const before = await read()
  if (!before) return { verdict: 'inconclusive', steps: [], recordingIds: [], why: 'could not read the object back' }

  // Calibrate: what does exactly one of these writes do? Everything after this
  // is measured against the app's own behaviour, not against an assumption.
  const one = await rp.replay(rec)
  if (one.status < 200 || one.status >= 300) {
    return { verdict: 'inconclusive', steps: [], recordingIds: [], why: `a single write answers ${one.status}, so there is nothing to race` }
  }
  const middle = await read()
  if (!middle) return { verdict: 'inconclusive', steps: [], recordingIds: [], why: 'could not read the object back' }

  const delta: Snap = {}
  for (const [k, v] of Object.entries(middle)) {
    const d = v - (before[k] ?? 0)
    if (Math.abs(d) > 1e-9) delta[k] = d
  }
  if (!Object.keys(delta).length) {
    return {
      verdict: 'inconclusive',
      steps: [],
      recordingIds: [],
      why:
        `one write changes no number we can see at ${pathOf(objectUrl)}, so there is nothing to count ` +
        `(${Object.entries(before).slice(0, 6).map(([k, v]) => `${k}=${v}`).join(' ') || 'no numbers at all'})`,
    }
  }

  const waveId = `wave-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const shots = buildShots(ctx, rec, shape, width)
  live.hammer({ endpoint: `${rec.method} ${pathOf(rec.url)}`, shape, workers: shots.length, at: Date.now() })
  const fired = await volley(ctx, shots, waveId)
  const ok = fired.filter((s) => s.status >= 200 && s.status < 300)
  const landed = spread(fired)

  // A volley that arrived spread over a second did not race anything, and
  // saying it did would be reporting our own slowness as the app's bug.
  if (landed > 1500) {
    return { verdict: 'inconclusive', steps: [], recordingIds: ids(fired), why: `the volley landed ${landed}ms apart, which is not a race` }
  }
  if (ok.length < 2) {
    return { verdict: 'inconclusive', steps: [], recordingIds: ids(fired), why: `only ${ok.length} of ${fired.length} were accepted, so nothing overlapped` }
  }

  const after = await read()
  if (!after) return { verdict: 'inconclusive', steps: [], recordingIds: ids(fired), why: 'could not read the object back' }

  /**
   * The counting argument — N writes accepted, so the figure should have moved
   * N times as far — only holds when every request in the volley did the same
   * thing to the same object.
   *
   * The other two shapes deliberately do not. `shared-resource` sends each
   * worker at a different object, so a per-object counter moving by one while
   * eight were accepted is the shape working, not a lost update. That mistake
   * reported a correctly serialising booking endpoint as a race, twice, which
   * is exactly the failure the fixture's non-bugs exist to catch.
   */
  if (shape === 'same-row') {
    for (const [k, d] of Object.entries(delta)) {
      const expected = (middle[k] ?? 0) + ok.length * d
      const actual = after[k] ?? 0
      const moved = actual - (middle[k] ?? 0)
      const shouldHaveMoved = ok.length * d
      if (Math.abs(actual - expected) < Math.abs(d) * 0.5) continue
      if (Math.sign(moved) !== Math.sign(shouldHaveMoved) && moved !== 0) continue
      if (Math.abs(moved) >= Math.abs(shouldHaveMoved)) continue

      const applied = Math.round(moved / d)
      return {
        verdict: 'reproduced',
        steps: [
          { method: 'GET', path: pathOf(objectUrl), status: `200  ${k}=${middle[k]}`, note: 'before' },
          { method: rec.method, path: pathOf(rec.url), status: `${ok.length} x ${ok[0]!.status}`, note: `${fired.length} at once, ${landed}ms apart` },
          { method: 'GET', path: pathOf(objectUrl), status: `200  ${k}=${actual}`, note: `should be ${expected}` },
        ],
        recordingIds: ids(fired),
        detail:
          `One of these writes moves ${k} by ${d}. ${fired.length} were fired together and ${ok.length} were accepted with ` +
          `${ok[0]!.status}, so ${k} should have reached ${expected}. It reached ${actual}: ${applied} of the ${ok.length} ` +
          `accepted writes actually landed. The responses went out ${landed}ms apart, which is inside one read-modify-write window.`,
      }
    }
    return { verdict: 'clean', steps: [], recordingIds: ids(fired) }
  }

  if (shape === 'shared-resource') {
    // Different objects competing for one scarce thing. What goes wrong here
    // is not a figure that moved too little, it is a limit that was passed:
    // five bookings for the last slot, all accepted.
    const over = overCapacity(after)
    if (!over) return { verdict: 'clean', steps: [], recordingIds: ids(fired) }
    return {
      verdict: 'reproduced',
      steps: [
        { method: rec.method, path: pathOf(rec.url), status: `${ok.length} x ${ok[0]!.status}`, note: `${fired.length} at once for different objects, ${landed}ms apart` },
        { method: 'GET', path: pathOf(objectUrl), status: `200  ${over.usedKey}=${over.used} ${over.capKey}=${over.cap}` },
      ],
      recordingIds: ids(fired),
      detail:
        `${ok.length} of ${fired.length} concurrent requests were accepted, and afterwards ${over.usedKey} is ${over.used} ` +
        `against ${over.capKey} of ${over.cap}. The limit is checked, but not while anything else is checking it.`,
    }
  }

  // cross-action: two different operations reaching for the same thing. The
  // volley is worth firing — the watchers see everything it causes — but the
  // counting argument cannot be applied to it, and guessing would be worse
  // than saying nothing.
  return { verdict: 'clean', steps: [], recordingIds: ids(fired) }
}

const USED = /^(booked|used|taken|allocated|reserved|filled|sold|claimed|count)$/i
const CAP = /^(capacity|limit|max|max_.*|total|available|seats|stock|quantity)$/i

function overCapacity(snap: Snap): { usedKey: string; used: number; capKey: string; cap: number } | null {
  const usedKey = Object.keys(snap).find((k) => USED.test(k))
  const capKey = Object.keys(snap).find((k) => CAP.test(k))
  if (!usedKey || !capKey) return null
  const used = snap[usedKey]!
  const cap = snap[capKey]!
  if (!(cap > 0) || used <= cap) return null
  return { usedKey, used, capKey, cap }
}

/**
 * Same row: everyone hits one object. Five people paying one invoice.
 * Shared resource: different objects competing for one scarce thing. Identical
 *   arguments here would book one thing five times and prove nothing, so each
 *   worker gets its own variant.
 * Cross action: two different operations reaching for the same thing.
 */
function buildShots(ctx: Ctx, rec: Recording, shape: string, width = WAVE): ShotSpec[] {
  const headers = safeHeaders(rec.req_headers)
  const base: ShotSpec = {
    method: rec.method,
    path: pathOf(rec.url),
    headers: { ...headers, 'content-type': headers['content-type'] ?? 'application/json' },
    body: rec.req_body,
    accountId: rec.account_id,
  }

  if (shape === 'shared-resource') {
    const variants = distinctBodies(ctx, rec)
    return Array.from({ length: width }, (_, i) => ({ ...base, body: variants[i % variants.length] ?? rec.req_body }))
  }

  if (shape === 'cross-action') {
    const partner = siblingWrite(ctx, rec)
    if (!partner) return Array.from({ length: width }, () => base)
    const other: ShotSpec = {
      method: partner.method,
      path: pathOf(partner.url),
      headers: { ...safeHeaders(partner.req_headers), 'content-type': 'application/json' },
      body: partner.req_body,
      accountId: partner.account_id,
    }
    return Array.from({ length: width }, (_, i) => (i % 2 ? other : base))
  }

  return Array.from({ length: width }, () => base)
}

function distinctBodies(ctx: Ctx, rec: Recording): Array<string | null> {
  const rows = recordings.forEndpoint(ctx.db, rec.endpoint_id ?? 0, 40)
  const seen = new Map<string, string | null>()
  for (const r of rows) {
    if (r.status === null || r.status < 200 || r.status >= 300) continue
    seen.set(r.req_body ?? '', r.req_body)
    if (seen.size >= WAVE) break
  }
  return seen.size ? [...seen.values()] : [rec.req_body]
}

/** Another write against the same object, for the cross-action shape. */
function siblingWrite(ctx: Ctx, rec: Recording): Recording | undefined {
  const object = objectUrlFor(rec.url)
  if (!object) return undefined
  const prefix = new URL(object).pathname
  return ctx.db
    .prepare(
      `SELECT * FROM recordings
       WHERE method IN ('POST','PUT','PATCH') AND status >= 200 AND status < 300
         AND endpoint_id IS NOT ? AND url LIKE ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(rec.endpoint_id, `%${prefix}%`) as Recording | undefined
}

/** /api/invoices/8/payments -> /api/invoices/8 */
export function objectUrlFor(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const parts = u.pathname.split('/').filter(Boolean)
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^\d+$/.test(parts[i]!) || /^[0-9a-f-]{16,}$/i.test(parts[i]!)) {
      return `${u.origin}/${parts.slice(0, i + 1).join('/')}`
    }
  }
  return null
}

/**
 * Every stored figure we can see on the object.
 *
 * Deliberately NOT the number of rows in the answer. A list caps its own page,
 * so once there are more rows than the page holds the count stops moving —
 * and a page size read as a stored figure makes every write endpoint in the
 * app look like it loses writes. That produced two false positives against a
 * correctly serialising endpoint before it was taken out.
 */
function numbers(json: unknown): Snap {
  const out: Snap = {}
  const object = firstObject(json)
  if (object) {
    for (const [k, v] of Object.entries(object)) {
      if (/_at$|^created|^updated|^id$|_id$/i.test(k)) continue
      const n = Number(v)
      if (typeof v !== 'object' && Number.isFinite(n)) out[k] = n
    }
  }
  const top = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, number>) : null
  if (top) for (const k of ['total', 'count', 'sum']) if (Number.isFinite(Number(top[k]))) out[`(${k})`] = Number(top[k])
  return out
}

const ids = (shots: Shot[]): number[] => shots.map((s) => s.recordingId).filter((x): x is number => x !== null).slice(0, 6)

export const _parse = parse
