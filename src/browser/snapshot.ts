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
  /** aria-checked / aria-expanded / aria-selected, or the native checked state. */
  checked: string | null
  expanded: string | null
  selected: string | null
}

export type FormShape = {
  ref: string
  name: string
  action: string
  method: string
  selector: string
  fields: Array<{ name: string; type: string; required: boolean; label: string; ref: string }>
  submitRef: string | null
  /** The name of the button that submits it, for a mission to say "press …". */
  submit: string
  /** No <form> element: a group of fields and a button that belong together, as a SPA draws them. */
  implicit: boolean
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
  /** role=status, role=alert, .error, .alert and friends: what the app is telling the user right now. */
  messages: string[]
  /** Every visible word on screen, in document order, capped. What the judge reads. */
  visibleText: string
  /** The title of the modal dialog in front, when one is. Everything else in the snapshot is read from inside it. */
  modal: string | null
  /** Labels whose `for` points at no element: clicking them focuses nothing. */
  orphanLabels: string[]
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

  // A label that ends in "*" is the app saying required without saying
  // 'required'; the star is not part of the name.
  const star = (t) => /\*\s*$/.test(t || '')
  const unstar = (t) => clean((t || '').replace(/\*\s*$/, ''))
  const rawLabel = (el) => {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label')
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const t = by.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((n) => n.textContent).join(' ')
      if (t.trim()) return t
    }
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]')
      if (l) return l.textContent
    }
    const wrap = el.closest('label')
    if (wrap) {
      // The label's own words only. A <select> inside its label would
      // otherwise contribute every option, and a hint its whole sentence.
      const copy = wrap.cloneNode(true)
      copy.querySelectorAll('input, select, textarea, button, small, .hint, .help, [role=tooltip]').forEach((n) => n.remove())
      const own = clean(copy.textContent)
      if (own) return own
    }
    // A label beside the control with a "for" that points at nothing, or no
    // "for" at all: the wrapper has a label as a direct child, before the
    // control. Every field component in every SPA is built this way.
    // Fields only, and only a label that is not already someone else's: the
    // nearest one before the control whose "for" names nothing.
    const isField = el.matches('input, select, textarea, [role=combobox], [role=textbox], [role=listbox]')
    let box = isField ? el.parentElement : null
    for (let up = 0; box && up < 4; up++, box = box.parentElement) {
      const l = [...box.children].filter((c) => c.tagName === 'LABEL' && (c.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING))
        .filter((c) => !c.getAttribute('for') || !document.getElementById(c.getAttribute('for'))).pop()
      if (l) {
        const copy = l.cloneNode(true)
        copy.querySelectorAll('input, select, textarea, button, small, .hint, .help, [role=tooltip]').forEach((n) => n.remove())
        const own = clean(copy.textContent)
        if (own) return own
      }
      if (box.matches('form, [role=dialog], main, section, fieldset')) break
    }
    if (el.placeholder) return el.placeholder
    if (el.name) return el.name
    if (el.title) return el.title
    return ''
  }
  const labelFor = (el) => unstar(rawLabel(el))
  const requiredOf = (el) => !!el.required || el.getAttribute('aria-required') === 'true' || star(rawLabel(el))

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

  // A modal in front is the screen. What is behind it cannot be clicked —
  // Playwright refuses, the app ignores — and reading it made a dialog with
  // three fields look like the whole page with three extra fields.
  const modals = [...document.querySelectorAll('[role=dialog][aria-modal=true], [role=alertdialog], dialog[open]')].filter(visible)
  const modalEl = modals.length ? modals[modals.length - 1] : null
  const scope = modalEl || document
  const modal = modalEl ? clean((modalEl.querySelector('h1,h2,h3,[role=heading]') || {}).textContent || modalEl.getAttribute('aria-label') || 'dialog') : null

  const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=switch], [role=checkbox], [role=combobox], [onclick]'
  const nodes = [...scope.querySelectorAll(SEL)].filter(visible)

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
      // A SPA's dropdown shows its value as its text; a native one in .value.
      value: typeof el.value === 'string' && el.tagName !== 'BUTTON' ? clean(el.value) : el.getAttribute('role') === 'combobox' ? clean(el.textContent) : '',
      placeholder: clean(el.placeholder || ''),
      required: requiredOf(el),
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      href: el.tagName === 'A' ? (el.getAttribute('href') || '') : '',
      selector: uniq(el),
      options: el.tagName === 'SELECT' ? [...el.options].map((o) => clean(o.value || o.textContent)).slice(0, 20) : [],
      checked: el.type === 'checkbox' || el.type === 'radio' ? String(!!el.checked) : el.getAttribute('aria-checked'),
      expanded: el.getAttribute('aria-expanded'),
      selected: el.getAttribute('aria-selected'),
    })
  }

  const headings = [...scope.querySelectorAll('h1,h2,h3,[role=heading]')].filter(visible).map((h) => clean(h.textContent)).filter(Boolean).slice(0, 25)

  const SUBMIT = /\b(save|create|add|submit|send|record|update|confirm|apply|book|pay|place|raise|continue|next|done|finish|post|publish|generate|import|adjust|mark|invite|assign|link|sign in|log in)\b/i
  const NOT_SUBMIT = /^(cancel|close|back|dismiss|clear|reset|remove|delete)\b/i
  const fieldOf = (el) => ({
    name: el.name || labelFor(el) || el.id,
    // A <button role=combobox> is the SPA's dropdown: a select, not a button.
    type: (el.tagName === 'SELECT' || (el.getAttribute('role') === 'combobox' && el.tagName !== 'INPUT') ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.type || 'text')).toLowerCase(),
    required: requiredOf(el),
    label: labelFor(el),
    ref: el.__shoalRef || '',
  })
  const buttonName = (b) => clean(labelFor(b) || b.value || b.textContent)

  const forms = [...scope.querySelectorAll('form')].filter(visible).map((f) => {
    const fields = [...f.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(visible).map(fieldOf).filter((x) => x.name)
    const submit = f.querySelector('button[type=submit], input[type=submit], button:not([type])')
    return {
      ref: f.__shoalRef || '',
      name: clean(f.getAttribute('name') || f.getAttribute('aria-label') || (f.querySelector('h1,h2,h3') || {}).textContent || ''),
      action: f.getAttribute('data-action') || f.getAttribute('action') || '',
      method: (f.getAttribute('data-method') || f.getAttribute('method') || 'POST').toUpperCase(),
      selector: uniq(f),
      fields,
      submitRef: submit ? (submit.__shoalRef || null) : null,
      submit: submit ? buttonName(submit) : '',
      implicit: false,
    }
  })

  // A SPA draws a form without a <form>: some inputs in a dialog or a card
  // and a button called "Add customer". Without this the map of such an app
  // has no forms at all, so nothing is ever filled in and nothing is ever
  // created — 424 screens judged and not one exercised.
  const CONTAINER = '[role=dialog], [role=alertdialog], dialog, fieldset, [role=tabpanel], section, article, aside, main, form'
  const loose = [...scope.querySelectorAll('input:not([type=hidden]), select, textarea, [role=combobox]')]
    .filter(visible)
    .filter((el) => !el.closest('form'))
    .filter((el) => el.getAttribute('role') === 'combobox' || !/^(submit|button|reset|image)$/.test((el.type || '').toLowerCase()))
  const groups = new Map()
  for (const el of loose) {
    let box = el.parentElement
    while (box && box !== scope && !box.matches(CONTAINER)) box = box.parentElement
    if (!box || box === document) box = document.body
    if (!groups.has(box)) groups.set(box, [])
    groups.get(box).push(el)
  }
  for (const [box, els] of groups) {
    // The button comes after the fields — a page's "New customer" button in
    // the header is not the submit of the filter bar under it. Among those:
    // a real submit button; else the primary-looking one; else, in a dialog,
    // the last one that is not Cancel ("Take order" is the footer's last
    // button and says nothing a verb list would know); else a verb.
    const first = els[0]
    const after = [...box.querySelectorAll('button, input[type=submit], [role=button]')].filter(visible)
      .filter((b) => !!(first.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING))
      .filter((b) => { const n = buttonName(b); return n && !NOT_SUBMIT.test(n) && !/^(remove|add another|add line|\+)/i.test(n) })
    const inDialog = box.matches('[role=dialog], [role=alertdialog], dialog')
    const submit =
      after.find((b) => (b.type || '').toLowerCase() === 'submit') ||
      after.find((b) => /primary/i.test(b.className)) ||
      (inDialog ? after[after.length - 1] : null) ||
      after.find((b) => SUBMIT.test(buttonName(b)))
    if (!submit) continue
    const fields = els.map(fieldOf).filter((x) => x.name)
    if (!fields.length) continue
    const heading = box.matches('[role=dialog], [role=alertdialog], dialog') ? modal : clean((box.querySelector('h1,h2,h3,legend,[role=heading]') || {}).textContent || '')
    forms.push({
      ref: box.__shoalRef || '',
      name: heading || buttonName(submit),
      action: '',
      method: 'POST',
      selector: uniq(box),
      fields,
      submitRef: submit.__shoalRef || null,
      submit: buttonName(submit),
      implicit: true,
    })
  }

  const tables = [...scope.querySelectorAll('table')].filter(visible).slice(0, 4).map((t) => {
    const rows = [...t.querySelectorAll('tr')]
    const headers = [...(rows[0] ? rows[0].querySelectorAll('th') : [])].map((th) => clean(th.textContent))
    const body = rows.slice(headers.length ? 1 : 0).slice(0, 6).map((r) => [...r.children].map((c) => clean(c.textContent)))
    return { caption: clean((t.querySelector('caption') || {}).textContent || ''), headers, rows: body, count: rows.length - (headers.length ? 1 : 0) }
  })

  const text = [...scope.querySelectorAll('main p, main li, [role=status], .error, .alert, p')]
    .filter(visible).map((p) => clean(p.textContent)).filter((s) => s.length > 1).slice(0, 12)

  const messages = [...document.querySelectorAll('[role=status], [role=alert], output, .error, .alert, .message, .notice, .toast, .flash, .success, .warning, .invalid-feedback, .help-block, [aria-live]')]
    .filter(visible).map((m) => (m.textContent || '').replace(/\s+/g, ' ').trim()).filter((s) => s.length > 0).slice(0, 10)

  // Ported from jev-ultrafast/snapshot.js: visible words only, in order,
  // capped. Off-screen footers and hidden templates do not reach the model.
  const words = []
  const walker = document.createTreeWalker(modalEl || document.body, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let node, length = 0
  while ((node = walker.nextNode()) && length < 6000) {
    const value = node.textContent.replace(/\s+/g, ' ').trim()
    const parent = node.parentElement
    if (!value || !parent || parent.closest('script,style,noscript,template') || !visible(parent)) continue
    range.selectNodeContents(node)
    const r = range.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) { words.push(value); length += value.length }
  }
  const visibleText = words.join('\n').slice(0, 6000)

  // A label whose "for" names nothing: clicking it focuses nothing and a
  // screen reader cannot name the control. Counted here, judged in code.
  const orphanLabels = [...scope.querySelectorAll('label[for]')].filter(visible)
    .filter((l) => !document.getElementById(l.getAttribute('for')))
    .map((l) => clean(l.textContent)).filter(Boolean).slice(0, 10)

  return { url: location.href, path: location.pathname, title: document.title, headings, controls, forms, tables, text, messages, visibleText, modal, orphanLabels }
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
  if (s.modal) out.push(`dialog "${s.modal}" is open in front of the page; only what is inside it is listed`)
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
