import type { DB } from '../db.js'
import { now } from '../db.js'

export type Kind = 'explore' | 'form' | 'mission' | 'hammer' | 'confirm' | 'crossaccount'

export type Item = {
  id: number
  kind: Kind
  payload_json: string
  score: number
  state: 'ready' | 'leased' | 'done' | 'failed'
  leased_by: string | null
  leased_until: number | null
  attempts: number
  parent_id: number | null
  dedupe_key: string | null
  created_at: number
  done_at: number | null
}

export function push(
  db: DB,
  item: { kind: Kind; payload: unknown; score: number; dedupeKey: string; parentId?: number | null }
): number | null {
  const existing = db.prepare('SELECT id FROM queue WHERE dedupe_key = ?').get(item.dedupeKey) as { id: number } | undefined
  if (existing) return null
  const info = db
    .prepare('INSERT INTO queue (kind, payload_json, score, state, attempts, parent_id, dedupe_key, created_at) VALUES (?,?,?,?,0,?,?,?)')
    .run(item.kind, JSON.stringify(item.payload), item.score, 'ready', item.parentId ?? null, item.dedupeKey, now())
  return Number(info.lastInsertRowid)
}

/**
 * Pulling an item leases it for a few minutes. A worker that dies loses one
 * item; the lease expires and it comes back. That is the whole crash story.
 */
export function lease(db: DB, worker: string, kinds: Kind[], forMs = 5 * 60_000): Item | null {
  const t = now()
  const placeholders = kinds.map(() => '?').join(',')
  const take = db.transaction((): Item | null => {
    const row = db
      .prepare(
        `SELECT * FROM queue
         WHERE kind IN (${placeholders})
           AND (state = 'ready' OR (state = 'leased' AND leased_until < ?))
         ORDER BY score DESC, id ASC LIMIT 1`
      )
      .get(...kinds, t) as Item | undefined
    if (!row) return null
    db.prepare("UPDATE queue SET state = 'leased', leased_by = ?, leased_until = ?, attempts = attempts + 1 WHERE id = ?")
      .run(worker, t + forMs, row.id)
    return { ...row, state: 'leased', leased_by: worker, leased_until: t + forMs, attempts: row.attempts + 1 }
  })
  return take()
}

export const done = (db: DB, id: number): void => {
  db.prepare("UPDATE queue SET state = 'done', done_at = ? WHERE id = ?").run(now(), id)
}

/** Three attempts, then failed. Failures are not silent. */
export function failed(db: DB, id: number, maxAttempts = 3): 'retry' | 'gaveup' {
  const row = db.prepare('SELECT attempts FROM queue WHERE id = ?').get(id) as { attempts: number } | undefined
  if (!row) return 'gaveup'
  if (row.attempts >= maxAttempts) {
    db.prepare("UPDATE queue SET state = 'failed', done_at = ? WHERE id = ?").run(now(), id)
    return 'gaveup'
  }
  // back off by pushing the score down and freeing the lease
  db.prepare("UPDATE queue SET state = 'ready', leased_by = NULL, leased_until = NULL, score = score * 0.6 WHERE id = ?").run(id)
  return 'retry'
}

export const reprice = (db: DB, id: number, score: number): void => {
  db.prepare('UPDATE queue SET score = ? WHERE id = ?').run(score, id)
}

export const ready = (db: DB): Item[] =>
  db.prepare("SELECT * FROM queue WHERE state = 'ready' ORDER BY score DESC").all() as Item[]

export function counts(db: DB): Record<string, number> {
  const rows = db.prepare("SELECT kind, state, COUNT(*) c FROM queue GROUP BY kind, state").all() as Array<{
    kind: string; state: string; c: number
  }>
  const out: Record<string, number> = {}
  for (const r of rows) {
    out[`${r.kind}.${r.state}`] = r.c
    out[r.state] = (out[r.state] ?? 0) + r.c
  }
  return out
}

/** The frontier: everything still waiting. */
export const frontier = (db: DB): number =>
  (db.prepare("SELECT COUNT(*) c FROM queue WHERE state IN ('ready','leased')").get() as { c: number }).c

export function frontierByKind(db: DB): Record<string, number> {
  const rows = db
    .prepare("SELECT kind, COUNT(*) c FROM queue WHERE state IN ('ready','leased') GROUP BY kind")
    .all() as Array<{ kind: string; c: number }>
  const out: Record<string, number> = {}
  for (const r of rows) out[r.kind] = r.c
  return out
}

/** Leases that outlived their worker come back on the next pull anyway; this
 *  just makes the dashboard honest about it. */
export function reapExpired(db: DB): number {
  const info = db
    .prepare("UPDATE queue SET state = 'ready', leased_by = NULL WHERE state = 'leased' AND leased_until < ?")
    .run(now())
  return info.changes
}
