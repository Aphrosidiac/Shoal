import type { Ctx } from '../ctx.js'
import type { Replayer } from './request.js'
import type { Attempt, ReproStep } from './verdict.js'
import * as recordings from '../store/repo/recordings.js'
import * as map from '../store/repo/map.js'
import type { Recording } from '../store/repo/recordings.js'
import { firstObject, idOf, parse, rowsOf } from '../watch/types.js'
import { unescapeJson } from '../watch/faults.js'

/**
 * How each check reproduces itself, at HTTP speed, with no model anywhere. A
 * repro that needs a model to reproduce is not a repro.
 */

const STACK = [/\n\s+at [\w$.<>[\]\s]+ \(?[/\\][^\s)]+:\d+:\d+\)?/, /\n\s+File "[^"]+", line \d+/, /goroutine \d+ \[/, /\bTraceback \(most recent call last\)/]
const SQL = /\b(?:SQLITE_|SQLSTATE|ORA-\d{5}|PG::|near "\w+": syntax error)\b/
const ERROR_IN_200 = /"(?:error|errors|exception|error_message|errorMessage)"\s*:\s*(?!null|false|""|\[\]|\{\})/

const step = (r: Recording | { method: string; url: string }, status: number | string, note?: string, as?: string): ReproStep => ({
  method: r.method.toUpperCase(),
  path: pathOf(r.url),
  status,
  ...(as ? { as } : {}),
  ...(note ? { note } : {}),
})

export const pathPatternOf = (ctx: Ctx, url: string): string => {
  try {
    return ctx.patterns.pattern(new URL(url).pathname)
  } catch {
    return url
  }
}

function safeCt(raw: string | null): string {
  if (!raw) return ''
  try {
    return String((JSON.parse(raw) as Record<string, string>)['content-type'] ?? '')
  } catch {
    return ''
  }
}

export function pathOf(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + (u.search || '')
  } catch {
    return url
  }
}

/** 5xx, stack traces, error-in-a-200, slow. One recording, fired again. */
export async function faultAttempt(
  ctx: Ctx,
  rp: Replayer,
  rec: Recording,
  check: string
): Promise<Attempt> {
  const res = await rp.replay(rec)
  if (res.status === 0) return { verdict: 'inconclusive', steps: [], recordingIds: [], why: 'the app did not answer' }
  // Refused at the door. We never reached the code under test, so we learned
  // nothing — and "nothing" must not be allowed to read as "clean". This is
  // how a recheck told me a bug was fixed while the app was still serving it.
  if (res.status === 401 || res.status === 403) {
    return {
      verdict: 'inconclusive',
      steps: [],
      recordingIds: res.recordingId ? [res.recordingId] : [],
      why: `replayed as ${res.status}, so the request never got as far as the thing being tested`,
    }
  }
  const ids = res.recordingId ? [res.recordingId] : []
  const s = [step(rec, res.status)]

  switch (check) {
    case 'fault.5xx':
      return { verdict: res.status >= 500 ? 'reproduced' : 'clean', steps: s, recordingIds: ids }
    case 'fault.stack': {
      const text = unescapeJson(res.body)
      const hit = STACK.some((re) => re.test(text)) || SQL.test(text)
      return {
        verdict: hit ? 'reproduced' : 'clean',
        steps: s,
        recordingIds: ids,
        ...(hit ? { detail: `The body still carries it: ${text.replace(/\s+/g, ' ').slice(0, 200)}` } : {}),
      }
    }
    case 'fault.error-in-200': {
      const hit = res.status >= 200 && res.status < 300 && ERROR_IN_200.test(res.body)
      return { verdict: hit ? 'reproduced' : 'clean', steps: s, recordingIds: ids }
    }
    case 'slow': {
      const hit = res.ms >= ctx.cfg.slowMs
      return {
        verdict: hit ? 'reproduced' : 'clean',
        steps: [step(rec, `${res.status} in ${(res.ms / 1000).toFixed(1)}s`)],
        recordingIds: ids,
        ...(hit ? { detail: `Took ${(res.ms / 1000).toFixed(1)}s against a ${(ctx.cfg.slowMs / 1000).toFixed(1)}s threshold.` } : {}),
      }
    }
    default:
      return { verdict: 'inconclusive', steps: [], recordingIds: [], why: `no probe for ${check}` }
  }
}

