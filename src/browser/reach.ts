import type { Session } from './session.js'
import { valueFor } from '../map/values.js'

/**
 * An address like /app/customers/3 belongs to whichever account first saw it.
 * Another explorer, on its own account, gets a 404 there — and then fills in a
 * form that submits against an object it does not own, which looks like a
 * refused write rather than what it is.
 *
 * So when a screen names an object, reach it the way a person would: open the
 * list it came from and click a row.
 */
export async function reach(s: Session, url: string): Promise<{ ok: boolean; note: string }> {
  const direct = await s.goto(url)
  if (direct.ok && !looksMissing(s)) return { ok: true, note: direct.note }

  const parent = parentOf(url)
  if (!parent) return { ok: false, note: `could not open ${url}` }

  const list = await s.goto(parent)
  if (!list.ok) return { ok: false, note: `could not open ${parent} either` }

  const pattern = detailPattern(url)
  let link = s.last!.controls.find((c) => c.role === 'link' && c.href && pattern.test(c.href))

  // An empty list has exactly one affordance, and it is the create button.
  //
  // Every explorer signs up its own account, so its world starts empty: a
  // worker sent to fill in a payment form finds no invoices, because nothing
  // it did made one. It would then fail forever, which is how the endpoint
  // behind three of the eleven planted bugs ended a thirty-minute run having
  // never been called at all. So do what a person would do — make one first.
  if (!link) {
    // Some collections have no create button because nothing creates them
    // directly: an invoice exists because an order was raised. So if this list
    // cannot be added to, go and add to one that can, then come back. That is
    // the chain a person follows without thinking about it, and without it an
    // account that starts empty can never reach a payment form at all.
    const made = (await createOne(s, parent)) || (await createElsewhere(s, parent))
    if (!made) return { ok: false, note: `${parent} is empty for this account and nothing I could do filled it` }
    await s.goto(parent)
    link = s.last!.controls.find((c) => c.role === 'link' && c.href && pattern.test(c.href))
    if (!link) return { ok: false, note: `made one from ${parent} and it still does not list anything` }
  }

  const clicked = await s.click(link.ref)
  if (!clicked.ok || looksMissing(s)) return { ok: false, note: `followed a row from ${parent} and it was not there` }

  // /app/invoices/3/pay is a screen hanging off an object, not the object.
  // Having reached one of our own invoices, take the same last step.
  const tail = suffixOf(url)
  if (tail) {
    const onward = s.last!.controls.find((c) => c.role === 'link' && c.href && c.href.replace(/\/$/, '').endsWith(tail))
    if (!onward) return { ok: false, note: `reached one of my own from ${parent} but nothing there leads to ${tail}` }
    const step = await s.click(onward.ref)
    if (!step.ok || looksMissing(s)) return { ok: false, note: `could not get to ${tail} from one of my own` }
    return { ok: true, note: `reached ${tail} on one of my own, from ${parent}` }
  }
  return { ok: true, note: `reached one of my own from ${parent}` }
}

/** Whatever hangs off the object in the address: /invoices/3/pay -> /pay */
export function suffixOf(url: string): string | null {
  let u: URL
  try {
    u = new URL(url, 'http://x')
  } catch {
    return null
  }
  const parts = u.pathname.split('/').filter(Boolean)
  for (let i = parts.length - 1; i >= 0; i--) {
    if (isId(parts[i]!)) return i === parts.length - 1 ? null : '/' + parts.slice(i + 1).join('/')
  }
  return null
}

const CREATE = /^(new|add|create|raise|start)\b|\b(new|add|create)$/i

/**
 * Fill in whatever the "New …" affordance on a list leads to, with plausible
 * values, so the list stops being empty. Deliberately dumb: it uses the same
 * value generator the form worker does and does not care what it made, only
 * that the collection now has something in it.
 */
async function createOne(s: Session, listPath: string): Promise<boolean> {
  const entry =
    s.last!.controls.find((c) => (c.role === 'link' || c.role === 'button') && CREATE.test(c.name)) ??
    s.last!.controls.find((c) => c.href && /\/(new|create|add)$/i.test(c.href))
  if (!entry) return false

  const opened = await s.click(entry.ref)
  if (!opened.ok) return false

  const form = s.last!.forms[0]
  if (!form) return false
  for (const f of form.fields) {
    const c = s.last!.controls.find((x) => x.ref === f.ref)
    if (!c || c.disabled) continue
    if (c.role === 'combobox') {
      const opt = c.options.find((o) => o && !/^(choose|select|--)/i.test(o))
      if (opt) await s.select(c.ref, opt)
      continue
    }
    if (c.role === 'checkbox') continue
    await s.type(c.ref, valueFor(f.type, 'normal', f.name))
  }
  await s.look()
  const submit = form.submitRef
    ? s.last!.controls.find((c) => c.ref === form.submitRef)
    : s.last!.controls.find((c) => c.role === 'button' && /save|create|submit|add|raise/i.test(c.name))
  if (!submit) return false
  const sent = await s.click(submit.ref)
  void listPath
  return sent.ok
}

/**
 * Make something in a neighbouring collection and see whether it fills this
 * one. Deliberately blind about which neighbour matters — it tries the ones
 * the app's own navigation offers and stops at the first that works.
 */
async function createElsewhere(s: Session, emptyList: string): Promise<boolean> {
  const origin = new URL(s.ctxBase).origin
  const siblings = s
    .last!.controls.filter((c) => c.role === 'link' && c.href)
    .map((c) => {
      try {
        return new URL(c.href, origin).pathname
      } catch {
        return ''
      }
    })
    .filter((p) => p && p !== emptyList && !/\/(login|register|signup|logout)\b/i.test(p) && p.split('/').length <= 3)
  const tried = new Set<string>()

  for (const path of siblings) {
    if (tried.size >= 3) break
    if (tried.has(path)) continue
    tried.add(path)
    const there = await s.goto(path)
    if (!there.ok) continue
    if (!(await createOne(s, path))) continue
    const back = await s.goto(emptyList)
    if (back.ok && s.last!.controls.some((c) => c.role === 'link' && c.href.startsWith(emptyList + '/'))) return true
  }
  return false
}

/** A 404 body, an error banner, or a screen with nothing on it. */
function looksMissing(s: Session): boolean {
  const snap = s.last
  if (!snap) return true
  const text = snap.text.join(' ').toLowerCase()
  if (/\bno such\b|\bnot found\b|\bdoes not exist\b|404/.test(text)) return true
  return false
}

export function parentOf(url: string): string | null {
  let u: URL
  try {
    u = new URL(url, 'http://x')
  } catch {
    return null
  }
  const parts = u.pathname.split('/').filter(Boolean)
  for (let i = parts.length - 1; i >= 0; i--) {
    if (isId(parts[i]!)) return '/' + parts.slice(0, i).join('/')
  }
  return null
}

function detailPattern(url: string): RegExp {
  const parent = parentOf(url) ?? ''
  return new RegExp('^' + parent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/[^/]+')
}

const isId = (s: string): boolean => /^\d+$/.test(s) || /^[0-9a-f-]{16,}$/i.test(s)
export const namesAnObject = (url: string): boolean => parentOf(url) !== null
