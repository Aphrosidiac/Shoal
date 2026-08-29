import type { Ctx } from '../ctx.js'
import type { Session } from '../browser/session.js'
import type { Vault } from '../signup/vault.js'
import { runLoop, RunMemory, type LoopResult } from './loop.js'
import { SCOUT } from './prompts/index.js'
import * as map from '../store/repo/map.js'
import * as coverage from '../store/repo/coverage.js'

/**
 * One agent, slow and smart. Given nothing but a URL it finds the signup flow,
 * makes itself an account, wanders, and writes what it learned into the map.
 * Runs mostly early, and again whenever the app changes under us.
 *
 * It cares about breadth: new screens, new forms, new endpoints. It does not
 * chase goals — that is the crew's job.
 */
export async function scout(
  ctx: Ctx,
  s: Session,
  vault: Vault,
  opts: { turns?: number; memory?: RunMemory } = {}
): Promise<LoopResult & { account: string | null }> {
  const memory = opts.memory ?? new RunMemory()

  if (!s.account) {
    const account = await vault.any(s)
    if (!account) {
      return {
        turns: 0, modelCalls: 0, actions: 0, fastActions: 0,
        reason: 'error', result: 'could not get into the app at all', notes: [], account: null,
      }
    }
    coverage.set(ctx.db, 'accounts', accountsCount(ctx))
  }

  const goal = [
    'You have just made an account on this app and you are looking around.',
    'Find screens you have not seen, and find out what each one is for.',
  ].join(' ')

  const r = await runLoop(ctx, s, {
    system: SCOUT,
    goal,
    worker: s.worker,
    maxTurns: opts.turns ?? 40,
    memory,
  })

  coverage.set(ctx.db, 'pages', map.pages(ctx.db).length)
  coverage.set(ctx.db, 'endpoints', map.endpoints(ctx.db).length)
  return { ...r, account: s.account?.email ?? null }
}

function accountsCount(ctx: Ctx): number {
  return (ctx.db.prepare('SELECT COUNT(*) c FROM accounts').get() as { c: number }).c
}
