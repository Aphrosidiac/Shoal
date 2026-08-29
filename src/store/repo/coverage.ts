import type { DB } from '../db.js'
import { now } from '../db.js'

export function bump(db: DB, key: string, by = 1): void {
  db.prepare(
    `INSERT INTO coverage (key, value, updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = value + excluded.value, updated_at = excluded.updated_at`
  ).run(key, by, now())
}

export function set(db: DB, key: string, value: number): void {
  db.prepare(
    `INSERT INTO coverage (key, value, updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, now())
}

export const get = (db: DB, key: string): number =>
  ((db.prepare('SELECT value FROM coverage WHERE key = ?').get(key) as { value: number } | undefined)?.value ?? 0)

export function snapshot(db: DB): Record<string, number> {
  const rows = db.prepare('SELECT key, value FROM coverage').all() as Array<{ key: string; value: number }>
  const out: Record<string, number> = {}
  for (const r of rows) out[r.key] = r.value
  return out
}
