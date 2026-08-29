import type { DB } from '../db.js'
import { now } from '../db.js'

export type Run = {
  id: number
  app_url: string
  config_json: string
  tenancy: string | null
  started_at: number
  last_seen_at: number
  stopped_at: number | null
}

export function currentRun(db: DB, appUrl: string): Run | undefined {
  return db
    .prepare('SELECT * FROM runs WHERE app_url = ? ORDER BY id DESC LIMIT 1')
    .get(appUrl) as Run | undefined
}

export function startRun(db: DB, appUrl: string, config: unknown): Run {
  const existing = currentRun(db, appUrl)
  if (existing) {
    db.prepare('UPDATE runs SET stopped_at = NULL, last_seen_at = ?, config_json = ? WHERE id = ?')
      .run(now(), JSON.stringify(config), existing.id)
    return { ...existing, stopped_at: null, config_json: JSON.stringify(config) }
  }
  const t = now()
  const info = db
    .prepare('INSERT INTO runs (app_url, config_json, started_at, last_seen_at) VALUES (?,?,?,?)')
    .run(appUrl, JSON.stringify(config), t, t)
  return db.prepare('SELECT * FROM runs WHERE id = ?').get(Number(info.lastInsertRowid)) as Run
}

export const heartbeat = (db: DB, id: number): void => {
  db.prepare('UPDATE runs SET last_seen_at = ? WHERE id = ?').run(now(), id)
}

export const stopRun = (db: DB, id: number): void => {
  db.prepare('UPDATE runs SET stopped_at = ? WHERE id = ?').run(now(), id)
}

export const setTenancy = (db: DB, id: number, tenancy: 'unknown' | 'isolated' | 'shared'): void => {
  db.prepare('UPDATE runs SET tenancy = ? WHERE id = ?').run(tenancy, id)
}

export function appVersion(db: DB, fingerprint: string): { id: number; restarts: number } {
  const t = now()
  const row = db.prepare('SELECT id, restarts FROM app_versions WHERE fingerprint = ?').get(fingerprint) as
    | { id: number; restarts: number }
    | undefined
  if (row) {
    db.prepare('UPDATE app_versions SET last_seen_at = ? WHERE id = ?').run(t, row.id)
    return row
  }
  const info = db
    .prepare('INSERT INTO app_versions (fingerprint, first_seen_at, last_seen_at) VALUES (?,?,?)')
    .run(fingerprint, t, t)
  return { id: Number(info.lastInsertRowid), restarts: 0 }
}

export const noteRestart = (db: DB, id: number): void => {
  db.prepare('UPDATE app_versions SET restarts = restarts + 1 WHERE id = ?').run(id)
}

export function event(db: DB, kind: string, message: string): void {
  db.prepare('INSERT INTO events (at, kind, message) VALUES (?,?,?)').run(now(), kind, message)
}

export function events(db: DB, limit = 200): Array<{ at: number; kind: string; message: string }> {
  return db.prepare('SELECT at, kind, message FROM events ORDER BY id DESC LIMIT ?').all(limit) as Array<{
    at: number; kind: string; message: string
  }>
}
