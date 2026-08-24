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

export interface AuthShape {
  path?: string
  token?(body: any): string | undefined
  body?(email: string, password: string): unknown
}

/**
 * Logs in, however this particular system spells it.
 *
 * The path, the request body and where the token sits in the reply are all the
 * target's business. This was hardcoded to `/api/auth/login` returning
 * `{ token }` until a second system replied `{ success, data: { token } }` and
 * every persona failed to log in — which is what an abstraction with one
 * implementation is worth.
 */
export async function login(
  base: string,
  email: string,
  password: string,
  auth: AuthShape = {},
): Promise<string> {
  const path = auth.path ?? '/api/auth/login'

  // Backs off on 429 rather than failing.
  //
  // Throttling the login route is ordinary and sensible — one system here
  // allows five a minute — and a swarm that cannot start because of it is the
  // swarm's fault, not the target's.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(auth.body ? auth.body(email, password) : { email, password }),
    })
    const body: any = await res.json().catch(() => ({}))

    if (res.status === 429 && attempt < 4) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || (attempt + 1) * 8000
      await new Promise((r) => setTimeout(r, Math.min(wait, 30_000)))
      continue
    }

    const token = auth.token ? auth.token(body) : body?.token
    if (!res.ok || !token) {
      throw new Error(`login failed for ${email} at ${path}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`)
    }
    return token
  }
}
