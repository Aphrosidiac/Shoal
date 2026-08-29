import { request } from 'undici'
import type { Ctx } from '../ctx.js'
import type { Recording } from '../store/repo/recordings.js'
import * as recordings from '../store/repo/recordings.js'
import * as accounts from '../store/repo/accounts.js'
import { save } from '../browser/record.js'

export type Fired = {
  status: number
  ms: number
  body: string
  headers: Record<string, string>
  json: unknown
  recordingId: number | null
}

const DROP = new Set([
  'host', 'connection', 'content-length', 'accept-encoding', 'cookie',
  'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-ch-ua',
  'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'upgrade-insecure-requests',
])

/**
 * Re-firing a recorded request at HTTP speed. No browser, no model.
 *
 * Auth is the thing that makes naive replay fail for boring reasons: tokens
 * expire, and a stale header looks exactly like a bug. So the replayer holds a
 * live session per account and refreshes it, rather than replaying whatever
 * header happened to be recorded.
 */
export class Replayer {
  private jars = new Map<number, { cookie: string; at: number }>()

  constructor(private ctx: Ctx, readonly worker = 'replay') {}

  async fire(
    r: {
      method: string
      url: string
      headers?: Record<string, string>
      body?: string | null
      accountId?: number | null
      waveId?: string | null
      record?: boolean
      timeoutMs?: number
    }
  ): Promise<Fired> {
    const headers: Record<string, string> = { accept: 'application/json, text/html;q=0.9' }
    for (const [k, v] of Object.entries(r.headers ?? {})) {
      if (!DROP.has(k.toLowerCase())) headers[k.toLowerCase()] = v
    }
    if (r.accountId != null) {
      const cookie = await this.cookieFor(r.accountId)
      if (cookie) headers.cookie = cookie
    }
    if (r.body && !headers['content-type']) headers['content-type'] = 'application/json'

    await this.ctx.throttle.take()
    const t0 = Date.now()
    let status = 0
    let body = ''
    let resHeaders: Record<string, string> = {}
    try {
      const res = await request(r.url, {
        method: r.method.toUpperCase() as 'GET',
        headers,
        ...(r.body ? { body: r.body } : {}),
        headersTimeout: r.timeoutMs ?? 45_000,
        bodyTimeout: r.timeoutMs ?? 45_000,
      })
      status = res.statusCode
      for (const [k, v] of Object.entries(res.headers)) resHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v ?? '')
      body = (await res.body.text()).slice(0, 20_000)
    } catch (e) {
      status = 0
      body = `request failed: ${(e as Error).message}`
      resHeaders = {}
    }
    const ms = Date.now() - t0

    let recordingId: number | null = null
    if (r.record !== false) {
      const o = save(this.ctx, {
        method: r.method,
        url: r.url,
        reqHeaders: headers,
        reqBody: r.body ?? null,
        status,
        resHeaders,
        resBody: body,
        startedAt: t0,
        ms,
        worker: this.worker,
        accountId: r.accountId ?? null,
        pageId: null,
        waveId: r.waveId ?? null,
      })
      recordingId = o?.id ?? null
    }

