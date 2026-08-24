/**
 * Reads a target's source without running it.
 *
 * Everything here is the part of describing a system that needs no judgment —
 * and, across three targets written by hand, the part where every single
 * mistake happened. A health path assumed instead of read, a login response
 * shape guessed, a rate limit discovered by being throttled twice. None of
 * those were hard. They were boring, which is worse.
 *
 * Static scanning rather than booting the target, because booting it needs a
 * database and a configuration that do not exist until this has run.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

export interface RouteHit {
  method: string
  /** Path as written, before any prefix is applied. */
  path: string
  file: string
  /** Rate limit declared on this route, if any. */
  rateLimit?: { max: number; window: string }
}

export interface Scan {
  entry: string
  healthPath?: string
  loginPath?: string
  /** Expression the login handler returns, for guessing where the token sits. */
  loginReturn?: string
  routes: RouteHit[]
  prefixes: { file: string; prefix: string }[]
  /** Lowest declared rate limit anywhere, which is what a voyage must respect. */
  tightestLimit?: { max: number; window: string; path: string }
  roles: string[]
  channelKeys: string[]
}

const SOURCE = /\.(ts|js|mts|mjs)$/
const SKIP = new Set(['node_modules', 'dist', '.git', 'build', 'coverage', '.next'])

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    let s
    try {
      s = statSync(full)
    } catch {
      continue
    }
    if (s.isDirectory()) walk(full, out)
    else if (SOURCE.test(name)) out.push(full)
  }
  return out
}

