/**
 * The target is driven over HTTP, not through an in-process handle.
 *
 * In-process injection is faster and is what BBF's own suite uses, but it ties
 * Shoal to one framework and one repo's node_modules. Over the wire, the same
 * swarm points at any of the systems here, the concurrency is real sockets
 * rather than promises on one loop, and serialisation bugs are reachable.
 */
import type { Outcome, Session } from './types.js'

export async function call(
  s: Session,
  method: string,
  path: string,
  body?: unknown,
): Promise<Outcome> {
  const started = performance.now()
  const res = await fetch(`${s.base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${s.token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: any
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { raw: text.slice(0, 400) }
  }
  return { status: res.status, body: parsed, ms: Math.round(performance.now() - started) }
}

export async function login(base: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body: any = await res.json().catch(() => ({}))
  if (!res.ok || !body?.token) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`)
  }
  return body.token as string
}
