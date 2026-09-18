import { createHash } from 'node:crypto'
import type { DB } from '../store/db.js'
import * as spend from '../store/repo/spend.js'

/**
 * Jev is not an LLM. It is TypeSafe's System One model: send a `state` and a
 * map of typed questions, get back typed answers with calibrated
 * probabilities. It never generates text, which is exactly why it is allowed
 * to judge — a Noul at 0.93 is a measurement code can threshold, not a
 * paragraph of confident prose. See docs/ai.md.
 *
 * One request carries every question about one state, and they run in
 * parallel: adding thirty judgment questions to a driving request costs the
 * tokens of the questions and no extra round trip.
 */

export type NoulQ = { type: 'noul'; instructions: unknown; criteria?: unknown }
export type ChoiceQ = { type: 'choice'; instructions: unknown; criteria: Record<string, unknown> }
export type ScoreQ = { type: 'score'; instructions: unknown; criteria: unknown[] }
export type Question = NoulQ | ChoiceQ | ScoreQ

export type NoulA = { type: 'noul'; noul: number }
export type ChoiceA = { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
export type ScoreA = { type: 'score'; score: number; confidence: number; probabilities: number[] | Record<string, number> }
export type Answer = NoulA | ChoiceA | ScoreA

export const noul = (instructions: unknown, criteria?: unknown): NoulQ =>
  criteria === undefined ? { type: 'noul', instructions } : { type: 'noul', instructions, criteria }
export const choice = (instructions: unknown, criteria: Record<string, unknown>): ChoiceQ => ({ type: 'choice', instructions, criteria })
export const score = (instructions: unknown, criteria: unknown[]): ScoreQ => ({ type: 'score', instructions, criteria })

export type JevResult = {
  answers: Record<string, Answer>
  model: string
  usage: { input_tokens: number; output_tokens: number }
  ms: number
  cached: boolean
}

export class JevDown extends Error {
  constructor(message: string, readonly retryAfterMs: number | null = null) {
    super(message)
    this.name = 'JevDown'
  }
}

export class BudgetExhausted extends Error {
  constructor(readonly usd: number, readonly cap: number) {
    super(`Jev budget exhausted: spent $${usd.toFixed(4)} of a $${cap.toFixed(2)} cap`)
    this.name = 'BudgetExhausted'
  }
}

/** $ per million input tokens. Output tokens are free. docs.typesafe.ai/models */
export const JEV_USD_PER_MTOK = 0.042

export type JevConfig = {
  apiKey: string
  model: string
  baseUrl: string
  /** Hard stop. Null means no cap. */
  maxUsd: number | null
  timeoutMs: number
}

export class Jev {
  /** Same state + same questions = same answer. Jev is self-consistent, so a re-judged screen is free. */
  private cache = new Map<string, JevResult>()
  private order: string[] = []
  downUntil = 0
  private spent = 0

  constructor(
    private cfg: JevConfig,
    private db: DB | null,
    private log: (kind: string, msg: string) => void = () => undefined
  ) {
    if (db) this.spent = spend.byTier(db, 'jev').usd
  }

  up(): boolean {
    return Date.now() >= this.downUntil
  }

  usd(): number {
    return this.spent
  }

  budgetLeft(): number {
    return this.cfg.maxUsd === null ? Infinity : Math.max(0, this.cfg.maxUsd - this.spent)
  }

  async ask(worker: string, state: unknown, questions: Record<string, Question>): Promise<JevResult> {
    if (!Object.keys(questions).length) throw new Error('no questions')
    const body = { model: this.cfg.model, state, questions }
    const key = createHash('sha1').update(JSON.stringify(body)).digest('hex')
    const hit = this.cache.get(key)
    if (hit) return { ...hit, cached: true, ms: 0 }
    if (this.cfg.maxUsd !== null && this.spent >= this.cfg.maxUsd) throw new BudgetExhausted(this.spent, this.cfg.maxUsd)

    const t0 = Date.now()
    const raw = await this.post(body)
    const ms = Date.now() - t0
    const answers = validate(raw, questions)
    const usage = raw.usage ?? { input_tokens: 0, output_tokens: 0 }
    const usd = (usage.input_tokens * JEV_USD_PER_MTOK) / 1_000_000
    this.spent += usd
    if (this.db) {
      spend.record(this.db, {
        worker, tier: 'jev', provider: 'typesafe', model: String(raw.model ?? this.cfg.model),
        prompt_hash: key.slice(0, 16), in_tokens: usage.input_tokens, cached_in: 0, out_tokens: usage.output_tokens,
        ms, chose: null, repaired: 0, usd, prompt: null,
      })
    }
    const res: JevResult = { answers, model: String(raw.model ?? this.cfg.model), usage, ms, cached: false }
    this.remember(key, res)
    return res
  }

  private remember(key: string, res: JevResult): void {
    this.cache.set(key, res)
    this.order.push(key)
    if (this.order.length > 2000) this.cache.delete(this.order.shift()!)
  }

  private async post(body: unknown): Promise<RawResponse> {
    let lastErr = ''
    for (let attempt = 0; attempt < 4; attempt++) {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs)
      let res: Response
      try {
        res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/v1/systemone`, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.cfg.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctl.signal,
        })
      } catch (e) {
        clearTimeout(timer)
        lastErr = (e as Error).name === 'AbortError' ? `timed out after ${this.cfg.timeoutMs}ms` : (e as Error).message
        await sleep(400 * 2 ** attempt)
        continue
      }
      clearTimeout(timer)
      if (res.status === 429 || res.status === 503 || res.status === 529) {
        const ra = Number(res.headers.get('retry-after') ?? 0)
        const wait = ra > 0 ? ra * 1000 : 500 * 2 ** attempt
        lastErr = `HTTP ${res.status}`
        await sleep(wait)
        continue
      }
      if (res.status === 401 || res.status === 403) {
        this.downUntil = Date.now() + 3600_000
        throw new JevDown(`TypeSafe refused the API key (HTTP ${res.status}). Set TYPESAFE_API_KEY.`, 3600_000)
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`TypeSafe answered HTTP ${res.status}: ${text.slice(0, 300)}`)
      }
      this.downUntil = 0
      return (await res.json()) as RawResponse
    }
    this.downUntil = Date.now() + 30_000
    this.log('jev', `TypeSafe unreachable: ${lastErr}`)
    throw new JevDown(`TypeSafe unreachable: ${lastErr}`, 30_000)
  }
}

type RawResponse = {
  model?: string
  answers?: Record<string, Record<string, unknown>>
  usage?: { input_tokens: number; output_tokens: number }
}

/**
 * Ported from jev-ultrafast's validate_choice: a choice not in the offered
 * set, probabilities that do not sum to one, or an argmax that disagrees with
 * the choice is a refusal, never an action. Model output must never become a
 * selector.
 */
export function validate(raw: RawResponse, questions: Record<string, Question>): Record<string, Answer> {
  const out: Record<string, Answer> = {}
  const answers = raw.answers ?? {}
  for (const [id, q] of Object.entries(questions)) {
    const a = answers[id]
    if (!a) throw new Error(`Jev returned no answer for "${id}"`)
    if (q.type === 'noul') {
      const p = Number(a.noul)
      if (!unit(p)) throw new Error(`Jev answer for "${id}" is not a probability`)
      out[id] = { type: 'noul', noul: p }
    } else if (q.type === 'choice') {
      const ids = Object.keys(q.criteria)
      const probs = a.probabilities as Record<string, number> | undefined
      const pick = String(a.choice)
      const conf = Number(a.confidence)
      const ok =
        ids.includes(pick) &&
        probs !== undefined &&
        ids.every((k) => unit(Number(probs[k]))) &&
        Object.keys(probs).every((k) => ids.includes(k)) &&
        Math.abs(ids.reduce((s, k) => s + Number(probs[k]), 0) - 1) < 0.02 &&
        Number(probs[pick]) >= Math.max(...ids.map((k) => Number(probs[k]))) - 1e-6 &&
        unit(conf)
      if (!ok) throw new Error(`Jev answer for "${id}" is not a valid choice`)
      out[id] = { type: 'choice', choice: pick, confidence: conf, probabilities: probs }
    } else {
      const s = Number(a.score)
      const conf = Number(a.confidence)
      if (!Number.isFinite(s) || !unit(conf)) throw new Error(`Jev answer for "${id}" is not a valid score`)
      out[id] = { type: 'score', score: s, confidence: conf, probabilities: (a.probabilities as number[]) ?? [] }
    }
  }
  return out
}

const unit = (n: number): boolean => Number.isFinite(n) && n >= 0 && n <= 1
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export const asNoul = (a: Answer | undefined): number => (a && a.type === 'noul' ? a.noul : 0)
export const asChoice = (a: Answer | undefined): ChoiceA | null => (a && a.type === 'choice' ? a : null)
