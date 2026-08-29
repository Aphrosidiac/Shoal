import type { BrowserContext, Request, Response } from 'playwright'
import type { Ctx } from '../ctx.js'
import * as recordings from '../store/repo/recordings.js'
import * as map from '../store/repo/map.js'
import { actionFp } from '../map/fingerprint.js'
import { live } from '../ui/live.js'

const STATIC = /\.(?:css|js|mjs|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|mp4|webm)(?:\?|$)/i

const isData = (headers: Record<string, string>): boolean => {
  const ct = String(headers['content-type'] ?? '').toLowerCase()
  if (!ct) return false
  return /json|\+json|x-ndjson/.test(ct)
}
const MAX_BODY = 20_000

export type Observed = {
  id: number
  method: string
  url: string
  path: string
  pattern: string
  endpointId: number
  status: number
  ms: number
  reqBody: string | null
  resBody: string | null
  reqHeaders: Record<string, string>
  resHeaders: Record<string, string>
  accountId: number | null
  pageId: number | null
  worker: string
  actionFp: string
  waveId: string | null
}

/** Watchers subscribe here. Nothing in here may call a model. */
export type Sink = (o: Observed) => void

const sinks: Sink[] = []
export function onRecording(fn: Sink): void {
  sinks.push(fn)
}
function emit(o: Observed): void {
  for (const s of sinks) {
    try {
      s(o)
    } catch {
      /* a broken watcher must not take the run down */
    }
  }
}

const SENSITIVE = /pass|secret|token|otp|cvv|card|ssn|iban|api[_-]?key|authorization/i

function redactBody(body: string | null, on: boolean): string | null {
  if (!body || !on) return body
  try {
    const v = JSON.parse(body) as Record<string, unknown>
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) if (SENSITIVE.test(k)) v[k] = '[redacted]'
      return JSON.stringify(v)
    }
  } catch {
    /* not json */
  }
  return body
}

/**
 * Persists one observed request. Used by the browser recorder and by replay,
 * so a replayed request is stored exactly like a clicked one.
 */
export function save(
  ctx: Ctx,
  r: {
    method: string
    url: string
    reqHeaders: Record<string, string>
    reqBody: string | null
    status: number
    resHeaders: Record<string, string>
    resBody: string | null
    startedAt: number
    ms: number
    worker: string
    accountId: number | null
    pageId: number | null
    waveId: string | null
  }
): Observed | null {
  let u: URL
  try {
    u = new URL(r.url)
  } catch {
    return null
  }
  const pattern = ctx.patterns.observe(u.pathname)
  const endpoint = map.upsertEndpoint(ctx.db, r.method, pattern, r.status)
  const fp = actionFp(r.method, pattern, r.reqBody)
  const id = recordings.insert(ctx.db, {
    run_id: ctx.runId,
    app_version_id: ctx.app.versionId || 1,
    account_id: r.accountId,
    page_id: r.pageId,
    endpoint_id: endpoint.id,
    worker: r.worker,
    method: r.method.toUpperCase(),
    url: r.url,
    req_headers: JSON.stringify(r.reqHeaders),
    req_body: redactBody(r.reqBody, ctx.cfg.redact)?.slice(0, MAX_BODY) ?? null,
    status: r.status,
    res_headers: JSON.stringify(r.resHeaders),
    res_body: redactBody(r.resBody, ctx.cfg.redact)?.slice(0, MAX_BODY) ?? null,
    started_at: r.startedAt,
    ms: r.ms,
    action_fp: fp,
    wave_id: r.waveId,
  })
  const o: Observed = {
    id,
    method: r.method.toUpperCase(),
    url: r.url,
    path: u.pathname,
    pattern,
    endpointId: endpoint.id,
    status: r.status,
    ms: r.ms,
    reqBody: r.reqBody,
    resBody: r.resBody,
    reqHeaders: r.reqHeaders,
    resHeaders: r.resHeaders,
    accountId: r.accountId,
    pageId: r.pageId,
    worker: r.worker,
    actionFp: fp,
    waveId: r.waveId,
  }
  live.request({ at: r.startedAt, method: o.method, path: o.path, status: o.status, ms: o.ms, worker: r.worker })
  emit(o)
  return o
}

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Runs under every browser session, always. There is no mode where an agent
 * acts without being recorded, because the recording is the product.
 */
export class Recorder {
  pageId: number | null = null
  accountId: number | null = null
  /** How read-back pairs are learned: watch what the frontend refetches. */
  private lastWrite: { endpointId: number; at: number } | null = null
  private starts = new WeakMap<Request, number>()

  constructor(private ctx: Ctx, readonly worker: string) {}

  attach(context: BrowserContext): void {
    context.on('request', (req) => this.starts.set(req, Date.now()))
    context.on('response', (res) => void this.onResponse(res))
    context.on('requestfailed', (req) => {
      const u = req.url()
      if (!this.interesting(u, req.resourceType())) return
      const started = this.starts.get(req) ?? Date.now()
      save(this.ctx, {
        method: req.method(),
        url: u,
        reqHeaders: req.headers(),
        reqBody: req.postData(),
        status: 0,
        resHeaders: {},
        resBody: `request failed: ${req.failure()?.errorText ?? 'unknown'}`,
        startedAt: started,
        ms: Date.now() - started,
        worker: this.worker,
        accountId: this.accountId,
        pageId: this.pageId,
        waveId: null,
      })
    })
  }

  private interesting(url: string, resourceType: string): boolean {
    if (!url.startsWith(this.ctx.base)) return false
    if (STATIC.test(url)) return false
    if (['image', 'stylesheet', 'font', 'media', 'manifest'].includes(resourceType)) return false
    return true
  }

  private async onResponse(res: Response): Promise<void> {
    const req = res.request()
    const url = req.url()
    if (!this.interesting(url, req.resourceType())) return
    const started = this.starts.get(req) ?? Date.now()
    let body: string | null = null
    try {
      const ct = String(res.headers()['content-type'] ?? '')
      if (!/image|font|video|octet-stream/.test(ct)) body = (await res.text()).slice(0, MAX_BODY)
    } catch {
      body = null
    }
    const o = save(this.ctx, {
      method: req.method(),
      url,
      reqHeaders: req.headers(),
      reqBody: req.postData(),
      status: res.status(),
      resHeaders: res.headers(),
      resBody: body,
      startedAt: started,
      ms: Date.now() - started,
      worker: this.worker,
      accountId: this.accountId,
      pageId: this.pageId,
      waveId: null,
    })
    if (!o) return
    this.learnReadback(o)
  }

  /**
   * The frontend already tells us which read shows a write: watch a POST, and
   * whatever GET the app fires immediately afterwards is the read-back for it.
   * Nobody configures this.
   */
  private learnReadback(o: Observed): void {
    if (WRITE.has(o.method) && o.status >= 200 && o.status < 300) {
      this.lastWrite = { endpointId: o.endpointId, at: Date.now() }
      return
    }
    if (o.method !== 'GET' || !this.lastWrite) return
    // A create that redirects fires a document GET straight afterwards, and
    // pairing a JSON write with an HTML page teaches the replayer to read the
    // result back off a web page it cannot count anything in. Data reads only.
    if (!isData(o.resHeaders)) return
    if (Date.now() - this.lastWrite.at > 3000) {
      this.lastWrite = null
      return
    }
    if (o.status >= 200 && o.status < 300 && o.endpointId !== this.lastWrite.endpointId) {
      map.setReadback(this.ctx.db, this.lastWrite.endpointId, o.endpointId)
      this.lastWrite = null
    }
  }
}
