import type { Ctx } from '../../ctx.js'
import type { Session } from '../../browser/session.js'
import type { Vault } from '../../signup/vault.js'
import type { MissionPayload } from '../kinds.js'
import type { RunMemory } from '../../agent/loop.js'
import { crew } from '../../agent/crew.js'
import { chainWithPrerequisite } from '../../agent/missions.js'

export async function runMission(
  ctx: Ctx,
  s: Session,
  vault: Vault,
  p: MissionPayload,
  memory: RunMemory
): Promise<string> {
  const out = await crew(ctx, s, vault, p, memory)
  // Stood on an empty list and could go no further: the mission needed
  // something to exist first. Queue it again with the making of it in front.
  let again = ''
  if (out.reason !== 'done' && out.endedOnEmpty && out.endedAt && chainWithPrerequisite(ctx, p, out.endedAt)) {
    again = '; queued again behind a create'
  }
  return `${out.reason}: ${out.result} (${out.modelCalls} model calls, ${out.fastActions} free)${again}`
}
