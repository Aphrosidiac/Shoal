import type { Ctx } from './ctx.js'
import type { Pool } from './queue/scheduler.js'
import type { Item } from './store/repo/queue.js'
import type { Session } from './browser/session.js'
import { RunMemory } from './agent/loop.js'
import { runExplore } from './queue/workers/explore.js'
import { runForm } from './queue/workers/form.js'
import { EXPLORER_KINDS } from './queue/kinds.js'
import type { Vault } from './signup/vault.js'
import type { ExplorePayload, FormPayload, MissionPayload } from './queue/kinds.js'
import { runMission } from './queue/workers/mission.js'
import { Replayer } from './replay/request.js'
import { runConfirm } from './queue/workers/confirm.js'
import { runCrossAccount } from './queue/workers/crossaccount.js'
import { runHammer } from './queue/workers/hammer.js'
import { CONFIRMER_KINDS, HAMMERER_KINDS } from './queue/kinds.js'

/**
 * Three explorers is comfortable on a MacBook. Each owns one browser context,
 * one account and one recorder for its whole life, which is what makes
 * "this agent is a different account" true rather than hopeful.
 */
export function explorerPool(
  ctx: Ctx,
  make: (worker: string) => Promise<Session>,
  vault: Vault,
  memory: RunMemory
): Pool {
  const sessions = new Map<string, Session>()
  return {
    name: 'explorer',
    size: ctx.cfg.explorers,
    kinds: EXPLORER_KINDS,
    needsModel: true,
    make: async (worker) => {
      const s = await make(worker)
      sessions.set(worker, s)
      if (!s.account) {
        const account = await vault.any(s)
        if (!account) throw new Error('could not get an account')
      }
      return async (item: Item): Promise<string> => {
        const payload = JSON.parse(item.payload_json) as Record<string, unknown>
        if (!s.account) {
          const account = await vault.any(s)
          if (!account) throw new Error('no account and could not make one')
        }
        switch (item.kind) {
          case 'explore':
            return runExplore(ctx, s, payload as unknown as ExplorePayload, memory)
          case 'form':
            return runForm(ctx, s, payload as unknown as FormPayload)
          case 'mission':
            return runMission(ctx, s, vault, payload as unknown as MissionPayload, memory)
          default:
            return `explorers do not take ${item.kind}`
        }
      }
    },
    release: async (worker) => {
      const s = sessions.get(worker)
      sessions.delete(worker)
      if (s) await s.stop()
    },
  }
}

/**
 * Confirmers and hammerers are pure HTTP and cost nothing. They are also the
 * two that find the most valuable bugs, which is why the answer to any model
 * failure is to keep these running rather than stop.
 */
export function confirmerPool(ctx: Ctx): Pool {
  return {
    name: 'confirmer',
    size: ctx.cfg.confirmers,
    kinds: CONFIRMER_KINDS,
    needsModel: false,
    make: async (worker) => {
      const rp = new Replayer(ctx, worker)
      return (item: Item) => runConfirm(ctx, rp, item)
    },
  }
}

export function hammererPool(ctx: Ctx): Pool {
  return {
    name: 'hammerer',
    size: ctx.cfg.hammerers,
    kinds: HAMMERER_KINDS,
    needsModel: false,
    make: async (worker) => {
      const rp = new Replayer(ctx, worker)
      return (item: Item) => {
        if (item.kind === 'crossaccount') return runCrossAccount(ctx, rp, item)
        return runHammer(ctx, rp, item)
      }
    },
  }
}
