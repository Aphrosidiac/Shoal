import type { Page } from 'playwright'
import { normaliseName, screenFp } from '../map/fingerprint.js'

export type Control = {
  ref: string
  role: string
  name: string
  /** Inside a table or list row: this control is data, not structure. */
  inTable: boolean
  tag: string
  type: string
  value: string
  placeholder: string
  required: boolean
  disabled: boolean
  href: string
  selector: string
  options: string[]
}

export type FormShape = {
  ref: string
  name: string
  action: string
  method: string
  selector: string
  fields: Array<{ name: string; type: string; required: boolean; label: string; ref: string }>
  submitRef: string | null
}

export type TableShape = { caption: string; headers: string[]; rows: string[][]; count: number }

export type Snapshot = {
  url: string
  path: string
  title: string
  headings: string[]
  controls: Control[]
  forms: FormShape[]
  tables: TableShape[]
  text: string[]
  fp: string
  urlPattern: string
}

/**
 * An accessibility tree, not a screenshot and not raw HTML. Roughly 2-5KB
 * against 100KB+ for a screenshot, and it is the only thing the driver ever
 * sees. Reading the DOM is observation; nothing here changes page state, and
 * the agent has no way to run script of its own — see decisions.md #21.
 */
const WALK = String.raw`() => {
  const uniq = (el) => {
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id)
    const parts = []
    let n = el
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      const parent = n.parentElement
      if (!parent) break
      const same = [...parent.children].filter((c) => c.tagName === n.tagName)
      parts.unshift(same.length === 1 ? n.tagName.toLowerCase() : n.tagName.toLowerCase() + ':nth-of-type(' + (same.indexOf(n) + 1) + ')')
      n = parent
    }
    return parts.length ? 'html > ' + parts.join(' > ') : 'html'
  }

  const visible = (el) => {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return false
    if (el.closest('[aria-hidden="true"]')) return false
    return true
  }

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 120)

  const labelFor = (el) => {
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'))
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const t = by.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((n) => n.textContent).join(' ')
      if (t.trim()) return clean(t)
    }
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]')
      if (l) return clean(l.textContent)
    }
    const wrap = el.closest('label')
    if (wrap) return clean(wrap.textContent)
    if (el.placeholder) return clean(el.placeholder)
    if (el.name) return clean(el.name)
    if (el.title) return clean(el.title)
    return ''
  }

  const roleOf = (el) => {
    const explicit = el.getAttribute('role')
    if (explicit) return explicit
    const tag = el.tagName.toLowerCase()
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : 'generic'
    if (tag === 'button') return 'button'
    if (tag === 'select') return 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'summary') return 'button'
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase()
      if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return 'button'
      if (t === 'checkbox') return 'checkbox'
      if (t === 'radio') return 'radio'
      if (t === 'range') return 'slider'
      if (t === 'file') return 'file'
      return 'textbox'
    }
    return 'generic'
  }

  const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [onclick]'
  const nodes = [...document.querySelectorAll(SEL)].filter(visible)

  let i = 0
  const seen = new Map()
  const controls = []
  for (const el of nodes) {
    if (seen.has(el)) continue
    seen.set(el, true)
    const ref = 'e' + ++i
    el.__shoalRef = ref
    controls.push({
      ref,
      role: roleOf(el),
      name: clean(labelFor(el) || el.value || el.textContent),
      inTable: !!el.closest('table, tbody, tr, li, [role=row], [role=listitem]'),
      tag: el.tagName.toLowerCase(),
      type: (el.type || '').toLowerCase(),
      value: typeof el.value === 'string' ? clean(el.value) : '',
      placeholder: clean(el.placeholder || ''),
      required: !!el.required || el.getAttribute('aria-required') === 'true',
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      href: el.tagName === 'A' ? (el.getAttribute('href') || '') : '',
      selector: uniq(el),
      options: el.tagName === 'SELECT' ? [...el.options].map((o) => clean(o.value || o.textContent)).slice(0, 20) : [],
    })
  }

  const headings = [...document.querySelectorAll('h1,h2,h3,[role=heading]')].filter(visible).map((h) => clean(h.textContent)).filter(Boolean).slice(0, 25)

  const forms = [...document.querySelectorAll('form')].filter(visible).map((f) => {
    const fields = [...f.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(visible).map((el) => ({
      name: el.name || el.id || labelFor(el),
      type: (el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.type || 'text')).toLowerCase(),
      required: !!el.required,
      label: labelFor(el),
      ref: el.__shoalRef || '',
    })).filter((x) => x.name)
    const submit = f.querySelector('button[type=submit], input[type=submit], button:not([type])')
    return {
      ref: f.__shoalRef || '',
      name: clean(f.getAttribute('name') || f.getAttribute('aria-label') || (f.querySelector('h1,h2,h3') || {}).textContent || ''),
      action: f.getAttribute('data-action') || f.getAttribute('action') || '',
      method: (f.getAttribute('data-method') || f.getAttribute('method') || 'POST').toUpperCase(),
      selector: uniq(f),
      fields,
      submitRef: submit ? (submit.__shoalRef || null) : null,
    }
  })

  const tables = [...document.querySelectorAll('table')].filter(visible).slice(0, 4).map((t) => {
    const rows = [...t.querySelectorAll('tr')]
    const headers = [...(rows[0] ? rows[0].querySelectorAll('th') : [])].map((th) => clean(th.textContent))
    const body = rows.slice(headers.length ? 1 : 0).slice(0, 6).map((r) => [...r.children].map((c) => clean(c.textContent)))
    return { caption: clean((t.querySelector('caption') || {}).textContent || ''), headers, rows: body, count: rows.length - (headers.length ? 1 : 0) }
  })

  const text = [...document.querySelectorAll('main p, main li, [role=status], .error, .alert, p')]
    .filter(visible).map((p) => clean(p.textContent)).filter((s) => s.length > 1).slice(0, 12)

  return { url: location.href, path: location.pathname, title: document.title, headings, controls, forms, tables, text }
}`