/** Write, then read the same thing back and see whether it took. */
export async function readbackAttempt(
  ctx: Ctx,
  rp: Replayer,
  rec: Recording,
  field: string
): Promise<Attempt> {
  const write = await rp.replay(rec)
  if (write.status < 200 || write.status >= 300) {
    return { verdict: 'inconclusive', steps: [], recordingIds: [], why: `the write answered ${write.status}` }
  }
  const claimedObj = firstObject(write.json) ?? {}
  if (!(field in claimedObj)) {
    return { verdict: 'inconclusive', steps: [], recordingIds: [], why: `the write no longer echoes ${field}` }
  }
  const claimed = claimedObj[field]

  const readUrl = readBackUrl(ctx, rec, idOf(claimedObj))
  if (!readUrl) return { verdict: 'inconclusive', steps: [], recordingIds: [], why: 'nothing to read it back from' }

  const read = await rp.fire({ method: 'GET', url: readUrl, accountId: rec.account_id })
  if (read.status < 200 || read.status >= 300) {
    return { verdict: 'inconclusive', steps: [], recordingIds: [], why: `the read answered ${read.status}` }
  }
  const rows = rowsOf(read.json)
  const id = idOf(claimedObj)
  const object = (id ? rows.find((r) => idOf(r) === id) : null) ?? firstObject(read.json)
  if (!object || !(field in object)) {
    return { verdict: 'inconclusive', steps: [], recordingIds: [], why: `${field} is not in the read-back` }
  }

  const differ = !looselyEqual(claimed, object[field])
  return {
    verdict: differ ? 'reproduced' : 'clean',
    steps: [
      step(rec, `${write.status}  ${field}=${show(claimed)}`, 'the write says it saved it'),
      { method: 'GET', path: pathOf(readUrl), status: `${read.status}  ${field}=${show(object[field])}`, note: 'and it did not' },
    ],
    recordingIds: [write.recordingId, read.recordingId].filter((x): x is number => x !== null),
    ...(differ ? { detail: `Wrote ${field}=${show(claimed)}, read back ${field}=${show(object[field])}.` } : {}),
  }
}

export function readBackUrl(ctx: Ctx, rec: Recording, createdId: string | null): string | null {
  // A PATCH or PUT on an object is read back from the very same address.
  if (rec.method === 'PATCH' || rec.method === 'PUT') return rec.url
  // A create changes the collection, not some other object. The app's own
  // read-back after a create is usually the new thing's own page — correct for
  // "did my write take", useless for "how many are there now", because it
  // re-reads one fixed row that a create never touches. That is what retired
  // POST /api/orders as unmeasurable and left the run at 25 orders.
  if (rec.method === 'POST' && !hasIdSegment(rec.url)) {
    const collection = ctx.db
      .prepare(
        `SELECT r.url FROM recordings r JOIN endpoints e ON e.id = r.endpoint_id
         WHERE e.method = 'GET' AND e.path_pattern = ? AND r.status = 200
         ORDER BY r.id DESC LIMIT 1`
      )
      .get(pathPatternOf(ctx, rec.url)) as { url: string } | undefined
    if (collection) return collection.url
  }

  // Otherwise use the read the app's own front end fires after this write.
  const endpoint = rec.endpoint_id ? map.endpointById(ctx.db, rec.endpoint_id) : undefined
  if (endpoint?.readback_id) {
    const example = recordings
      .forEndpoint(ctx.db, endpoint.readback_id, 6)
      .find((r) => /json/i.test(String(safeCt(r.res_headers))))
    if (example) return example.url
  }
  if (createdId) {
    try {
      const u = new URL(rec.url)
      if (!/\/\d+$/.test(u.pathname)) return new URL(u.pathname.replace(/\/$/, '') + '/' + createdId, ctx.base).toString()
    } catch {
      /* not a url we can extend */
    }
  }
  return null
}

/** Send the same request twice with the same key. Did it happen once? */
export async function idempotencyAttempt(ctx: Ctx, rp: Replayer, rec: Recording, header: string): Promise<Attempt> {
  void ctx
  const headers = { ...safe(rec.req_headers) }
  const key = `shoal-${Math.random().toString(36).slice(2, 10)}`
  headers[header.toLowerCase()] = key

  const a = await rp.fire({ method: rec.method, url: rec.url, headers, body: rec.req_body, accountId: rec.account_id })
  const b = await rp.fire({ method: rec.method, url: rec.url, headers, body: rec.req_body, accountId: rec.account_id })
  if (a.status >= 300 || b.status >= 300) {
    return { verdict: 'inconclusive', steps: [], recordingIds: [], why: `answered ${a.status} then ${b.status}` }
  }
  const idA = idOf(firstObject(a.json) ?? {})
  const idB = idOf(firstObject(b.json) ?? {})
  if (!idA || !idB) return { verdict: 'inconclusive', steps: [], recordingIds: [], why: 'no id came back to compare' }

  const twice = idA !== idB
  return {
    verdict: twice ? 'reproduced' : 'clean',
    steps: [
      step(rec, `${a.status} -> id ${idA}`, `with ${header}: ${key}`),
      step(rec, `${b.status} -> id ${idB}`, twice ? `same key, a second object` : 'same key, same object'),
    ],
    recordingIds: [a.recordingId, b.recordingId].filter((x): x is number => x !== null),
    ...(twice
      ? { detail: `Two identical requests carrying the same ${header} created ${idA} and ${idB}. A double submit, a retry or a flaky connection all produce this.` }
      : {}),
  }
}