/** `fastify.post('/x', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, …)` */
const ROUTE = /\b(?:app|fastify|server)\s*\.\s*(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*[`'"]([^`'"]+)[`'"]([\s\S]{0,220}?)\)/g
const RATE = /rateLimit\s*:\s*\{[^}]*?max\s*:\s*(\d+)[^}]*?timeWindow\s*:\s*[`'"]([^`'"]+)[`'"]/
const PREFIX = /register\s*\(\s*([A-Za-z0-9_]+)[\s\S]{0,80}?prefix\s*:\s*[`'"]([^`'"]+)[`'"]/g
/**
 * A rate limiter registered on the whole app rather than on one route.
 *
 * Missed entirely at first, because the per-route form was the only one looked
 * for — and a global limit is both commoner and worse for a swarm: one system
 * here allows a hundred requests a minute across everything, which made 58% of
 * a voyage 429s while the scan reported no limits at all.
 */
const GLOBAL_RATE = /register\s*\(\s*rateLimit\s*,\s*\{[\s\S]{0,200}?max\s*:\s*(\d+)[\s\S]{0,120}?timeWindow\s*:\s*[`'"]([^`'"]+)[`'"]/

export function scanTarget(root: string): Scan {
  const files = walk(join(root, 'src')).concat(walk(join(root, 'app')))
  const routes: RouteHit[] = []
  const prefixes: { file: string; prefix: string }[] = []
  const roles = new Set<string>()
  let entry = 'src/server.ts'
  let healthPath: string | undefined
  let loginRoute: RouteHit | undefined
  let loginReturn: string | undefined
  let globalLimit: { max: number; window: string } | undefined

  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    // `tsx watch src/server.ts`, `node dist/server.js`, `tsx src/index.ts` …
    const dev: string = pkg.scripts?.dev ?? ''
    const found = dev.match(/([\w./-]+\.(?:ts|js|mts|mjs))/)
    if (found?.[1]) entry = found[1]
  } catch {
    /* keep the default */
  }

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const rel = relative(root, file)

    for (const m of src.matchAll(PREFIX)) prefixes.push({ file: m[1] as string, prefix: m[2] as string })

    const global = src.match(GLOBAL_RATE)
    if (global && !globalLimit) globalLimit = { max: Number(global[1]), window: global[2] as string }

    for (const m of src.matchAll(ROUTE)) {
      const [, method = '', path = '', tail = ''] = m
      const rl = tail.match(RATE)
      const hit: RouteHit = {
        method: method.toUpperCase(),
        path,
        file: rel,
        ...(rl ? { rateLimit: { max: Number(rl[1]), window: rl[2] as string } } : {}),
      }
      routes.push(hit)
      if (/health/i.test(path)) healthPath = path
      if (/login/i.test(path)) loginRoute = hit
    }

    // What the login handler hands back, so the token's position can be
    // proposed rather than assumed. Assuming it cost a whole target's worth of
    // failed logins once already.
    if (/login/i.test(rel)) {
      const ret = src.match(/return\s*(\{[\s\S]{0,200}?token[\s\S]{0,200}?\})/) ?? src.match(/reply\.send\(\s*(\{[\s\S]{0,240}?token[\s\S]{0,200}?\})/)
      if (ret?.[1]) loginReturn = ret[1].replace(/\s+/g, ' ').slice(0, 220)
    }

    for (const m of src.matchAll(/enum\s+(?:Role|UserRole|AdminRole)\s*\{([^}]*)\}/g)) {
      for (const line of (m[1] ?? '').split('\n')) {
        const name = line.trim().split(/\s|\/\//)[0]
        if (name && /^[A-Z_]+$/.test(name)) roles.add(name)
      }
    }
  }

  // Prisma keeps its enums outside src/.
  try {
    const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')
    for (const m of schema.matchAll(/enum\s+(?:Role|UserRole|AdminRole)\s*\{([^}]*)\}/g)) {
      for (const line of (m[1] ?? '').split('\n')) {
        const name = line.trim().split(/\s|\/\//)[0]
        if (name && /^[A-Z_]+$/.test(name)) roles.add(name)
      }
    }
  } catch {
    /* not a Prisma project */
  }

  // Routes are written relative to the prefix they are registered under, so a
  // login declared as '/login' is reachable at '/api/v1/auth/login'. Reporting
  // the bare path would put a wrong value straight into the draft, which is
  // exactly the class of mistake this command exists to stop.
  const partial: Scan = {
    entry, healthPath, routes, prefixes, roles: [...roles], channelKeys: channelKeysIn(root),
  }
  const loginPath = loginRoute
    ? ((prefixFor(partial, loginRoute.file) + loginRoute.path).replace(/\/+/g, '/') || loginRoute.path)
    : undefined

  const limited = routes.filter((r) => r.rateLimit)
  const perRoute = limited.sort((a, b) => perMinute(a.rateLimit!) - perMinute(b.rateLimit!))[0]
  // A global limit is shared across every route, so it binds a swarm harder
  // than a per-route one of the same size.
  const candidates: { max: number; window: string; path: string }[] = []
  if (perRoute) candidates.push({ ...perRoute.rateLimit!, path: perRoute.path })
  if (globalLimit) candidates.push({ ...globalLimit, path: 'every route (registered app-wide)' })
  const tightestLimit = candidates.sort((a, b) => perMinute(a) - perMinute(b))[0]

  return {
    entry,
    healthPath,
    loginPath,
    loginReturn,
    routes,
    prefixes,
    roles: [...roles],
    channelKeys: channelKeysIn(root),
    ...(tightestLimit ? { tightestLimit } : {}),
  }
}

/** Requests per minute, so limits in different windows can be compared. */
function perMinute(rl: { max: number; window: string }): number {
  const n = Number(rl.window.match(/\d+/)?.[0] ?? 1)
  if (/hour/i.test(rl.window)) return (rl.max / (n * 60))
  if (/second/i.test(rl.window)) return (rl.max * 60) / n
  return rl.max / n
}

/**
 * Keys that reach the outside world, to be blanked in the booted process.
 *
 * Erring towards blanking too much on purpose. A voyage that cannot send an
 * email is an inconvenience; a voyage that can is a message to a real customer.
 */
export function channelKeysIn(root: string): string[] {
  let raw = ''
  for (const name of ['.env', '.env.example']) {
    try {
      raw += readFileSync(join(root, name), 'utf8') + '\n'
    } catch {
      /* keep going */
    }
  }
  const keys = new Set<string>()
  for (const line of raw.split('\n')) {
    const key = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1]
    if (!key) continue
    if (/(API_KEY|SECRET|TOKEN|WEBHOOK|SMTP|MAIL|RESEND|TWILIO|WHATSAPP|OPENROUTER|OPENAI|STRIPE|BILLPLZ|TOYYIBPAY)/.test(key)) {
      keys.add(key)
    }
  }
  return [...keys]
}

/** Longest prefix whose variable name looks like it owns this file's routes. */
export function prefixFor(scan: Scan, file: string): string {
  const stem = file.split('/').pop()?.replace(/\.(routes|controller)?\.[tj]s$/, '') ?? ''
  const key = stem.replace(/[-_.]/g, '').toLowerCase()
  const hit = scan.prefixes.find((p) => p.file.toLowerCase().replace(/routes?$/, '') === key)
  return hit?.prefix ?? ''
}
