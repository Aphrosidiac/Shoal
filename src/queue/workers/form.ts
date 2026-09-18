import type { Ctx } from '../../ctx.js'
import type { Session } from '../../browser/session.js'
import type { FormPayload } from '../kinds.js'
import * as map from '../../store/repo/map.js'
import * as coverage from '../../store/repo/coverage.js'
import { valueFor, type ValueClass } from '../../map/values.js'
import type { Snapshot } from '../../browser/snapshot.js'
import { namesAnObject, reach } from '../../browser/reach.js'
import { formName } from '../../map/normalise.js'
import { observe } from '../../agent/observe.js'
import * as recordings from '../../store/repo/recordings.js'
import { JevDown, BudgetExhausted } from '../../jev/client.js'

/**
 * Fill a form with one class of value that has not been tried, and submit it.
 * No model anywhere in here: the field types are already in the map, and
 * paying a model to type "-1" into a quantity box would be paying for the
 * same answer forever.
 */
export async function runForm(ctx: Ctx, s: Session, p: FormPayload): Promise<string> {
  const form = map.forms(ctx.db).find((f) => f.id === p.formId)
  if (!form) return 'that form is gone'
  const target = map.fieldsOf(ctx.db, p.formId).find((f) => f.id === p.fieldId)
  if (!target) return 'that field is gone'

  const r = namesAnObject(p.path) ? await reach(s, p.path) : await s.goto(p.path)
  if (!r.ok) return r.note

  const named = (f: Snapshot['forms'][number]): string | null =>
    formName(f.name, f.action, (path) => ctx.patterns.pattern(path))

  let snap = s.last!
  const shape = pickForm(snap, form.name, named)
  if (!shape) return `no form on ${p.path} any more`

  // everything else gets a plausible value; the one under test gets the class
  const entered: Record<string, string> = {}
  const classes: string[] = []
  for (const f of shape.fields) {
    const control = snap.controls.find((c) => c.ref === f.ref)
    if (!control || control.disabled) continue
    const cls: ValueClass = f.name === target.name ? (p.valueClass as ValueClass) : 'normal'
    if (control.role === 'combobox') {
      const opt = control.options.find((o) => o && !/^(choose|select|--)/i.test(o))
      if (opt) {
        await s.select(control.ref, opt)
        entered[control.name || f.name] = opt
      }
      continue
    }
    if (control.role === 'checkbox') {
      if (cls === 'normal') await s.click(control.ref)
      continue
    }
    const text = valueFor(f.type, cls, f.name)
    await s.type(control.ref, text)
    if (text) entered[control.name || f.name] = text
    classes.push(cls)
  }

  snap = await s.look()
  const submitRef = pickForm(snap, form.name, named)?.submitRef
  const submit = submitRef
    ? snap.controls.find((c) => c.ref === submitRef)
    : snap.controls.find((c) => c.role === 'button' && /save|create|submit|send|add|record|book|run/i.test(c.name))
  if (!submit) return 'the form has no submit button'

  const watermark = recordings.lastId(ctx.db)
  const before = snap
  await s.click(submit.ref)
  map.markTried(ctx.db, p.fieldId, p.valueClass)
  coverage.bump(ctx.db, 'actions')
  coverage.bump(ctx.db, 'fields_poked')

  // What did the screen make of it? A value class is the persona's bad habit
  // without the persona, and the contract reads the result the same way.
  let judged = ''
  try {
    const j = await observe(ctx, s, {
      goal: `submit the form on ${p.path} with ${target.name} set to a ${p.valueClass} value`,
      action: { op: 'click', target: { role: submit.role, name: submit.name }, url_before: before.path },
      before,
      entered,
      watermark,
      valueClasses: classes,
    })
    if (j.filed.length) judged = `, ${j.filed.length} suspicion${j.filed.length === 1 ? '' : 's'}`
  } catch (e) {
    if (!(e instanceof JevDown) && !(e instanceof BudgetExhausted)) ctx.log('jev', `${s.worker}: ${(e as Error).message.split('\n')[0]}`)
  }
  return `submitted ${form.name ?? p.path} with ${target.name}=${p.valueClass}${judged}`
}

/**
 * Match the form we were sent for, on the same terms the map named it. The
 * page will be showing a different invoice than the one it was mapped on, so
 * comparing raw actions finds nothing and quietly fills in whichever form
 * happens to be first.
 */
function pickForm(
  snap: Snapshot,
  name: string | null,
  named: (f: Snapshot['forms'][number]) => string | null
): Snapshot['forms'][number] | undefined {
  if (!snap.forms.length) return undefined
  if (!name) return snap.forms[0]
  return snap.forms.find((f) => named(f) === name || f.name === name || f.action === name) ?? snap.forms[0]
}
