import type { DB } from '../db.js'
import { now } from '../db.js'

export type ModelCall = {
  worker: string; tier: string; provider: string; model: string
  prompt_hash: string; in_tokens: number; cached_in: number; out_tokens: number
  ms: number; chose: string | null; repaired: number; usd: number; prompt: string | null
}

export function record(db: DB, c: ModelCall): void {
  db.prepare(
    `INSERT INTO model_calls
     (at, worker, tier, provider, model, prompt_hash, in_tokens, cached_in, out_tokens, ms, chose, repaired, usd, prompt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    now(), c.worker, c.tier, c.provider, c.model, c.prompt_hash,
    c.in_tokens, c.cached_in, c.out_tokens, c.ms, c.chose, c.repaired, c.usd, c.prompt
  )
}

export type Spend = {
  calls: number; usd: number; in_tokens: number; cached_in: number; out_tokens: number; repaired: number
}

export function total(db: DB): Spend {
  const r = db
    .prepare(
      `SELECT COUNT(*) calls, COALESCE(SUM(usd),0) usd, COALESCE(SUM(in_tokens),0) in_tokens,
              COALESCE(SUM(cached_in),0) cached_in, COALESCE(SUM(out_tokens),0) out_tokens,
              COALESCE(SUM(repaired),0) repaired
       FROM model_calls`
    )
    .get() as Spend
  return r
}

export function sinceMs(db: DB, ms: number): Spend {
  return db
    .prepare(
      `SELECT COUNT(*) calls, COALESCE(SUM(usd),0) usd, COALESCE(SUM(in_tokens),0) in_tokens,
              COALESCE(SUM(cached_in),0) cached_in, COALESCE(SUM(out_tokens),0) out_tokens,
              COALESCE(SUM(repaired),0) repaired
       FROM model_calls WHERE at >= ?`
    )
    .get(now() - ms) as Spend
}

export const callsByTierSince = (db: DB, tier: string, ms: number): number =>
  (db.prepare('SELECT COUNT(*) c FROM model_calls WHERE tier = ? AND at >= ?').get(tier, now() - ms) as { c: number }).c
