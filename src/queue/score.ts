import type { DB } from '../store/db.js'
import type { Item, Kind } from '../store/repo/queue.js'
import * as queue from '../store/repo/queue.js'
import * as map from '../store/repo/map.js'
import { now } from '../store/db.js'

/**
 *   score = base(kind) x novelty x staleness x tilt
 *
 * `confirm` sits at the top deliberately: the moment something looks wrong,
 * find out whether it is real. Suspicions going stale is how a report fills
 * with maybes.
 */
export const BASE: Record<Kind, number> = {
  confirm: 200,
  explore: 100,
  form: 80,
  mission: 70,
  crossaccount: 60,
  hammer: 40,
}

/** Seen once 0.4, seen five times 0.05. */
export function noveltyFromVisits(visits: number): number {
  if (visits <= 0) return 1
  if (visits === 1) return 0.4
  return Math.max(0.02, 1 / (visits * visits + 1))
}

export function staleness(createdAt: number): number {
  const hours = (now() - createdAt) / 3600_000
  return 1 + Math.min(1.5, hours * 0.25)
}

/**
 * The thing that produces phases without anybody writing phases. Early on the
 * map is mostly holes, `unexplored` is near 1 and exploring wins. As the holes
 * fill it slides toward 0 and hammering wins. Nobody switches a mode.
 */
export function tilt(db: DB): number {
  const byKind = queue.frontierByKind(db)
  const looking = (byKind.explore ?? 0) + (byKind.form ?? 0) + (byKind.mission ?? 0)
  const total = queue.frontier(db)
  if (!total) return 0.5
  return looking / total
}

export function scoreOf(db: DB, kind: Kind, payload: Record<string, unknown>, createdAt = now(), unexplored?: number): number {
  const u = unexplored ?? tilt(db)
  let novelty = 1
  switch (kind) {
    case 'explore': {
      const pageId = payload.pageId as number | undefined
      if (pageId) {
        const page = map.pages(db).find((p) => p.id === pageId)
        novelty = page ? noveltyFromVisits(page.visits) : 1
      }
      break
    }
    case 'form': {
      const formId = payload.formId as number | undefined
      if (formId) {
        const fields = map.fieldsOf(db, formId)
        const tried = fields.reduce((a, f) => a + (JSON.parse(f.tried_json) as string[]).length, 0)
        const total = Math.max(1, fields.length * VALUE_CLASSES)
        novelty = Math.max(0.05, 1 - tried / total)
        // A form nobody has ever submitted is a bigger hole in the map than a
        // screen nobody has looked at, and it is the only thing that puts data
        // in the app. Without this, exploring outscores creating for the whole
        // first hour and every check that needs rows never gets to run.
        if (tried === 0) novelty *= 2
      }
      break
    }
    case 'hammer': {
      const e = payload.endpointId ? map.endpointById(db, payload.endpointId as number) : undefined
      novelty = e ? (e.hammered === 0 ? 1 : Math.max(0.05, 1 / (e.hammered * 3 + 1))) : 1
      // a write endpoint scores double a read one
      if (e?.writes) novelty *= 2
      // Hammering a create is never repetition. Every wave leaves rows behind,
      // and two of the eleven planted bugs cannot exist until hundreds of them
      // do — an unbounded query is fast on an empty table, and a list cannot
      // lose a row it does not have. Decay is the right instinct for "we have
      // tested this" and the wrong one for "the app is still too small", and
      // it stalled seasoning at 138 rows five separate times.
      if (e && isCreateEndpoint(e.method, e.path_pattern)) novelty = Math.max(novelty, 0.25)
      break
    }
    case 'crossaccount':
      novelty = 1
      break
    case 'confirm':
    case 'mission':
      novelty = 1
      break
  }
  const lean = kind === 'hammer' || kind === 'crossaccount' ? 1 - u : kind === 'confirm' ? 1 : u
  return BASE[kind] * novelty * staleness(createdAt) * Math.max(0.05, lean)
}

/** A POST to a collection: it makes rows rather than changing one. */
export const isCreateEndpoint = (method: string, pathPattern: string): boolean =>
  method === 'POST' && !pathPattern.includes(':id')

export const VALUE_CLASSES = 8

/** Rescores the ready queue. Cheap enough to run every few seconds. */
export function repriceAll(db: DB): void {
  const u = tilt(db)
  for (const item of queue.ready(db)) {
    const payload = JSON.parse(item.payload_json) as Record<string, unknown>
    queue.reprice(db, item.id, scoreOf(db, item.kind, payload, item.created_at, u))
  }
}

export const describe = (i: Item): string => `${i.kind}#${i.id}`
