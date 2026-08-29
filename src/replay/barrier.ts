import { Pool } from 'undici'
import type { Ctx } from '../ctx.js'
import { save } from '../browser/record.js'

export type Shot = {
  status: number
  ms: number
  body: string
  headers: Record<string, string>
  json: unknown
  recordingId: number | null
}

export type ShotSpec = {
  method: string
  path: string
  headers: Record<string, string>
  body: string | null
  accountId: number | null
}

/**
 * Races need requests overlapping inside the same millisecond, and an agent
 * driving a browser takes three seconds a click. So the browser learns the
 * call and this fires it.
 *
 * Connection setup is the thing that ruins a naive attempt: open N sockets at
 * fire time and they arrive spread over a hundred milliseconds, which is an
 * eternity and no race at all. So the sockets are opened first, every request
 * is parked on one barrier, and they are released in the same tick.
 */
export async function volley(ctx: Ctx, shots: ShotSpec[], waveId: string): Promise<Shot[]> {
  const origin = new URL(ctx.base).origin
  // Recorded headers deliberately have no cookie in them — a stale one is
  // worse than none. The live session for the account goes on here instead,
  // or the whole volley is eight anonymous 401s that look like a serialising
  // write endpoint.
  for (const s of shots) {
    if (s.accountId === null) continue
    const cookie = ctx.auth.get(s.accountId) ?? ctx.auth.fromRecording(ctx.db, s.accountId)
    if (cookie) s.headers = { ...s.headers, cookie }
  }
  const pool = new Pool(origin, { connections: Math.max(2, shots.length), pipelining: 0 })

  try {
    // 1. open the sockets, and let the app warm whatever it warms
    await Promise.all(
      shots.map(() =>
        pool
          .request({ path: '/', method: 'GET' })
          .then((r) => r.body.text())
          .catch(() => undefined)
      )
    )

    // 2. park every request on one gate
    let release = (): void => undefined
    const gate = new Promise<void>((r) => (release = r))
    const started: number[] = []

    const fires = shots.map(async (s, i) => {
      await gate
      const t0 = Date.now()
      started[i] = t0
      try {
        const res = await pool.request({
          path: s.path,
          method: s.method.toUpperCase() as 'GET',
          headers: s.headers,
          ...(s.body ? { body: s.body } : {}),
        })
        const headers: Record<string, string> = {}
        for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v ?? '')
        const body = (await res.body.text()).slice(0, 20_000)
        return { status: res.statusCode, ms: Date.now() - t0, body, headers, json: safeJson(body), recordingId: null as number | null }
      } catch (e) {
        return { status: 0, ms: Date.now() - t0, body: `failed: ${(e as Error).message}`, headers: {}, json: null, recordingId: null as number | null }
      }
    })

    // 3. everyone is waiting; let them all go at once
    await new Promise((r) => setImmediate(r))
    release()
    const shot = await Promise.all(fires)

    for (let i = 0; i < shot.length; i++) {
      const s = shots[i]!
      const r = shot[i]!
      const o = save(ctx, {
        method: s.method,
        url: origin + s.path,
        reqHeaders: s.headers,
        reqBody: s.body,
        status: r.status,
        resHeaders: r.headers,
        resBody: r.body,
        startedAt: started[i] ?? Date.now(),
        ms: r.ms,
        worker: 'hammer',
        accountId: s.accountId,
        pageId: null,
        waveId,
      })
      r.recordingId = o?.id ?? null
    }
    return shot
  } finally {
    await pool.close().catch(() => undefined)
  }
}

/** How far apart the volley actually landed. A wave spread over a second is
 *  not a race, and saying so is the difference between a result and a guess. */
export function spread(shots: Shot[]): number {
  const times = shots.map((s) => s.ms).filter((m) => m > 0)
  if (times.length < 2) return 0
  return Math.max(...times) - Math.min(...times)
}

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown
  } catch {
    return null
  }
}
