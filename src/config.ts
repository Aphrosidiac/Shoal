import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

export type Provider = 'anthropic' | 'openai-compatible' | 'claude-code'

export type TierConfig = {
  provider: Provider
  model: string
  baseUrl?: string
  apiKey?: string
  maxTokens: number
  /**
   * Merged verbatim into the request body of an openai-compatible backend.
   * Every local runtime has one knob that matters and no two agree on its
   * name — reasoning_effort, think, chat_template_kwargs. Rather than guess
   * per model, this is the place to say it once in config.
   *
   * On a reasoning model this is the single biggest lever there is: qwen3:1.7b
   * answers a driver turn in 13s with thinking on and 1s with it off, for the
   * same choice.
   */
  extra?: Record<string, unknown>
}

export type Config = {
  url: string
  dir: string
  explorers: number
  hammerers: number
  confirmers: number
  pace: number
  mailPort: number
  slowMs: number
  ui: { port: number; enabled: boolean }
  driver: TierConfig
  planner: TierConfig
  plannerCallsPerHour: number
  budgetPerHour: number | null
  forMs: number | null
  redact: boolean
  verbose: boolean
  keepPrompts: boolean
  headless: boolean
}

const DEFAULTS: Config = {
  url: 'http://localhost:3000',
  dir: process.cwd(),
  explorers: 3,
  hammerers: 16,
  confirmers: 2,
  pace: 40,
  mailPort: 1025,
  slowMs: 1500,
  ui: { port: 7717, enabled: true },
  driver: { provider: 'anthropic', model: 'claude-haiku-4-5', maxTokens: 700 },
  planner: { provider: 'anthropic', model: 'claude-opus-5', maxTokens: 2000 },
  plannerCallsPerHour: 20,
  budgetPerHour: null,
  forMs: null,
  redact: false,
  verbose: false,
  keepPrompts: true,
  headless: true,
}

/** localhost only, and it is not negotiable. See decisions.md #3. */
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]'])

export function assertLocal(url: string): URL {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new Error(`"${url}" is not a URL. Shoal takes something like http://localhost:3000`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Shoal speaks http and https, not ${u.protocol}`)
  }
  const host = u.hostname.toLowerCase()
  const local = LOCAL.has(host) || host.endsWith('.localhost') || host === 'host.docker.internal'
  if (!local) {
    throw new Error(
      `Shoal refuses to run against ${u.hostname}. It only ever points at localhost — ` +
        `it signs itself up, submits whatever it likes and hammers your write endpoints, ` +
        `and none of that is safe anywhere but your own machine.`
    )
  }
  return u
}

export function parseDuration(s: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/.exec(s.trim())
  if (!m) throw new Error(`"${s}" is not a duration. Try 30m, 24h, 90s.`)
  const n = Number(m[1])
  const unit = m[2] ?? 'm'
  return n * { ms: 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[unit as 'ms' | 's' | 'm' | 'h' | 'd']
}

function deepMerge<T>(base: T, over: unknown): T {
  if (over === null || over === undefined) return base
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return over as T
  const out = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    if (v === undefined) continue
    out[k] = k in out ? deepMerge((base as Record<string, unknown>)[k], v) : v
  }
  return out as T
}

function fromEnv(): Record<string, unknown> {
  const e = process.env
  const num = (v: string | undefined) => (v === undefined || v === '' ? undefined : Number(v))
  const out: Record<string, unknown> = {
    url: e.SHOAL_URL,
    explorers: num(e.SHOAL_EXPLORERS),
    hammerers: num(e.SHOAL_HAMMERERS),
    confirmers: num(e.SHOAL_CONFIRMERS),
    pace: num(e.SHOAL_PACE),
    mailPort: num(e.SHOAL_MAIL_PORT),
    slowMs: num(e.SHOAL_SLOW_MS),
    plannerCallsPerHour: num(e.SHOAL_PLANNER_CALLS_PER_HOUR),
    budgetPerHour: num(e.SHOAL_BUDGET_PER_HOUR),
    ui: { port: num(e.SHOAL_UI_PORT) },
    driver: {
      provider: e.SHOAL_DRIVER_PROVIDER,
      model: e.SHOAL_DRIVER_MODEL,
      baseUrl: e.SHOAL_DRIVER_BASE_URL,
      apiKey: e.SHOAL_DRIVER_API_KEY,
    },
    planner: {
      provider: e.SHOAL_PLANNER_PROVIDER,
      model: e.SHOAL_PLANNER_MODEL,
      baseUrl: e.SHOAL_PLANNER_BASE_URL,
      apiKey: e.SHOAL_PLANNER_API_KEY,
    },
  }
  return prune(out)
}

function prune(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const inner = prune(v as Record<string, unknown>)
      if (Object.keys(inner).length) out[k] = inner
    } else out[k] = v
  }
  return out
}

/** defaults -> shoal.config.json -> SHOAL_* -> flags. Later wins. */
export function loadConfig(flags: Record<string, unknown> = {}, dir = process.cwd()): Config {
  let cfg: Config = { ...DEFAULTS, dir }
  const file = resolve(dir, 'shoal.config.json')
  if (existsSync(file)) {
    try {
      cfg = deepMerge(cfg, JSON.parse(readFileSync(file, 'utf8')))
    } catch (e) {
      throw new Error(`shoal.config.json is not valid JSON: ${(e as Error).message}`)
    }
  }
  cfg = deepMerge(cfg, fromEnv())
  cfg = deepMerge(cfg, prune(flags))
  cfg.dir = dir

  for (const k of ['explorers', 'hammerers', 'confirmers'] as const) {
    if (!Number.isFinite(cfg[k]) || cfg[k] < 0) throw new Error(`${k} must be a number of 0 or more`)
  }
  if (cfg.pace <= 0) throw new Error('pace must be greater than zero')
  return cfg
}