/** Walk a paged list. Did every row appear exactly once? */
export async function pagingAttempt(ctx: Ctx, rp: Replayer, rec: Recording): Promise<Attempt> {
  const base = new URL(rec.url)
  const limit = Number(base.searchParams.get('limit') ?? base.searchParams.get('per_page') ?? 20) || 20
  const pageParam = base.searchParams.has('offset') ? 'offset' : 'page'

  const readPage = async (n: number) => {
    const u = new URL(base.toString())
    u.searchParams.set('limit', String(limit))
    u.searchParams.set(pageParam, String(pageParam === 'offset' ? (n - 1) * limit : n))
    return rp.fire({ method: 'GET', url: u.toString(), accountId: rec.account_id })
  }

  const first = await readPage(1)
  if (first.status !== 200) return { verdict: 'inconclusive', steps: [], recordingIds: [], why: `page 1 answered ${first.status}` }
  const total = totalOf(first.json)
  if (total === null) return { verdict: 'inconclusive', steps: [], recordingIds: [], why: 'the list does not report a total' }
  if (total <= limit) return { verdict: 'inconclusive', steps: [], recordingIds: [], why: 'the list fits on one page' }
  if (total > 2000) return { verdict: 'inconclusive', steps: [], recordingIds: [], why: 'too many rows to walk politely' }

  const seen: string[] = []
  const ids = [first.recordingId]
  for (const r of rowsOf(first.json)) {
    const id = idOf(r)
    if (id) seen.push(id)
  }
  const pages = Math.ceil(total / limit)
  for (let p = 2; p <= pages; p++) {
    const res = await readPage(p)
    ids.push(res.recordingId)
    if (res.status !== 200) return { verdict: 'inconclusive', steps: [], recordingIds: [], why: `page ${p} answered ${res.status}` }
    for (const r of rowsOf(res.json)) {
      const id = idOf(r)
      if (id) seen.push(id)
    }
  }

  // Other workers are writing to this app while we walk. If the list changed
  // size underneath us the walk proves nothing, so throw the attempt away
  // rather than call a moving target a bug.
  const after = await readPage(1)
  if (totalOf(after.json) !== total) {
    return { verdict: 'inconclusive', steps: [], recordingIds: [], why: 'rows were added while walking' }
  }

  // While we are here: ask for the whole list in one go. An endpoint that
  // honours limit=1000 is unbounded, and unbounded queries are fine on an
  // empty database and ruinous later. The request is recorded like any other,
  // so if it is slow the fault checks see it without being told.
  const big = new URL(base.toString())
  big.searchParams.set('limit', '1000')
  big.searchParams.set(pageParam, pageParam === 'offset' ? '0' : '1')
  await rp.fire({ method: 'GET', url: big.toString(), accountId: rec.account_id })

  const unique = new Set(seen)
  const duplicates = seen.length - unique.size
  const missing = total - unique.size
  const broken = duplicates > 0 || missing > 0
  return {
    verdict: broken ? 'reproduced' : 'clean',
    steps: [
      { method: 'GET', path: pathOf(base.toString()), status: `${total} rows, ${pages} pages of ${limit}` },
      { method: 'GET', path: `${pathOf(base.pathname)}?${pageParam}=2..${pages}`, status: `${unique.size} distinct rows collected`, note: broken ? `${missing} never appeared, ${duplicates} appeared twice` : 'every row once' },
    ],
    recordingIds: ids.filter((x): x is number => x !== null).slice(0, 6),
    ...(broken
      ? {
          detail:
            `Walking every page of this list end to end returns ${unique.size} distinct rows where the list itself says there are ${total}. ` +
            `${missing > 0 ? `${missing} row${missing === 1 ? '' : 's'} can never be reached by paging. ` : ''}` +
            `${duplicates > 0 ? `${duplicates} row${duplicates === 1 ? '' : 's'} came back on more than one page. ` : ''}` +
            `The total was the same before and after the walk, so nothing was added underneath it.`,
        }
      : {}),
  }
}

