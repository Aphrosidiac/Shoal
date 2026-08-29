import type { Ctx } from '../ctx.js'
import * as queue from '../store/repo/queue.js'
import * as map from '../store/repo/map.js'
import * as suspicions from '../store/repo/suspicions.js'
import * as recordings from '../store/repo/recordings.js'
import * as accounts from '../store/repo/accounts.js'
import * as coverage from '../store/repo/coverage.js'
import { repriceAll, scoreOf } from './score.js'
import { classesFor } from '../map/values.js'
import type { Kind, Item } from '../store/repo/queue.js'
import { isDoorEndpoint } from './kinds.js'

export type Runner = (item: Item) => Promise<string>

/**
 * Everything Shoal does is an item on one queue, and what it does next is
 * whatever scores highest right now. Nothing here knows about phases, because
 * phases emerge from the scoring tilt.
 */
export function seed(ctx: Ctx): number {
  let added = 0
  const db = ctx.db

  for (const page of map.pages(db)) {
    if (page.explored) continue
    const where = page.example_url ?? page.url_pattern
    if (where.includes(':id')) continue
    const id = queue.push(db, {
      kind: 'explore',
      payload: { pageId: page.id, path: where, why: 'never looked at properly' },
      score: scoreOf(db, 'explore', { pageId: page.id }),
      dedupeKey: `explore:${page.screen_fp}`,
    })
    if (id) added++
  }

  for (const form of map.forms(db)) {
    const page = map.pages(db).find((p) => p.id === form.page_id)
    if (!page) continue
    const where = page.example_url ?? page.url_pattern
    if (where.includes(':id')) continue
    // Never fuzz the way in. Submitting a signup or login form does not test
    // a feature, it changes who the explorer is — and an explorer that keeps
    // registering itself spends the whole run on the front door. Signup is
    // how accounts are made, not something to poke.
    if (isDoorway(form.name, where)) continue
    // A form we have never once submitted successfully is the biggest hole in
    // the map — bigger than any untried hostile value. Each value class is
    // tried once and only once, so if the single valid class happens to be
    // spent on a run that never reached the page, that endpoint can never get
    // a working call again. One run left POST /api/invoices/:id/payments with
    // exactly one request against it, a 400, and three of the eleven planted
    // bugs live behind a payment that works.
    if (!everWorked(db, form.name)) {
      const tries = coverage.get(db, `retry:${form.id}`)
      if (tries < 8) {
        const id = queue.push(db, {
          kind: 'form',
          payload: { formId: form.id, fieldId: map.fieldsOf(db, form.id)[0]?.id ?? 0, valueClass: 'normal', path: where },
          score: scoreOf(db, 'form', { formId: form.id }) * 2,
          dedupeKey: `form:works:${form.id}:${tries}`,
        })
        if (id) {
          coverage.set(db, `retry:${form.id}`, tries + 1)
          added++
        }
      }
    }

    for (const field of map.fieldsOf(db, form.id)) {
      const tried = new Set(JSON.parse(field.tried_json) as string[])
      for (const cls of classesFor(field.type ?? 'text')) {
        if (tried.has(cls)) continue
        const id = queue.push(db, {
          kind: 'form',
          payload: { formId: form.id, fieldId: field.id, valueClass: cls, path: where },
          score: scoreOf(db, 'form', { formId: form.id }),
          dedupeKey: `form:${field.id}:${cls}`,
        })
        if (id) added++
      }
    }
  }

  for (const e of map.endpoints(db)) {
    if (!e.writes) continue
    if (isDoorEndpoint(`${e.method} ${e.path_pattern}`)) continue
    if (!recordings.forEndpoint(db, e.id, 1).length) continue
    if (coverage.get(db, `nohammer:${e.id}`)) continue
    // Rounds, not one shot. Hammering is also how the app accumulates data,
    // and two of the things worth finding — a list too big to page correctly,
    // a query that is only slow once there are rows — cannot exist until it
    // has. Novelty decays with every round, so this fades rather than stops.
    // Round-robin rather than first-past-the-post. Without this the endpoint
    // that happens to be measurable first takes every hammerer for the rest of
    // the run, and hammering is also how the app grows the rows that other
    // checks need.
    const round = Math.floor(e.hammered / 3)
    if (round > 40) continue
    if (round > leastHammeredRound(db) + 1) continue
    for (const shape of ['same-row', 'shared-resource', 'cross-action'] as const) {
      const id = queue.push(db, {
        kind: 'hammer',
        payload: { endpointId: e.id, shape, round },
        score: scoreOf(db, 'hammer', { endpointId: e.id }),
        dedupeKey: `hammer:${e.id}:${shape}:${round}`,
      })
      if (id) added++
    }
  }

  for (const s of suspicions.all(db)) {
    if (s.state !== 'open') continue
    const id = queue.push(db, {
      kind: 'confirm',
      payload: { suspicionId: s.id },
      score: scoreOf(db, 'confirm', {}),
      dedupeKey: `confirm:${s.id}`,
    })
    if (id) added++
  }

  const others = accounts.usable(db)
  if (others.length >= 2) {
    for (const e of map.endpoints(db)) {
      if (e.method !== 'GET') continue
      // Only addresses that name one object. A collection answering 200 to
      // everybody is every account seeing its own list, which is the product
      // working, and treating it as a leak is how a report becomes worthless.
      if (!e.path_pattern.includes(':id')) continue
      const rec = recordings.forEndpoint(db, e.id, 1)[0]
      if (!rec || !rec.account_id) continue
      for (const a of others) {
        if (a.id === rec.account_id) continue
        const id = queue.push(db, {
          kind: 'crossaccount',
          payload: { recordingId: rec.id, accountId: a.id },
          score: scoreOf(db, 'crossaccount', {}),
          dedupeKey: `xacct:${e.id}:${a.id}`,
        })
        if (id) added++
        break
      }
    }
  }

  coverage.set(db, 'frontier', queue.frontier(db))
  return added
}

