import { createHash } from 'node:crypto'
import type { Config, TierConfig } from '../config.js'
import type { DB } from '../store/db.js'
import * as spend from '../store/repo/spend.js'

export type Message = { role: 'user' | 'assistant'; content: string }

export type ToolDef = {
  name: string
  description: string
  schema: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
    additionalProperties: false
  }
}

export type ToolCall = { name: string; input: Record<string, unknown> }

export type Usage = { in: number; cachedIn: number; out: number }

export type CallReq = {
  system: string
  messages: Message[]
  tools: ToolDef[]
  maxTokens: number
  /** Stable prefix first, volatile last. The cache is a prefix match. */
  cachePrefix?: boolean
}

export type CallRes = { tool?: ToolCall; text?: string; usage: Usage; repaired?: number }

export interface Model {
  id: string
  provider: string
  call(req: CallReq): Promise<CallRes>
}

/** Dollars per million tokens, in / out. Only used to report spend. */
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5': [5, 25],
  'claude-sonnet-5': [2, 10],
  'claude-fable-5': [10, 40],
  'claude-haiku-4-5': [1, 5],
  'claude-opus-4-5': [5, 25],
  'claude-sonnet-4-5': [3, 15],
}

export function priceOf(model: string, u: Usage): number {
  const p = PRICES[model]
  if (!p) return 0
  const fresh = Math.max(0, u.in - u.cachedIn)
  return (fresh * p[0] + u.cachedIn * p[0] * 0.1 + u.out * p[1]) / 1_000_000
}

export class ModelDown extends Error {
  constructor(message: string, readonly retryAfterMs: number | null = null) {
    super(message)
    this.name = 'ModelDown'
  }
}

/**
 * Both tiers, plus the bookkeeping every call goes through. Nothing else in
 * Shoal talks to a provider directly.
 */
export class Models {
  driver: Model
  planner: Model
  private db: DB
  private cfg: Config
  /** Set when a provider is refusing us, so workers can degrade to free work. */
  driverDownUntil = 0
  plannerDownUntil = 0

  constructor(db: DB, cfg: Config, driver: Model, planner: Model) {
    this.db = db
    this.cfg = cfg
    this.driver = driver
    this.planner = planner
  }

  driverUp(): boolean {
    return Date.now() >= this.driverDownUntil
  }
  plannerUp(): boolean {
    return Date.now() >= this.plannerDownUntil
  }

  /** Planner calls are capped per hour, which is what a subscription meters. */
  plannerBudgetLeft(): number {
    const used = spend.callsByTierSince(this.db, 'planner', 3600_000)
    return Math.max(0, this.cfg.plannerCallsPerHour - used)
  }

  async run(tier: 'driver' | 'planner', worker: string, req: CallReq): Promise<CallRes> {
    const model = tier === 'driver' ? this.driver : this.planner
    const t0 = Date.now()
    try {
      const res = await model.call(req)
      const hash = createHash('sha1').update(req.system + JSON.stringify(req.messages)).digest('hex').slice(0, 16)
      spend.record(this.db, {
        worker,
        tier,
        provider: model.provider,
        model: model.id,
        prompt_hash: hash,
        in_tokens: res.usage.in,
        cached_in: res.usage.cachedIn,
        out_tokens: res.usage.out,
        ms: Date.now() - t0,
        chose: res.tool?.name ?? null,
        repaired: res.repaired ?? 0,
        usd: priceOf(model.id, res.usage),
        prompt: this.cfg.keepPrompts ? JSON.stringify({ system: req.system, messages: req.messages }).slice(0, 20_000) : null,
      })
      if (tier === 'driver') this.driverDownUntil = 0
      else this.plannerDownUntil = 0
      return res
    } catch (e) {
      const err = e as ModelDown
      const backoff = err.retryAfterMs ?? 30_000
      if (tier === 'driver') this.driverDownUntil = Date.now() + backoff
      else this.plannerDownUntil = Date.now() + backoff
      throw e
    }
  }
}

export async function buildModels(db: DB, cfg: Config): Promise<Models> {
  const driver = await makeModel(cfg.driver, 'driver')
  const planner = await makeModel(cfg.planner, 'planner')
  return new Models(db, cfg, driver, planner)
}

export async function makeModel(tier: TierConfig, which: 'driver' | 'planner'): Promise<Model> {
  switch (tier.provider) {
    case 'anthropic': {
      const { AnthropicModel } = await import('./anthropic.js')
      return new AnthropicModel(tier)
    }
    case 'openai-compatible': {
      const { OpenAICompatModel } = await import('./openai-compat.js')
      return new OpenAICompatModel(tier)
    }
    case 'claude-code': {
      // It works as a driver, and on a machine with no API key it is the only
      // way to measure the driver against Claude at all. It is still the wrong
      // default: one subprocess per call, on a quota shared with your own
      // session, for the tier that makes nine calls out of ten.
      if (which === 'driver') {
        process.stderr.write(
          'note: the driver is on claude-code. That is one spawned process per turn against a ' +
            'subscription quota you are also using yourself. Fine for a short run or a bench leg; ' +
            'point it at a local model for anything longer.\n'
        )
      }
      const { ClaudeCodeModel } = await import('./claude-code.js')
      return new ClaudeCodeModel(tier)
    }
    default:
      throw new Error(`unknown provider "${String(tier.provider)}". Use anthropic, openai-compatible or claude-code.`)
  }
}