/** The same object, read two ways, disagreeing. */
export async function consistencyAttempt(ctx: Ctx, rp: Replayer, a: Recording, b: Recording): Promise<Attempt> {
  void ctx
  // One of these two addresses names a single object and the other lists many.
  // The object recorded an hour ago has long since fallen off page one, so we
  // take ids from the list and ask the detail route about each of them.
  const list = hasIdSegment(a.url) ? b : a
  const detail = hasIdSegment(a.url) ? a : b
  if (!hasIdSegment(detail.url)) {
    return { verdict: 'inconclusive', steps: [], recordingIds: [], why: 'neither of these addresses names one object' }
  }

  const rl = await rp.fire({ method: 'GET', url: list.url, accountId: list.account_id })
  if (rl.status !== 200) return { verdict: 'inconclusive', steps: [], recordingIds: [], why: `the list answered ${rl.status}` }
  const rows = rowsOf(rl.json)
  if (!rows.length) return { verdict: 'inconclusive', steps: [], recordingIds: [], why: 'the list is empty' }

  const ids: number[] = []
  // The newest rows are usually the untouched ones, and an object nothing has
  // happened to cannot disagree with itself. Look across the page, not at the
  // top of it.
  for (const r of sample(rows, 6)) {
    const id = idOf(r)
    if (id) ids.push(Number(id))
  }

  for (const raw of sample(rows, 6)) {
    const id = idOf(raw)
    if (!id) continue
    const url = withId(detail.url, id)
    const rd = await rp.fire({ method: 'GET', url, accountId: list.account_id })
    if (rd.status !== 200) continue
    const ob = firstObject(rd.json)
    if (!ob) continue

    for (const k of Object.keys(raw)) {
      if (!(k in ob)) continue
      const va = raw[k]
      const vb = ob[k]
      if (va === null || vb === null || typeof va === 'object' || typeof vb === 'object') continue
      if (looselyEqual(va, vb)) continue
      return {
        verdict: 'reproduced',
        steps: [
          { method: 'GET', path: pathOf(list.url), status: `200  ${k}=${show(va)}`, note: `object ${id} in the list` },
          { method: 'GET', path: pathOf(url), status: `200  ${k}=${show(vb)}`, note: 'the same object on its own' },
        ],
        recordingIds: [rl.recordingId, rd.recordingId].filter((x): x is number => x !== null),
        detail:
          `Object ${id} reports ${k}=${show(va)} through ${pathOf(list.url)} and ${k}=${show(vb)} through ${pathOf(url)}, ` +
          `read one after the other with nothing in between. One of them is computed and one of them is stored, and they have drifted apart. ` +
          `Whichever screen a user happens to be looking at decides what they believe.`,
      }
    }
  }
  void ids
  return { verdict: 'clean', steps: [], recordingIds: rl.recordingId ? [rl.recordingId] : [] }
}

const hasIdSegment = (url: string): boolean => {
  try {
    return new URL(url).pathname.split('/').some((p) => /^\d+$/.test(p) || /^[0-9a-f-]{16,}$/i.test(p))
  } catch {
    return false
  }
}

function withId(url: string, id: string): string {
  const u = new URL(url)
  const parts = u.pathname.split('/')
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^\d+$/.test(parts[i]!) || /^[0-9a-f-]{16,}$/i.test(parts[i]!)) {
      parts[i] = id
      break
    }
  }
  u.pathname = parts.join('/')
  return u.toString()
}

/** Spread across the page rather than taking the first N. */
function sample<T>(rows: T[], n: number): T[] {
  if (rows.length <= n) return rows
  const step = Math.floor(rows.length / n)
  const out: T[] = []
  for (let i = 0; i < rows.length && out.length < n; i += step) out.push(rows[i]!)
  return out
}

