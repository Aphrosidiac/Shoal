import { createHash } from 'node:crypto'

const h = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 16)

/**
 * Action fingerprint — method + path pattern + the set of body fields that
 * were set. Names only, never values. Two payments of different amounts are
 * the same action; a payment without a reference is a different one, because
 * it takes a different branch.
 */
export function actionFp(method: string, pathPattern: string, body: unknown): string {
  const fields = bodyFields(body)
  return `${method.toUpperCase()} ${pathPattern}${fields.length ? ' {' + fields.join(',') + '}' : ''}`
}

export function bodyFields(body: unknown): string[] {
  let v: unknown = body
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return []
    try {
      v = JSON.parse(s)
    } catch {
      if (s.includes('=')) return [...new URLSearchParams(s).keys()].sort()
      return []
    }
  }
  if (!v || typeof v !== 'object') return []
  if (Array.isArray(v)) return ['[]']
  return Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val !== undefined && val !== null && val !== '')
    .map(([k]) => k)
    .sort()
}

/**
 * Screen fingerprint — the sorted roles and accessible names of every
 * interactive element, plus the headings. Content is excluded, so every
 * invoice detail page fingerprints identically.
 */
export function screenFp(input: {
  urlPattern: string
  headings: string[]
  controls: Array<{ role: string; name: string }>
}): string {
  const controls = input.controls
    .map((c) => `${c.role}:${normaliseName(c.name)}`)
    .sort()
  const headings = input.headings.map(normaliseName).sort()
  return h([input.urlPattern, headings.join('|'), controls.join('|')].join('\n'))
}

/** Strips the parts of a label that are data rather than structure. */
export function normaliseName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

/** Finding fingerprint — endpoint + check + failure shape. */
export function findingFp(endpoint: string, check: string, shape: string): string {
  return h(`${endpoint}\n${check}\n${shape}`)
}
