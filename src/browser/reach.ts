import type { Session } from './session.js'

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
  const link = s.last!.controls.find((c) => c.role === 'link' && c.href && pattern.test(c.href))
  if (!link) return { ok: false, note: `nothing on ${parent} leads to one of these, so this account has none yet` }

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