/** Another account's data, or a door left open on a locked corridor. */
export async function crossAccountAttempt(
  ctx: Ctx,
  rp: Replayer,
  rec: Recording,
  asAccount: number,
  asLabel: string,
  ownerLabel: string
): Promise<Attempt> {
  void ctx
  const mine = await rp.fire({ method: 'GET', url: rec.url, accountId: rec.account_id })
  if (mine.status !== 200) return { verdict: 'inconclusive', steps: [], recordingIds: [], why: `the owner got ${mine.status}` }
  const ownId = idOf(firstObject(mine.json) ?? {})

  const theirs = await rp.fire({ method: 'GET', url: rec.url, accountId: asAccount })
  const ids = [mine.recordingId, theirs.recordingId].filter((x): x is number => x !== null)
  if (theirs.status !== 200) return { verdict: 'clean', steps: [], recordingIds: ids }

  const theirObj = firstObject(theirs.json)
  // A 200 is not evidence. Every account can read its own dashboard, its own
  // list, its own summary — and all three answer 200 to everybody. The only
  // thing that proves a leak is B holding A's object: the same id, and at
  // least one other field that agrees.
  const ownObj = firstObject(mine.json)
  if (!ownObj || !theirObj || !ownId) {
    return { verdict: 'inconclusive', steps: [], recordingIds: ids, why: 'this address does not identify one object, so a 200 proves nothing' }
  }
  if (idOf(theirObj) !== ownId) return { verdict: 'clean', steps: [], recordingIds: ids }
  const agreeing = Object.keys(ownObj).filter(
    (k) => !/^(id|_id|uuid|pk)$/i.test(k) && typeof ownObj[k] !== 'object' && k in theirObj && looselyEqual(ownObj[k], theirObj[k])
  )
  if (!agreeing.length) return { verdict: 'clean', steps: [], recordingIds: ids }

  return {
    verdict: 'reproduced',
    steps: [
      { method: 'GET', path: pathOf(rec.url), status: '200', as: ownerLabel, note: 'the owner reads it' },
      { method: 'GET', path: pathOf(rec.url), status: '200', as: asLabel, note: 'should be 403 or 404' },
    ],
    recordingIds: ids,
    detail:
      `${asLabel} signed itself up separately and has nothing to do with ${ownerLabel}, and it can read this object in full. ` +
      `The body it received carries the same id and the same ${agreeing.slice(0, 4).join(', ')}.`,
  }
}

/** An endpoint under a corridor whose neighbours are locked. */
export async function roleGapAttempt(
  ctx: Ctx,
  rp: Replayer,
  openRec: Recording,
  lockedRec: Recording,
  asAccount: number,
  asLabel: string
): Promise<Attempt> {
  void ctx
  const locked = await rp.fire({ method: 'GET', url: lockedRec.url, accountId: asAccount })
  const open = await rp.fire({ method: 'GET', url: openRec.url, accountId: asAccount })
  const ids = [locked.recordingId, open.recordingId].filter((x): x is number => x !== null)
  if (locked.status !== 403 && locked.status !== 401) {
    return { verdict: 'inconclusive', steps: [], recordingIds: ids, why: `the neighbour answered ${locked.status}, so there is no role to compare against` }
  }
  if (open.status < 200 || open.status >= 300) return { verdict: 'clean', steps: [], recordingIds: ids }

  return {
    verdict: 'reproduced',
    steps: [
      { method: 'GET', path: pathOf(lockedRec.url), status: String(locked.status), as: asLabel, note: 'correctly refused' },
      { method: 'GET', path: pathOf(openRec.url), status: String(open.status), as: asLabel, note: 'not refused' },
    ],
    recordingIds: ids,
    detail:
      `${asLabel} is an ordinary account that signed itself up. ${pathOf(lockedRec.url)} refuses it with ${locked.status}, ` +
      `so this part of the app does have a role check. ${pathOf(openRec.url)} does not have one, and answered ${open.status} ` +
      `with ${open.body.length} bytes.`,
  }
}

function idsOf(v: unknown): string[] {
  const rows = rowsOf(v)
  if (rows.length) return rows.map((r) => idOf(r)).filter((x): x is string => x !== null)
  const one = firstObject(v)
  const id = one ? idOf(one) : null
  return id ? [id] : []
}

function sharedId(a: unknown, b: unknown): string | null {
  const set = new Set(idsOf(b))
  return idsOf(a).find((id) => set.has(id)) ?? null
}

function pickObject(v: unknown, id: string): Record<string, unknown> | null {
  const rows = rowsOf(v)
  const hit = rows.find((r) => idOf(r) === id)
  if (hit) return hit
  const one = firstObject(v)
  return one && idOf(one) === id ? one : null
}

function totalOf(v: unknown): number | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  for (const k of ['total', 'count', 'totalCount', 'total_count']) {
    const n = Number(o[k])
    if (Number.isFinite(n)) return n
  }
  return null
}

export function looselyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb)) return Math.abs(na - nb) < 1e-9
  const sa = String(a).trim()
  const sb = String(b).trim()
  if (sa.toLowerCase() === sb.toLowerCase()) return true
  const da = Date.parse(sa)
  const db = Date.parse(sb)
  if (Number.isFinite(da) && Number.isFinite(db) && Math.abs(da - db) < 1000) return true
  return false
}

const show = (v: unknown): string => (typeof v === 'string' ? JSON.stringify(v.slice(0, 50)) : String(v))

function safe(raw: string | null): Record<string, string> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, string>
  } catch {
    return {}
  }
}
