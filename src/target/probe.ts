import { request } from 'undici'
import { fingerprintOf } from './version.js'

export type Probe = {
  up: boolean
  ms: number
  status: number
  fingerprint: string
  rendering: 'server' | 'client'
  signupPath: string | null
  loginPath: string | null
  title: string | null
  error?: string
}

const SIGNUP_GUESSES = ['/register', '/signup', '/sign-up', '/auth/register', '/users/sign_up', '/join', '/create-account', '/accounts/signup']
const LOGIN_GUESSES = ['/login', '/signin', '/sign-in', '/auth/login', '/users/sign_in', '/session/new']

let lastError = ''

async function head(url: string): Promise<{ status: number; html: string; headers: Record<string, string> } | null> {
  try {
    const res = await request(url, { method: 'GET', headers: { 'user-agent': 'shoal' } })
    const html = await res.body.text()
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : String(v ?? '')
    return { status: res.statusCode, html, headers }
  } catch (e) {
    // Saying "nothing answered" when the real problem was our own request is
    // how an hour disappears. Keep the reason and print it.
    lastError = String((e as Error).message ?? e).split('\n')[0]!
    return null
  }
}

function looksLikeAForm(html: string): boolean {
  const h = html.toLowerCase()
  return h.includes('type="password"') || h.includes("type='password'") || (h.includes('<form') && h.includes('password'))
}

/** Is it up, what is it, and where does a new user get in. */
export async function probe(base: string): Promise<Probe> {
  const t0 = Date.now()
  const root = await head(base)
  if (!root) {
    return {
      up: false, ms: Date.now() - t0, status: 0, fingerprint: 'down',
      rendering: 'server', signupPath: null, loginPath: null, title: null,
      error: `nothing answered at ${base}${lastError ? ` (${lastError})` : ''}. Is your dev server running?`,
    }
  }
  const ms = Date.now() - t0
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(root.html)?.[1]?.trim() ?? null

  // A client-rendered app answers / with a near-empty shell and a script tag.
  const textish = root.html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const rendering: 'server' | 'client' = textish.length < 200 && /<script/i.test(root.html) ? 'client' : 'server'

  const linked = new Set([...root.html.matchAll(/href="([^"#?]+)/g)].map((m) => m[1]!))
  const pick = async (guesses: string[]): Promise<string | null> => {
    const ordered = [...guesses.filter((g) => linked.has(g)), ...guesses.filter((g) => !linked.has(g))]
    for (const path of ordered) {
      const r = await head(new URL(path, base).toString())
      if (!r || r.status >= 400) continue
      if (rendering === 'client' || looksLikeAForm(r.html)) return path
    }
    return null
  }

  return {
    up: true,
    ms,
    status: root.status,
    fingerprint: fingerprintOf({ html: root.html, headers: root.headers }),
    rendering,
    signupPath: await pick(SIGNUP_GUESSES),
    loginPath: await pick(LOGIN_GUESSES),
    title,
  }
}
