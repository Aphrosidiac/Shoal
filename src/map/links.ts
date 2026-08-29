import type { Ctx } from '../ctx.js'
import type { Snapshot } from '../browser/snapshot.js'
import * as queue from '../store/repo/queue.js'
import { scoreOf } from '../queue/score.js'

const DOORWAY = /\/(login|signin|sign-in|register|signup|sign-up|logout|sign-out)\b/i
const seen = new Set<string>()

/**
 * A link the app is showing us and we have never followed is not something to
 * hope an agent notices — it is work. Queuing it is free, deterministic, and
 * it is the difference between a map of the app and a map of wherever the
 * driver happened to wander.
 */
export function noteLinks(ctx: Ctx, snap: Snapshot): void {
  const origin = new URL(ctx.base).origin
  for (const c of snap.controls) {
    if (c.role !== 'link' || !c.href) continue
    let u: URL
    try {
      u = new URL(c.href, snap.url)
    } catch {
      continue
    }
    if (u.origin !== origin) continue
    if (DOORWAY.test(u.pathname)) continue
    const where = u.pathname + u.search
    if (where === snap.path) continue
    if (seen.has(where)) continue
    seen.add(where)
    if (seen.size > 5000) seen.clear()
    queue.push(ctx.db, {
      kind: 'explore',
      payload: { path: where, why: `linked from ${snap.path} as "${c.name}"` },
      score: scoreOf(ctx.db, 'explore', {}),
      dedupeKey: `explore:link:${where}`,
    })
  }
}

export const resetLinks = (): void => seen.clear()
