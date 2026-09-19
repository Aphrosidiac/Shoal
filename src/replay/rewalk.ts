import type { Ctx } from '../ctx.js'
import type { Session } from '../browser/session.js'
import type { Vault } from '../signup/vault.js'
import type { Snapshot } from '../browser/snapshot.js'
import type { Step } from '../agent/trail.js'
import { describe } from '../agent/trail.js'
import { ask } from '../agent/choose.js'
import { judge, type Verdict } from '../agent/judge.js'
import { marker, pruned } from '../agent/screen.js'
import * as recordings from '../store/repo/recordings.js'
import type { Attempt } from './verdict.js'
import type { StepState } from '../jev/bank.js'
import { logStep } from '../agent/steps.js'

/**
 * The second way a suspicion gets confirmed. HTTP replay proves what a
 * request does; it cannot prove what a screen shows. So a screen suspicion
 * is walked again — in a brand new account, by matching what a user would
 * see (a role and a name), never a ref — and the same question is asked of
 * the same screen. Jev is self-consistent by training, which is what makes
 * asking again a reproduction rather than a coin toss; a fresh account is
 * what makes it the app's behaviour rather than one account's leftover state.
 */
export async function rewalk(
  ctx: Ctx,
  s: Session,
  vault: Vault,
  trail: Step[],
  want: { check: string; shape: string; goal: string; suspicionId?: number }
): Promise<Attempt> {
  const previous = s.account
  const account = await vault.fresh(s)
  vault.release(previous)
  if (!account) return { verdict: 'inconclusive', steps: [], recordingIds: [], why: 'could not make an account to walk it again' }

  const steps: Attempt['steps'] = []
  const walk = trail.filter((t) => t.op !== 'goto' || !/\/(login|signin|register|signup)/i.test(t.path))
  if (!walk.length) return { verdict: 'inconclusive', steps, recordingIds: [], why: 'nothing to walk' }

  let before: Snapshot | null = null
  let entered: Record<string, string> = {}
  let watermark = recordings.lastId(ctx.db)
  let last: Step | null = null
  const recent: string[] = []

  for (let i = 0; i < walk.length; i++) {
    const t = walk[i]!
    if (ctx.stopping()) return { verdict: 'inconclusive', steps, recordingIds: [], why: 'stopping' }
    // Not where the original was: try to get there before matching a
    // control. Compared by pattern, not address — the walk in this account
    // made its own order, so it stands on /app/orders/91 where the original
    // stood on /app/orders/5048, and that is the same place. Going to the
    // recorded address instead opened another account's invoice and judged
    // "no such invoice" as the answer to a contradiction.
    const samePlace = s.last && ctx.patterns.pattern(s.last.path) === ctx.patterns.pattern(t.url)
    if (!s.last || (t.op !== 'goto' && t.op !== 'back' && !samePlace)) {
      const r = await s.goto(t.url)
      if (!r.ok) return { verdict: 'inconclusive', steps, recordingIds: [], why: `could not open ${t.url} at step ${i + 1}` }
    }
    before = s.last!
    watermark = recordings.lastId(ctx.db)
    if (t.op !== 'type') entered = i === walk.length - 1 ? entered : {}
    let ok = true
    let note = ''
    switch (t.op) {
      case 'goto': {
        const r = await s.goto(t.path)
        ok = r.ok
        note = r.note
        break
      }
      case 'back': {
        const r = await s.back()
        ok = r.ok
        note = r.note
        break
      }
      case 'press': {
        const r = await s.press(t.key)
        ok = r.ok
        note = r.note
        break
      }
      case 'click':
      case 'type':
      case 'select': {
        const ref = locate(s.last!, t)
        if (!ref) {
          // A row that this account does not have, on the way to somewhere
          // else: skip it, the next step opens its own URL. The step under
          // test, or anything that types, has to be found.
          const final = i === walk.length - 1
          if (!final && t.op === 'click' && t.role === 'link') {
            steps.push({ method: 'browser', path: t.url, status: describe(t), note: 'not there in this account; skipped' })
            continue
          }
          return { verdict: 'inconclusive', steps, recordingIds: [], why: `no ${t.role} "${t.name}" on ${s.last!.path} at step ${i + 1}` }
        }
        if (t.op === 'click') {
          const r = await s.click(ref)
          ok = r.ok
          note = r.note
        } else if (t.op === 'type') {
          // A fresh account cannot reuse the original's email, and the value
          // is a palette value anyway: the same class, a different string.
          const text = /@shoal\.test$/.test(t.text) ? `walk.${Math.random().toString(36).slice(2, 8)}@shoal.test` : t.text
          const r = await s.type(ref, text)
          ok = r.ok
          note = r.note
          entered[t.name] = text
        } else {
          const r = await s.select(ref, t.value)
          ok = r.ok
          note = r.note
          entered[t.name] = t.value
        }
        break
      }
    }
    steps.push({ method: 'browser', path: t.url, status: describe(t), note })
    if (!ok) return { verdict: 'inconclusive', steps, recordingIds: [], why: `step ${i + 1} failed: ${note}` }
    last = t
    recent.push(describe(t))
  }

  const after = await s.look()
  if (!before || !last) return { verdict: 'inconclusive', steps, recordingIds: [], why: 'nothing happened' }
  const action: StepState['action'] =
    last.op === 'goto' ? { op: 'goto', url_before: before.path }
    : last.op === 'back' || last.op === 'press' ? { op: last.op, url_before: before.path }
    : last.op === 'click' ? { op: 'click', target: { role: last.role, name: last.name }, url_before: before.path }
    : { op: last.op, target: { role: last.role, name: last.name }, text: last.op === 'type' ? last.text : last.value, url_before: before.path }
  const step: StepState = { goal: want.goal, action, before: pruned(before), after: pruned(after), entered, recent: recent.slice(-8) }
  const asked = await ask(ctx, s.worker, { drive: false, step, after })
  const requests = recordings.sinceFor(ctx.db, s.worker, watermark)
  const changed = marker(before) !== marker(after)
  const judged = judge(ctx, s.worker, {
    step, before, after, changed, answers: asked.answers, requests,
    valueClasses: [], trail: s.trail, signedIn: true,
  }, { dry: true })
  const { verdicts } = judged
  const hit: Verdict | undefined = verdicts.find((v) => v.check === want.check && (v.shape === want.shape || !want.shape))
  await logStep(ctx, s, { phase: 'rewalk', step, after, asked, judged: { verdicts: hit ? [hit] : [], filed: [] }, changed, ...(want.suspicionId ? { rewalkOf: want.suspicionId } : {}) })
  const ids = requests.map((r) => r.id)
  if (hit) {
    return { verdict: 'reproduced', steps, recordingIds: ids, detail: `Walked again in ${account.email}: ${hit.observed}` }
  }
  return { verdict: 'clean', steps, recordingIds: ids }
}

/** The same control a user would pick: role and name, then position among twins. */
function locate(snap: Snapshot, t: { role: string; name: string; nth: number }): string | null {
  const same = snap.controls.filter((c) => c.role === t.role && c.name === t.name)
  if (same.length) return (same[Math.min(t.nth, same.length - 1)] ?? same[0])!.ref
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const loose = snap.controls.filter((c) => c.role === t.role && norm(c.name) === norm(t.name))
  if (loose.length) return loose[Math.min(t.nth, loose.length - 1)]!.ref
  // A row link whose name is an id: a different id in a fresh account, same position.
  if (t.role === 'link' && /^\d+$/.test(t.name)) {
    const rows = snap.controls.filter((c) => c.role === 'link' && c.inTable && /^\d+$/.test(c.name))
    if (rows.length) return rows[Math.min(t.nth, rows.length - 1)]!.ref
  }
  return null
}
