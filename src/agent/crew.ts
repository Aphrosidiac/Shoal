import type { Ctx } from '../ctx.js'
import type { Session } from '../browser/session.js'
import type { Vault } from '../signup/vault.js'
import { runLoop, type LoopResult, type RunMemory } from './loop.js'
import { personaByName, PERSONAS } from './personas.js'
import * as coverage from '../store/repo/coverage.js'
import type { MissionPayload } from '../queue/kinds.js'

export type Mission = MissionPayload

/**
 * Many agents, each with a persona and a goal. Jev chooses every step toward
 * the goal from the controls on screen; the persona decides how badly to
 * behave on the way; the judge reads every screen.
 *
 * Missions run in a fresh account by default, so they start from a clean
 * world. Some are deliberately run in an old, cluttered one instead, because
 * accumulated data is where a whole class of bug lives.
 */
export async function crew(ctx: Ctx, s: Session, vault: Vault, m: Mission, memory: RunMemory): Promise<LoopResult> {
  if (m.fresh || !s.account) {
    const previous = s.account
    const account = m.fresh ? await vault.fresh(s) : await vault.any(s)
    if (!account) {
      return { turns: 0, modelCalls: 0, actions: 0, fastActions: 0, suspicions: 0, reason: 'error', result: 'could not get an account for this mission', notes: [] }
    }
    vault.release(previous)
  }

  // A chain: every link before the last only puts the world in the state
  // the last one needs, so it is walked plainly; the persona misbehaves on
  // the last one. One account throughout, so what link one made is there
  // for link two.
  const links = [{ goal: m.goal, success: m.success }, ...(m.then ?? [])]
  const plain = PERSONAS.find((p) => p.name === 'the beginner')!
  let out: LoopResult = { turns: 0, modelCalls: 0, actions: 0, fastActions: 0, suspicions: 0, reason: 'done', result: '', notes: [] }
  for (let i = 0; i < links.length; i++) {
    const last = i === links.length - 1
    const r = await runLoop(ctx, s, {
      mode: 'mission',
      goal: links[i]!.goal,
      success: links[i]!.success,
      persona: last ? personaByName(m.persona) : plain,
      worker: s.worker,
      maxTurns: 28,
      memory,
    })
    out = {
      ...r,
      turns: out.turns + r.turns, modelCalls: out.modelCalls + r.modelCalls, actions: out.actions + r.actions,
      fastActions: out.fastActions + r.fastActions, suspicions: out.suspicions + r.suspicions, notes: [...out.notes, ...r.notes],
    }
    if (r.reason !== 'done') {
      if (links.length > 1) out.result = `link ${i + 1} of ${links.length}: ${r.result}`
      break
    }
  }
  coverage.bump(ctx.db, out.reason === 'done' ? 'missions_finished' : 'missions_abandoned')
  return out
}
