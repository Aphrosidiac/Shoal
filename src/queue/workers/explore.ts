import type { Ctx } from '../../ctx.js'
import type { Session } from '../../browser/session.js'
import type { ExplorePayload } from '../kinds.js'
import { runLoop, type RunMemory } from '../../agent/loop.js'
import { namesAnObject, reach } from '../../browser/reach.js'
import { SCOUT } from '../../agent/prompts/index.js'
import * as map from '../../store/repo/map.js'

/** Look at a screen never seen, and write down what it is for. */
export async function runExplore(ctx: Ctx, s: Session, p: ExplorePayload, memory: RunMemory): Promise<string> {
  const page = p.pageId ? map.pages(ctx.db).find((x) => x.id === p.pageId) : undefined
  // A pattern is for counting; an address is for going there. A screen whose
  // pattern is /invoices/:id can still be opened, because we kept one real
  // address it was seen at.
  const target = page?.example_url ?? p.path ?? page?.url_pattern
  if (target && !target.includes(':id')) {
    const r = namesAnObject(target) ? await reach(s, target) : await s.goto(target)
    if (!r.ok) return r.note
  } else if (target) {
    return 'that screen needs an id I do not have'
  }

  const out = await runLoop(ctx, s, {
    system: SCOUT,
    goal: `You are looking around this app. ${p.why}`,
    worker: s.worker,
    maxTurns: 12,
    memory,
  })
  if (s.pageId && out.notes.length) map.markExplored(ctx.db, s.pageId)
  return `${out.reason}: ${out.result || 'looked around'} (${out.modelCalls} model calls, ${out.fastActions} free)`
}
