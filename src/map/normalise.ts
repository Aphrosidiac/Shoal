/**
 * Raw URLs are useless for counting anything. /api/invoices/8123 and
 * /api/invoices/8124 are the same endpoint. Rules, applied in order:
 *
 *   1  a segment that is all digits            -> :id
 *   2  a segment that looks like a uuid/cuid   -> :id
 *   3  a segment that has taken more than five distinct values in the same
 *      position with the same neighbours, and that looks like data rather
 *      than a route name                       -> :id
 *   4  everything else stays literal
 *
 * Rule 3 needs traffic to fire, which is fine: patterns get merged
 * retroactively as the run goes on.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CUID = /^c[a-z0-9]{20,}$/i
const NANO = /^[A-Za-z0-9_-]{16,}$/
const HEXY = /^[0-9a-f]{16,}$/i

export const ID = ':id'

function looksLikeId(seg: string): boolean {
  if (seg === '') return false
  if (/^\d+$/.test(seg)) return true
  if (UUID.test(seg) || CUID.test(seg) || HEXY.test(seg)) return true
  // a long opaque token with both cases and digits is an id, not a route name
  if (NANO.test(seg) && /\d/.test(seg) && /[A-Za-z]/.test(seg) && !seg.includes('-')) return true
  return false
}

/**
 * Rule 3 is meant for slugs and reference numbers that do not look like ids —
 * INV-2081, acme-corp-sdn-bhd. It is NOT meant for a site's top-level pages.
 *
 * The first version of this collapsed /about, /terms, /privacy, /pricing,
 * /contact, /login and /register into a single `/:id`, because seven
 * single-segment paths share one slot, and took most of the map with them.
 * A route name is a word. Data has digits in it, or is too long to be a word.
 */
function looksLikeData(values: Set<string>): boolean {
  let dataish = 0
  for (const v of values) {
    if (/\d/.test(v) || v.length >= 12 || (v.match(/-/g) ?? []).length >= 2) dataish++
  }
  return dataish / values.size >= 0.5
}

export class Patterns {
  /** key: "position|prev|next" -> the literal values seen there */
  private seen = new Map<string, Set<string>>()
  private promoted = new Set<string>()

  private slot(parts: string[], i: number): string {
    return `${i}|${parts[i - 1] ?? '^'}|${parts[i + 1] ?? '$'}`
  }

  /** Records a real path and returns its pattern. */
  observe(pathname: string): string {
    const parts = pathname.split('/').filter((s) => s.length > 0)
    for (let i = 0; i < parts.length; i++) {
      const raw = parts[i]!
      if (looksLikeId(raw)) continue
      const key = this.slot(parts, i)
      if (this.promoted.has(key)) continue
      let set = this.seen.get(key)
      if (!set) this.seen.set(key, (set = new Set()))
      set.add(raw)
      if (set.size > 5 && looksLikeData(set)) {
        this.promoted.add(key)
        this.seen.delete(key)
      }
    }
    return this.pattern(pathname)
  }

  /** Turns a path into a pattern without recording anything. */
  pattern(pathname: string): string {
    const parts = pathname.split('/').filter((s) => s.length > 0)
    const out = parts.map((raw, i) => {
      if (looksLikeId(raw)) return ID
      return this.promoted.has(this.slot(parts, i)) ? ID : raw
    })
    return '/' + out.join('/')
  }

  /** Which slots have been promoted; used to merge patterns retroactively. */
  promotedSlots(): string[] {
    return [...this.promoted]
  }
}

/** Query strings never form part of a pattern, but their key set can matter. */
export function queryKeys(search: string): string[] {
  if (!search || search === '?') return []
  return [...new URLSearchParams(search).keys()].sort()
}

/**
 * What to call a form. Its own name if it has one, otherwise the shape of
 * where it posts — never the concrete address, because an address with an id
 * in it makes one form look like one form per row.
 */
export function formName(name: string, action: string, pattern: (p: string) => string): string | null {
  const named = (name ?? '').trim()
  if (named) return named.slice(0, 80)
  const target = (action ?? '').trim()
  if (!target) return null
  try {
    const u = new URL(target, 'http://x')
    return pattern(u.pathname).slice(0, 80)
  } catch {
    return target.slice(0, 80)
  }
}
