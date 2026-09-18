import type { Ctx } from '../ctx.js'
import type { Snapshot, Control } from '../browser/snapshot.js'
import { choice, asChoice, type Answer, type Question, type JevResult } from '../jev/client.js'
import { contract, fieldKind, NEXT_ACTION, TARGET, type StepState } from '../jev/bank.js'
import { elements, full, pruned, isClickable, isEditable, isSelect } from './screen.js'

/**
 * One request per step. The driving heads and the judging questions share
 * one state, so the judgment of the last action rides for free on the request
 * that chooses the next one. Ported shape from jev-ultrafast/model.py: an
 * operation head, then one speculative target head per operation, and code
 * reads only the head that matches the chosen operation.
 */

export type Operation = 'CLICK' | 'TYPE_TEXT' | 'SELECT' | 'WAIT' | 'DONE' | 'BLOCKED'

export type Decision = {
  operation: Operation
  /** The control chosen for the operation, when it takes one. */
  target: Control | null
  /** For SELECT: the option value. */
  option: string | null
  confidence: number
  targetConfidence: number | null
  /** Jev's field kind for every editable on screen, by ref. */
  fieldKinds: Record<string, string>
}

export type Asked = {
  answers: Record<string, Answer>
  decision: Decision | null
  usage: JevResult['usage']
  ms: number
  cached: boolean
}

export type AskOpts = {
  /** Include the driving heads. Explore mode leaves them out and code picks. */
  drive: boolean
  step: StepState
  after: Snapshot
}

export async function ask(ctx: Ctx, worker: string, o: AskOpts): Promise<Asked> {
  const questions: Record<string, Question> = contract(o.step)
  const state: Record<string, unknown> = {
    goal: o.step.goal,
    recent_actions: o.step.recent.slice(-8),
    action: o.step.action,
    before: o.step.before,
    after: o.drive ? full(o.after) : pruned(o.after),
    entered: o.step.entered,
  }

  const table = elements(o.after)
  const byRef = new Map(o.after.controls.map((c) => [c.ref, c]))
  const clickables = table.filter((e) => isClickable(byRef.get(e.ref)!))
  const editables = table.filter((e) => isEditable(byRef.get(e.ref)!))
  const selects = table.filter((e) => isSelect(byRef.get(e.ref)!))

  if (o.drive) {
    const ops: Record<string, string> = {}
    if (clickables.length) ops.CLICK = 'Click a button, link, tab, checkbox, radio or menu item.'
    if (editables.length) ops.TYPE_TEXT = 'Enter or replace text in an editable field. Code supplies the value.'
    if (selects.length) ops.SELECT = 'Choose an option in a dropdown.'
    ops.WAIT = 'Wait for the page to update.'
    ops.DONE = 'Every part of the goal is visibly satisfied on `after`.'
    ops.BLOCKED = 'No supported operation can make progress toward the goal.'
    questions['drive.operation'] = choice({ goal: o.step.goal, question: 'Which operation should be performed next on `after`?', rules: NEXT_ACTION }, ops)
    const head = (name: string, op: string, xs: typeof table) =>
      (questions[name] = choice(
        { goal: o.step.goal, operation: op, question: `Which element of \`after.elements\` should ${op} act on?`, rules: [NEXT_ACTION, TARGET] },
        Object.fromEntries(xs.map((e) => [e.ref, { element: `[${e.ref}] ${e.role} "${e.label}"`, ...(e.value ? { current_value: e.value } : {}), ...(e.checked ? { checked: e.checked } : {}), ...(e.href ? { href: e.href } : {}) }]))
      ))
    if (clickables.length) head('drive.click_target', 'CLICK', clickables)
    if (editables.length) head('drive.type_target', 'TYPE_TEXT', editables)
    if (selects.length) {
      // Native dropdown options are a closed set: "e5:2" is element 5, option 2.
      const opts: Record<string, unknown> = {}
      for (const e of selects) {
        const c = byRef.get(e.ref)!
        c.options.forEach((opt, i) => {
          if (!opt || /^(choose|select|--|please)/i.test(opt)) return
          opts[`${e.ref}:${i}`] = { element: `[${e.ref}] "${e.label}"`, option: opt, current_value: c.value }
        })
      }
      if (Object.keys(opts).length) {
        questions['drive.select_target'] = choice(
          { goal: o.step.goal, operation: 'SELECT', question: 'Which dropdown option of `after.elements` should SELECT choose?', rules: [NEXT_ACTION, TARGET] },
          opts
        )
      }
    }
    for (const e of editables.slice(0, 10)) questions[`kind.${e.ref}`] = fieldKind(e.ref, e.label)
  }

  const res = await ctx.jev.ask(worker, state, questions)
  const a = res.answers
  let decision: Decision | null = null
  if (o.drive) {
    const op = asChoice(a['drive.operation'])!
    const operation = op.choice as Operation
    const fieldKinds: Record<string, string> = {}
    for (const e of editables) {
      const k = asChoice(a[`kind.${e.ref}`])
      if (k) fieldKinds[e.ref] = k.choice
    }
    let target: Control | null = null
    let option: string | null = null
    let targetConfidence: number | null = null
    if (operation === 'CLICK' || operation === 'TYPE_TEXT') {
      const h = asChoice(a[operation === 'CLICK' ? 'drive.click_target' : 'drive.type_target'])
      if (h) {
        target = byRef.get(h.choice) ?? null
        targetConfidence = h.confidence
      }
    } else if (operation === 'SELECT') {
      const h = asChoice(a['drive.select_target'])
      if (h) {
        const [ref, idx] = h.choice.split(':')
        target = byRef.get(ref!) ?? null
        option = target?.options[Number(idx)] ?? null
        targetConfidence = h.confidence
      }
    }
    decision = { operation, target, option, confidence: op.confidence, targetConfidence, fieldKinds }
  }
  return { answers: a, decision, usage: res.usage, ms: res.ms, cached: res.cached }
}
