import type { Ctx } from '../ctx.js'
import type { Session } from '../browser/session.js'
import type { Snapshot } from '../browser/snapshot.js'
import type { StepState } from '../jev/bank.js'
import * as recordings from '../store/repo/recordings.js'
import { ask } from './choose.js'
import { judge, type Judged } from './judge.js'
import { marker, pruned } from './screen.js'

/**
 * Judge one transition outside the driving loop: the form worker fills a
 * form with a class of value and submits it, and what the screen does with
 * "-1" or a 300-character name is exactly what the contract is for.
 */
export async function observe(
  ctx: Ctx,
  s: Session,
  o: { goal: string; action: StepState['action']; before: Snapshot; entered: Record<string, string>; watermark: number; valueClasses: string[] }
): Promise<Judged> {
  const after = s.last ?? (await s.look())
  const step: StepState = {
    goal: o.goal,
    action: o.action,
    before: pruned(o.before),
    after: pruned(after),
    entered: o.entered,
    recent: [],
  }
  const asked = await ask(ctx, s.worker, { drive: false, step, after })
  return judge(ctx, s.worker, {
    step,
    before: o.before,
    after,
    changed: marker(o.before) !== marker(after),
    answers: asked.answers,
    requests: recordings.sinceFor(ctx.db, s.worker, o.watermark),
    valueClasses: o.valueClasses,
    trail: s.trail,
  })
}
