import type { Ctx } from '../ctx.js'
import type { Session } from '../browser/session.js'
import type { Vault } from '../signup/vault.js'
import { runLoop, type LoopResult, type RunMemory } from './loop.js'
import { CREW } from './prompts/index.js'
import * as coverage from '../store/repo/coverage.js'

export type Mission = { goal: string; success: string; persona: string; fresh: boolean }

/**
 * Many agents, each with a persona and a goal. They use the map to move fast
 * through known ground and only think hard when they hit something new.
 *
 * Missions run in a fresh account by default, so they start from a clean
 * world. Some are deliberately run in an old, cluttered one instead, because
 * accumulated data is where a whole class of bug lives.
 */
export async function crew(
  ctx: Ctx,
  s: Session,
  vault: Vault,
  m: Mission,
  memory: RunMemory
): Promise<LoopResult> {
  if (m.fresh || !s.account) {
    const previous = s.account
    const account = m.fresh ? await vault.fresh(s) : await vault.any(s)
    if (!account) {
      return { turns: 0, modelCalls: 0, actions: 0, fastActions: 0, reason: 'error', result: 'could not get an account for this mission', notes: [] }
    }
    vault.release(previous)
  }

  const out = await runLoop(ctx, s, {
    system: CREW,
    goal:
      `You are ${m.persona}\n\n` +
      `Your goal: ${m.goal}\n` +
      `You will know it worked when: ${m.success}\n\n` +
      `If the screen ends up disagreeing with that, say so with surprise() before you finish.`,
    worker: s.worker,
    maxTurns: 28,
    memory,
  })
  coverage.bump(ctx.db, out.reason === 'done' ? 'missions_finished' : 'missions_abandoned')
  return out
}
