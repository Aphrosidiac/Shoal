import type { DB } from '../db.js'

export type Recording = {
  id: number; run_id: number; app_version_id: number
  account_id: number | null; page_id: number | null; endpoint_id: number | null
  worker: string; method: string; url: string
  req_headers: string | null; req_body: string | null
  status: number | null; res_headers: string | null; res_body: string | null
  started_at: number; ms: number; action_fp: string; wave_id: string | null
}

export type NewRecording = Omit<Recording, 'id'>

export function insert(db: DB, r: NewRecording): number {
  const info = db
    .prepare(
      `INSERT INTO recordings
       (run_id, app_version_id, account_id, page_id, endpoint_id, worker, method, url,
        req_headers, req_body, status, res_headers, res_body, started_at, ms, action_fp, wave_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      r.run_id, r.app_version_id, r.account_id, r.page_id, r.endpoint_id, r.worker, r.method, r.url,
      r.req_headers, r.req_body, r.status, r.res_headers, r.res_body, r.started_at, r.ms, r.action_fp, r.wave_id
    )
  return Number(info.lastInsertRowid)
}

export const byId = (db: DB, id: number): Recording | undefined =>
  db.prepare('SELECT * FROM recordings WHERE id = ?').get(id) as Recording | undefined

export const recent = (db: DB, limit = 50): Recording[] =>
  db.prepare('SELECT * FROM recordings ORDER BY id DESC LIMIT ?').all(limit) as Recording[]

export const byWave = (db: DB, waveId: string): Recording[] =>
  db.prepare('SELECT * FROM recordings WHERE wave_id = ? ORDER BY started_at').all(waveId) as Recording[]

export const forEndpoint = (db: DB, endpointId: number, limit = 20): Recording[] =>
  db.prepare('SELECT * FROM recordings WHERE endpoint_id = ? ORDER BY id DESC LIMIT ?')
    .all(endpointId, limit) as Recording[]

/** The most recent successful call of an action, for replay to start from. */
export const lastGood = (db: DB, actionFp: string): Recording | undefined =>
  db.prepare('SELECT * FROM recordings WHERE action_fp = ? AND status >= 200 AND status < 300 ORDER BY id DESC LIMIT 1')
    .get(actionFp) as Recording | undefined

export const count = (db: DB): number =>
  (db.prepare('SELECT COUNT(*) c FROM recordings').get() as { c: number }).c

/** Success rate per action fingerprint. Feeds the starvation guard. */
export function actionStats(db: DB): Array<{ action_fp: string; tries: number; ok: number; statuses: string }> {
  return db
    .prepare(
      `SELECT action_fp,
              COUNT(*) tries,
              SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) ok,
              GROUP_CONCAT(DISTINCT status) statuses
       FROM recordings
       WHERE endpoint_id IS NOT NULL
       GROUP BY action_fp`
    )
    .all() as Array<{ action_fp: string; tries: number; ok: number; statuses: string }>
}