/** The round the least-hammered live write endpoint is on. */
function leastHammeredRound(db: Ctx['db']): number {
  const rows = db
    .prepare('SELECT id, method, path_pattern, hammered FROM endpoints WHERE writes = 1')
    .all() as Array<{ id: number; method: string; path_pattern: string; hammered: number }>
  const live = rows.filter(
    (r) => !coverage.get(db, `nohammer:${r.id}`) && !isDoorEndpoint(`${r.method} ${r.path_pattern}`)
  )
  if (!live.length) return 0
  return Math.min(...live.map((r) => Math.floor(r.hammered / 3)))
}

/** Has this form's endpoint ever answered a success to anybody? */
function everWorked(db: Ctx['db'], formName: string | null): boolean {
  if (!formName || !formName.startsWith('/')) return true
  const rows = db
    .prepare('SELECT statuses_json FROM endpoints WHERE path_pattern = ? AND writes = 1')
    .all(formName) as Array<{ statuses_json: string }>
  if (!rows.length) return true // no endpoint of ours behind it; nothing to judge
  return rows.some((r) => Object.keys(JSON.parse(r.statuses_json) as Record<string, number>).some((s) => Number(s) >= 200 && Number(s) < 300))
}

const DOORWAY = /login|log-?in|signin|sign-?in|signup|sign-?up|register|logout|sign-?out|password|session|auth/i

export function isDoorway(name: string | null, path: string): boolean {
  return DOORWAY.test(name ?? '') || DOORWAY.test(path)
}

export type Pool = {
  name: string
  size: number
  kinds: Kind[]
  /** True when this pool needs the model tier that is currently down. */
  needsModel: boolean
  /** One per worker, so an explorer can own a browser session for its life. */
  make: (worker: string) => Promise<Runner>
  release?: (worker: string) => Promise<void>
}

/**
 * The pattern when anything fails is always the same: degrade to the free
 * work rather than stop. Hammering and confirming need no model at all.
 */
export class Scheduler {
  private running: Array<Promise<void>> = []
  private ticker: NodeJS.Timeout | null = null
  busy = new Map<string, string>()

  constructor(private ctx: Ctx, private pools: Pool[]) {}

  async start(): Promise<void> {
    seed(this.ctx)
    this.ticker = setInterval(() => {
      if (this.ctx.stopping()) return
      queue.reapExpired(this.ctx.db)
      seed(this.ctx)
      repriceAll(this.ctx.db)
      coverage.set(this.ctx.db, 'frontier', queue.frontier(this.ctx.db))
    }, 8000)
    this.ticker.unref?.()

    for (const pool of this.pools) {
      for (let i = 0; i < pool.size; i++) {
        this.running.push(this.worker(pool, `${pool.name}-${i + 1}`))
      }
    }
  }

  private async worker(pool: Pool, name: string): Promise<void> {
    let idle = 0
    let run: Runner
    try {
      run = await pool.make(name)
    } catch (e) {
      this.ctx.log('failed', `${name} could not start: ${(e as Error).message.split('\n')[0]}`)
      return
    }
    try {
    while (!this.ctx.stopping()) {
      if (pool.needsModel && (!this.ctx.models.driverUp() || !this.ctx.meter.canAfford())) {
        await sleep(5000)
        continue
      }
      const item = queue.lease(this.ctx.db, name, pool.kinds)
      if (!item) {
        idle++
        await sleep(Math.min(4000, 400 * idle))
        continue
      }
      idle = 0
      this.busy.set(name, `${item.kind}#${item.id}`)
      try {
        const note = await run(item)
        queue.done(this.ctx.db, item.id)
        if (this.ctx.cfg.verbose) this.ctx.log('work', `${name} ${item.kind}#${item.id}: ${note}`)
      } catch (e) {
        const outcome = queue.failed(this.ctx.db, item.id)
        const msg = (e as Error).message.split('\n')[0]!.slice(0, 160)
        if (outcome === 'gaveup') this.ctx.log('failed', `${item.kind}#${item.id} gave up after 3 tries: ${msg}`)
        else if (this.ctx.cfg.verbose) this.ctx.log('retry', `${item.kind}#${item.id}: ${msg}`)
      } finally {
        this.busy.delete(name)
      }
    }
    } finally {
      if (pool.release) await pool.release(name).catch(() => undefined)
    }
  }

  async wait(): Promise<void> {
    await Promise.all(this.running)
  }

  stop(): void {
    if (this.ticker) clearInterval(this.ticker)
    this.ticker = null
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