export async function snapshot(page: Page, urlPattern: (path: string) => string): Promise<Snapshot> {
  // An immediately-invoked expression, not a bare function: `evaluate` with a
  // string evaluates it, and a lone arrow function evaluates to the function.
  //
  // A click that navigates destroys the context mid-read. That is normal —
  // it is what a link does — so look again rather than treating it as a fault.
  let raw: Omit<Snapshot, 'fp' | 'urlPattern'>
  try {
    raw = (await page.evaluate(`(${WALK})()`)) as Omit<Snapshot, 'fp' | 'urlPattern'>
  } catch (e) {
    if (!/Execution context was destroyed|Target closed|navigating/i.test(String((e as Error).message))) throw e
    await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => undefined)
    raw = (await page.evaluate(`(${WALK})()`)) as Omit<Snapshot, 'fp' | 'urlPattern'>
  }
  const pattern = urlPattern(raw.path)
  const fp = screenFp({
    urlPattern: pattern,
    headings: raw.headings,
    // A link in a table row is a row, not a control the screen is made of.
    // Counting them made a list re-fingerprint every time anything was added
    // to it, so the same screen looked new all day and an explorer would keep
    // describing it instead of leaving.
    controls: raw.controls.filter((c) => !c.inTable).map((c) => ({ role: c.role, name: c.name })),
  })
  return { ...raw, fp, urlPattern: pattern }
}

/**
 * The compact text the model actually sees. Interactive elements and headings
 * only, long tables truncated to a few rows plus a count, repeated rows
 * collapsed. Roughly 1.2K on an ordinary page.
 */
export const DESTRUCTIVE = /log ?out|sign ?out|delete (my |your )?account|close account|change password|deactivate/i

export function render(s: Snapshot, opts: { maxControls?: number } = {}): string {
  const out: string[] = []
  out.push(`page ${s.path}${s.title ? `  "${s.title}"` : ''}`)
  for (const h of s.headings.slice(0, 8)) out.push(`heading "${h}"`)

  for (const t of s.tables) {
    out.push(`table ${t.count} row${t.count === 1 ? '' : 's'}${t.headers.length ? ` [${t.headers.join(' | ')}]` : ''}`)
    const shown = new Set<string>()
    for (const r of t.rows.slice(0, 3)) {
      const line = r.join(' | ').slice(0, 110)
      const key = normaliseName(line)
      if (shown.has(key)) continue
      shown.add(key)
      out.push(`  ${line}`)
    }
    if (t.count > 3) out.push(`  … ${t.count - 3} more`)
  }

  const limit = opts.maxControls ?? 40
  // Never shown to a model. "Do not log out" in a system prompt is a rule a
  // weak driver ignores on turn three; a control that is not on the list
  // cannot be clicked. The fast path filters the same set.
  const controls = s.controls.filter((c) => !DESTRUCTIVE.test(c.name)).slice(0, limit)
  for (const c of controls) {
    const bits: string[] = []
    if (c.type && c.role === 'textbox' && c.type !== 'text') bits.push(c.type)
    if (c.required) bits.push('required')
    if (c.disabled) bits.push('disabled')
    if (c.value) bits.push(`value="${c.value}"`)
    else if (c.role === 'textbox') bits.push('empty')
    if (c.options.length) bits.push(`options: ${c.options.slice(0, 6).join(', ')}`)
    out.push(`${c.role.padEnd(8)} [${c.ref}] "${c.name}"${bits.length ? '  (' + bits.join(', ') + ')' : ''}`)
  }
  if (s.controls.length > limit) out.push(`… ${s.controls.length - limit} more controls not shown`)

  for (const p of s.text.slice(0, 4)) if (p.length > 3) out.push(`text "${p.slice(0, 100)}"`)
  return out.join('\n')
}
