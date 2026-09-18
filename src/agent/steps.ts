import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Ctx } from '../ctx.js'
import type { Session } from '../browser/session.js'
import type { Snapshot } from '../browser/snapshot.js'
import type { Asked } from './choose.js'
import type { Judged } from './judge.js'
import type { StepState } from '../jev/bank.js'
import { asChoice } from '../jev/client.js'
import * as steps from '../store/repo/steps.js'
import { shoalDir } from '../store/db.js'

/**
 * What the dashboard shows: every judged screen, with a picture. Taking the
 * screenshot costs ~40 ms and the row a few kilobytes; a day is a few
 * thousand frames. It is off when the dashboard is.
 */
export async function logStep(
  ctx: Ctx,
  s: Session,
  o: {
    phase: 'explore' | 'mission' | 'form' | 'rewalk'
    step: StepState
    after: Snapshot
    asked: Asked
    judged: Judged
    changed: boolean
    rewalkOf?: number
  }
): Promise<number | null> {
  if (!ctx.cfg.ui.enabled) return null
  let shot: Buffer | null = null
  try {
    shot = await s.page.screenshot({ type: 'jpeg', quality: 45, scale: 'css', timeout: 3000 })
  } catch {
    shot = null
  }
  const answers: Record<string, unknown> = {}
  for (const [k, a] of Object.entries(o.asked.answers)) {
    if (k.startsWith('drive.') || k.startsWith('kind.')) continue
    answers[k] = a.type === 'noul' ? a.noul : a.type === 'choice' ? { choice: a.choice, confidence: a.confidence, probabilities: a.probabilities } : a.score
  }
  const d = o.asked.decision
  const decision = d
    ? {
        operation: d.operation,
        target: d.target ? { ref: d.target.ref, role: d.target.role, name: d.target.name } : null,
        option: d.option,
        confidence: d.confidence,
        targetConfidence: d.targetConfidence,
        operations: asChoice(o.asked.answers['drive.operation'])?.probabilities ?? {},
        fieldKinds: d.fieldKinds,
      }
    : null
  const id = steps.record(ctx.db, {
    at: Date.now(),
    worker: s.worker,
    phase: o.phase,
    account: s.account?.email ?? null,
    goal: o.step.goal,
    path: o.after.path,
    url_pattern: o.after.urlPattern,
    kind: asChoice(o.asked.answers['screen.kind'])?.choice ?? null,
    action_json: JSON.stringify(o.step.action),
    decision_json: decision ? JSON.stringify(decision) : null,
    answers_json: JSON.stringify(answers),
    verdicts_json: JSON.stringify(o.judged.verdicts.map((v) => ({ check: v.check, p: v.p, title: v.title, kind: v.kind }))),
    entered_json: JSON.stringify(o.step.entered),
    changed: o.changed ? 1 : 0,
    tokens: o.asked.usage.input_tokens,
    ms: o.asked.ms,
    cached: o.asked.cached ? 1 : 0,
    shot: null,
    suspicion_ids: JSON.stringify(o.judged.filed),
    rewalk_of: o.rewalkOf ?? null,
  })
  if (shot) {
    try {
      const dir = join(shoalDir(ctx.cfg.dir), 'shots')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `${id}.jpg`), shot)
      steps.setShot(ctx.db, id, `${id}.jpg`)
    } catch {
      /* a missing picture is not a missing step */
    }
  }
  return id
}
