import type { Ctx } from '../ctx.js'
import type { Observed } from '../browser/record.js'
import { firstObject, parse, rowsOf, SENSITIVE_FIELD, idOf, type Signal } from './types.js'

/**
 * After every write, go and read it back. Created an invoice for 500? Open it.
 * Says 50? Bug.
 *
 * Enormously effective and needs no idea what the app is for. A silent write
 * failure leaves no error anywhere, and this is the only thing that sees it.
 */
const WRITE = new Set(['POST', 'PUT', 'PATCH'])

type Pending = {
  at: number
  accountId: number | null
  endpointId: number
  recordingId: number
  path: string
  where: string
  /** what the write said it saved, taken from its own response where it echoes */
  claimed: Record<string, unknown>
  id: string | null
}

const pending: Pending[] = []

export function readback(ctx: Ctx, o: Observed): Signal[] {
  void ctx
  const now = Date.now()
  while (pending.length && now - pending[0]!.at > 20_000) pending.shift()

  if (WRITE.has(o.method) && o.status >= 200 && o.status < 300) {
    const sent = (parse(o.reqBody) ?? {}) as Record<string, unknown>
    const echoed = firstObject(parse(o.resBody)) ?? {}
    const claimed: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(sent)) {
      if (SENSITIVE_FIELD.test(k)) continue
      if (v === null || v === undefined || v === '') continue
      if (typeof v === 'object') continue
      // Only fields the server itself acknowledged. If it never mentions the
      // field again, we have no claim to check and inventing one is how a
      // read-back check turns into a false positive machine.
      if (!(k in echoed)) continue
      claimed[k] = echoed[k]
    }
    if (Object.keys(claimed).length) {
      pending.push({
        at: now,
        accountId: o.accountId,
        endpointId: o.endpointId,
        recordingId: o.id,
        path: o.pattern,
        where: `${o.method} ${o.pattern}`,
        claimed,
        id: idOf(echoed),
      })
    }
    return []
  }

  if (o.method !== 'GET' || o.status < 200 || o.status >= 300) return []
  const body = parse(o.resBody)
  if (!body) return []

  const out: Signal[] = []
  for (let i = pending.length - 1; i >= 0; i--) {
    const p = pending[i]!
    if (p.accountId !== o.accountId) continue
    if (now - p.at > 20_000) continue
    // The read has to be of the same thing. Ids are per-collection, so
    // invoice 26 and order 26 both exist, and a page that refetches two lists
    // after one write will happily hand back the wrong 26. Matching on the id
    // alone reported "POST /api/orders says it saved ref and it did not" five
    // times out of five, against an app that saved it perfectly.
    if (!sameCollection(p.path, o.pattern)) continue
    const object = objectFor(body, p.id, Object.keys(p.claimed))
    if (!object) continue

    for (const [k, claimedValue] of Object.entries(p.claimed)) {
      if (!(k in object)) continue
      const readValue = object[k]
      if (same(claimedValue, readValue)) continue
      out.push({
        check: 'wrong.readback',
        kind: 'wrong',
        title: `${p.where} says it saved ${k}, and it did not`,
        detail:
          `The write answered with ${k}=${show(claimedValue)}. Reading the same object back through ` +
          `${o.method} ${o.pattern} returns ${k}=${show(readValue)}. Nothing reported an error, so the caller ` +
          `has no way to know the value was dropped.`,
        expected: `${k} to be ${show(claimedValue)} after the write said it was`,
        observed: `${k} is ${show(readValue)}`,
        endpointId: p.endpointId,
        recordingId: p.recordingId,
        data: { field: k, claimed: claimedValue, read: readValue, readEndpointId: o.endpointId, objectId: p.id },
      })
    }
    pending.splice(i, 1)
  }
  return out
}

function objectFor(body: unknown, id: string | null, claimed: string[]): Record<string, unknown> | null {
  const holds = (r: Record<string, unknown>): boolean => claimed.every((k) => k in r)
  const rows = rowsOf(body)
  if (rows.length && id) {
    const hit = rows.find((r) => idOf(r) === id && holds(r))
    if (hit) return hit
  }
  const one = firstObject(body)
  if (one && holds(one) && (!id || idOf(one) === null || idOf(one) === id)) return one
  return null
}

/** /api/orders and /api/orders/:id are the same thing; /api/invoices is not. */
function sameCollection(writePattern: string, readPattern: string): boolean {
  const trim = (p: string): string => p.replace(/\/:id.*$/, '').replace(/\/$/, '')
  const a = trim(writePattern)
  const b = trim(readPattern)
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/')
}

/** Servers normalise. Trimming and case are not bugs; losing the value is. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 1e-9
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b)
  const sa = String(a).trim()
  const sb = String(b).trim()
  if (sa.toLowerCase() === sb.toLowerCase()) return true
  // an ISO date and a date string for the same instant are the same value
  const da = Date.parse(sa)
  const dbb = Date.parse(sb)
  if (Number.isFinite(da) && Number.isFinite(dbb) && Math.abs(da - dbb) < 1000) return true
  return false
}

const show = (v: unknown): string => (typeof v === 'string' ? JSON.stringify(v.slice(0, 60)) : String(v))

/** Between runs the window means nothing. */
export const resetReadback = (): void => {
  pending.length = 0
}