    let json: unknown = null
    try {
      json = JSON.parse(body) as unknown
    } catch {
      json = null
    }
    return { status, ms, body, headers: resHeaders, json, recordingId }
  }

  /** Replays a stored recording, optionally as somebody else. */
  async replay(rec: Recording, opts: { as?: number | null; waveId?: string | null; url?: string; body?: string | null } = {}): Promise<Fired> {
    const headers = safeHeaders(rec.req_headers)
    return this.fire({
      method: rec.method,
      url: opts.url ?? rec.url,
      headers,
      body: opts.body !== undefined ? opts.body : rec.req_body,
      accountId: opts.as !== undefined ? opts.as : rec.account_id,
      waveId: opts.waveId ?? null,
    })
  }

  /** Forgets an account's session, so the next call logs in again. */
  invalidate(accountId: number): void {
    this.jars.delete(accountId)
    this.ctx.auth.forget(accountId)
  }

  private async cookieFor(accountId: number): Promise<string | null> {
    // A live browser context beats anything we could rebuild.
    const live = this.ctx.auth.get(accountId)
    if (live) return live
    const held = this.jars.get(accountId)
    if (held && Date.now() - held.at < 10 * 60_000) return held.cookie
    const recorded = this.ctx.auth.fromRecording(this.ctx.db, accountId)
    if (recorded) {
      this.jars.set(accountId, { cookie: recorded, at: Date.now() })
      return recorded
    }
    const cookie = await this.login(accountId)
    if (cookie) this.jars.set(accountId, { cookie, at: Date.now() })
    return cookie
  }

  /**
   * Finds whichever request granted this account a session in the first place
   * and does it again with this account's own credentials. That is general:
   * we never need to be told where the login endpoint is.
   */
  private async login(accountId: number): Promise<string | null> {
    const account = accounts.byId(this.ctx.db, accountId)
    if (!account) return null
    const granting = this.ctx.db
      .prepare(
        `SELECT * FROM recordings
         WHERE account_id = ? AND res_headers LIKE '%set-cookie%' AND status < 400
         ORDER BY id DESC LIMIT 1`
      )
      .get(accountId) as Recording | undefined

    const candidates: Recording[] = []
    if (granting) candidates.push(granting)
    const anyLogin = this.ctx.db
      .prepare(
        `SELECT * FROM recordings
         WHERE method = 'POST' AND status < 400 AND (url LIKE '%login%' OR url LIKE '%signin%' OR url LIKE '%sign_in%' OR url LIKE '%session%')
         ORDER BY id DESC LIMIT 1`
      )
      .get() as Recording | undefined
    if (anyLogin) candidates.push(anyLogin)

    for (const c of candidates) {
      const body = swapCredentials(c.req_body, account.email, account.password)
      // The one thing that is not recorded anywhere: re-logging in an account
      // whose session expired. It is plumbing, not something an agent did, and
      // recording it would put a login in the map for every hour of a run.
      const res = await this.fire({
        method: c.method,
        url: c.url,
        headers: safeHeaders(c.req_headers),
        body,
        accountId: null,
        record: false,
      })
      const jar = cookiesFrom(res.headers)
      if (jar && res.status < 400) return jar
      // some apps hand back a bearer token instead
      if (res.status < 400 && res.json && typeof res.json === 'object') {
        const t = (res.json as Record<string, unknown>).token ?? (res.json as Record<string, unknown>).access_token
        if (typeof t === 'string') return `__bearer__=${t}`
      }
    }
    return null
  }
}

export function safeHeaders(raw: string | null): Record<string, string> {
  if (!raw) return {}
  try {
    const h = JSON.parse(raw) as Record<string, string>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(h)) if (!DROP.has(k.toLowerCase())) out[k.toLowerCase()] = String(v)
    return out
  } catch {
    return {}
  }
}

export function cookiesFrom(headers: Record<string, string>): string | null {
  const raw = headers['set-cookie']
  if (!raw) return null
  const pairs = raw
    // One per line when we recorded them ourselves; the comma split is the
    // fallback for headers that arrived already flattened, and it has to avoid
    // the commas inside an Expires date.
    .split(/\n|,(?=[^;]+?=)/)
    .map((c) => c.split(';')[0]!.trim())
    .filter((c) => c.includes('=') && !/=;?$/.test(c))
  return pairs.length ? pairs.join('; ') : null
}

/** Puts this account's own email and password into a recorded login body. */
export function swapCredentials(body: string | null, email: string, password: string): string | null {
  if (!body) return body
  try {
    const v = JSON.parse(body) as Record<string, unknown>
    for (const k of Object.keys(v)) {
      if (/e-?mail|user(name)?|login/i.test(k)) v[k] = email
      if (/pass/i.test(k)) v[k] = password
    }
    return JSON.stringify(v)
  } catch {
    if (body.includes('=')) {
      const p = new URLSearchParams(body)
      for (const k of [...p.keys()]) {
        if (/e-?mail|user(name)?|login/i.test(k)) p.set(k, email)
        if (/pass/i.test(k)) p.set(k, password)
      }
      return p.toString()
    }
    return body
  }
}

/** The most recent successful call of an action, to start a repro from. */
export const seedRecording = (ctx: Ctx, actionFp: string): Recording | undefined =>
  recordings.lastGood(ctx.db, actionFp)
