import type { DB } from '../db.js'
import { now } from '../db.js'

export type Suspicion = {
  id: number; source: string; worker: string; recording_id: number | null
  expected: string; observed: string; note: string | null; state: string; created_at: number
}

/**
 * Agents write here and nowhere else. Nothing in this table is a bug yet, and
 * nothing in it reaches the report until replay has reproduced it.
 */
export function file(
  db: DB,
  s: { source: string; worker: string; recording_id: number | null; expected: string; observed: string; note?: string | null }
): number {
  const info = db
    .prepare('INSERT INTO suspicions (source, worker, recording_id, expected, observed, note, state, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(s.source, s.worker, s.recording_id, s.expected.slice(0, 2000), s.observed.slice(0, 2000), s.note ?? null, 'open', now())
  return Number(info.lastInsertRowid)
}

export const open = (db: DB, limit = 50): Suspicion[] =>
  db.prepare("SELECT * FROM suspicions WHERE state = 'open' ORDER BY id").all(limit ? limit : 50) as Suspicion[]

export const byId = (db: DB, id: number): Suspicion | undefined =>
  db.prepare('SELECT * FROM suspicions WHERE id = ?').get(id) as Suspicion | undefined

export const setState = (db: DB, id: number, state: 'open' | 'confirmed' | 'dismissed' | 'unreproduced'): void => {
  db.prepare('UPDATE suspicions SET state = ? WHERE id = ?').run(state, id)
}

export const all = (db: DB): Suspicion[] =>
  db.prepare('SELECT * FROM suspicions ORDER BY id DESC').all() as Suspicion[]

export const counts = (db: DB): Record<string, number> => {
  const rows = db.prepare('SELECT state, COUNT(*) c FROM suspicions GROUP BY state').all() as Array<{ state: string; c: number }>
  const out: Record<string, number> = {}
  for (const r of rows) out[r.state] = r.c
  return out
}
