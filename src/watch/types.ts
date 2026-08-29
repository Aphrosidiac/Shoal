import type { Kind } from '../store/repo/findings.js'

/**
 * What a check produces. Never a finding — a signal becomes a suspicion, and
 * a suspicion only becomes a finding after replay reproduces it.
 */
export type Signal = {
  check: string
  kind: Kind
  title: string
  detail: string
  expected: string
  observed: string
  endpointId: number | null
  recordingId: number
  /** Whatever the replay probe needs to try this again. */
  data?: Record<string, unknown>
}

export const SENSITIVE_FIELD = /pass|secret|token|csrf|otp|nonce|captcha/i

export function isJsonish(headers: Record<string, string>): boolean {
  return /json/.test(String(headers['content-type'] ?? ''))
}

export function parse(body: string | null): unknown {
  if (!body) return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    return null
  }
}

/** The first object in a response, whether it came alone or in a wrapper. */
export function firstObject(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null
  if (Array.isArray(v)) return (v.find((x) => x && typeof x === 'object' && !Array.isArray(x)) as Record<string, unknown>) ?? null
  const o = v as Record<string, unknown>
  if ('id' in o || Object.values(o).some((x) => typeof x !== 'object')) return o
  for (const val of Object.values(o)) {
    const inner = firstObject(val)
    if (inner) return inner
  }
  return null
}

/** Rows out of a list response, however the app wraps them. */
export function rowsOf(v: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>
  if (!v || typeof v !== 'object') return []
  const o = v as Record<string, unknown>
  for (const key of ['rows', 'data', 'items', 'results', 'records', 'list']) {
    const c = o[key]
    if (Array.isArray(c)) return c.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>
  }
  for (const val of Object.values(o)) {
    if (Array.isArray(val) && val.every((x) => x && typeof x === 'object')) return val as Array<Record<string, unknown>>
  }
  return []
}

export function idOf(o: Record<string, unknown>): string | null {
  for (const k of ['id', '_id', 'uuid', 'pk', 'ref', 'reference', 'slug']) {
    const v = o[k]
    if (typeof v === 'string' || typeof v === 'number') return String(v)
  }
  return null
}
