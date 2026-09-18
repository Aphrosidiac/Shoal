import type { Control, Snapshot } from '../browser/snapshot.js'
import { DESTRUCTIVE } from '../browser/snapshot.js'
import type { ScreenState } from '../jev/bank.js'

/**
 * What a snapshot looks like to Jev. Two shapes: the pruned `before`, which
 * only has to carry what the judge compares against, and the full `after`,
 * which the driver also has to act on. Jev suffers from context rot, so the
 * before is small on purpose.
 */

export function pruned(s: Snapshot): ScreenState {
  return {
    url: s.path,
    title: s.title,
    headings: s.headings.slice(0, 6),
    messages: s.messages,
    fields: fields(s),
    text: s.visibleText.slice(0, 1200),
  }
}

export function full(s: Snapshot): ScreenState {
  return {
    url: s.path,
    title: s.title,
    headings: s.headings.slice(0, 10),
    messages: s.messages,
    fields: fields(s),
    text: s.visibleText,
    elements: elements(s).map(({ ref, ...e }) => ({ index: ref, ...e })),
  }
}

export function fields(s: Snapshot): Array<{ name: string; value: string }> {
  return s.controls
    .filter((c) => c.role === 'textbox' || c.role === 'combobox' || c.role === 'checkbox' || c.role === 'radio')
    .map((c) => ({ name: c.name || c.placeholder || c.ref, value: c.role === 'checkbox' || c.role === 'radio' ? String(c.checked ?? '') : c.value }))
    .slice(0, 30)
}

export type Element = {
  ref: string
  role: string
  label: string
  value?: string
  checked?: string
  expanded?: string
  required?: boolean
  options?: string[]
  href?: string
}

/**
 * The element table: one row per interactive control, in document order.
 * Destructive controls are not on it, so they cannot be chosen — a rule in a
 * prompt is a rule a model ignores on turn three; a control that is not on
 * the list cannot be clicked. Capped at 120: Jev's 32k state budget is real.
 */
export function elements(s: Snapshot, limit = 120): Element[] {
  const out: Element[] = []
  for (const c of s.controls) {
    if (c.disabled) continue
    if (DESTRUCTIVE.test(c.name)) continue
    if (c.role === 'generic') continue
    const e: Element = { ref: c.ref, role: c.role, label: c.name || c.placeholder || c.role }
    if (c.value) e.value = c.value
    if (c.checked !== null) e.checked = c.checked
    if (c.expanded !== null) e.expanded = c.expanded
    if (c.required) e.required = true
    if (c.options.length) e.options = c.options.slice(0, 12)
    if (c.href) e.href = c.href.slice(0, 80)
    out.push(e)
    if (out.length >= limit) break
  }
  return out
}

export const isEditable = (c: Control): boolean =>
  !c.disabled && (c.role === 'textbox' || c.role === 'searchbox' || c.role === 'spinbutton' || (c.role === 'combobox' && c.tag !== 'select'))

export const isSelect = (c: Control): boolean => !c.disabled && c.tag === 'select' && c.options.length > 0

export const isClickable = (c: Control): boolean =>
  !c.disabled && !DESTRUCTIVE.test(c.name) && (c.role === 'button' || c.role === 'link' || c.role === 'checkbox' || c.role === 'radio' || c.role === 'tab' || c.role === 'menuitem' || c.role === 'switch')

/**
 * Did anything a user could see change? Compared in code, never asked of a
 * model. URL, title, messages, every field value and every control's
 * role/name/state — but not table data, which changes whenever anybody adds
 * a row and made the same screen look new all day.
 */
export function marker(s: Snapshot): string {
  return JSON.stringify([
    s.path,
    s.title,
    s.messages,
    s.headings,
    s.controls.map((c) => [c.role, c.name, c.value, c.checked, c.disabled]),
    s.visibleText.length > 600 ? s.visibleText.slice(0, 600) : s.visibleText,
  ])
}
