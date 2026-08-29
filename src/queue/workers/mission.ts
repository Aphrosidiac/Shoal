import type { Ctx } from '../../ctx.js'
import type { Session } from '../../browser/session.js'
import type { Vault } from '../../signup/vault.js'
import type { MissionPayload } from '../kinds.js'
import type { RunMemory } from '../../agent/loop.js'
import { crew } from '../../agent/crew.js'

export async function runMission(
  ctx: Ctx,
  s: Session,
  vault: Vault,
  p: MissionPayload,
  memory: RunMemory
): Promise<string> {
  const out = await crew(ctx, s, vault, p, memory)
  return `${out.reason}: ${out.result} (${out.modelCalls} model calls, ${out.fastActions} free)`
}
