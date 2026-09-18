import type { DB } from '../db.js'

export type StepRow = {
  id: number; at: number; worker: string; phase: string; account: string | null; goal: string | null
  path: string; url_pattern: string; kind: string | null
  action_json: string; decision_json: string | null; answers_json: string; verdicts_json: string; entered_json: string
  changed: number; tokens: number; ms: number; cached: number; shot: string | null; suspicion_ids: string; rewalk_of: number | null
}

export type NewStep = Omit<StepRow, 'id'>

export function record(db: DB, s: NewStep): number {
  const info = db
    .prepare(
      `INSERT INTO steps (at, worker, phase, account, goal, path, url_pattern, kind, action_json, decision_json, answers_json,
         verdicts_json, entered_json, changed, tokens, ms, cached, shot, suspicion_ids, rewalk_of)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      s.at, s.worker, s.phase, s.account, s.goal, s.path, s.url_pattern, s.kind, s.action_json, s.decision_json, s.answers_json,
      s.verdicts_json, s.entered_json, s.changed, s.tokens, s.ms, s.cached, s.shot, s.suspicion_ids, s.rewalk_of
    )
  return Number(info.lastInsertRowid)
}

export const setShot = (db: DB, id: number, shot: string): void => {
  db.prepare('UPDATE steps SET shot = ? WHERE id = ?').run(shot, id)
}

export const recent = (db: DB, limit = 60, before?: number): StepRow[] =>
  before
    ? (db.prepare('SELECT * FROM steps WHERE id < ? ORDER BY id DESC LIMIT ?').all(before, limit) as StepRow[])
    : (db.prepare('SELECT * FROM steps ORDER BY id DESC LIMIT ?').all(limit) as StepRow[])

export const byId = (db: DB, id: number): StepRow | undefined =>
  db.prepare('SELECT * FROM steps WHERE id = ?').get(id) as StepRow | undefined

export const count = (db: DB): number => (db.prepare('SELECT COUNT(*) c FROM steps').get() as { c: number }).c

export const stats = (db: DB): { steps: number; judgedMs: number; tokens: number; withVerdict: number; rewalks: number } => {
  const r = db
    .prepare(
      `SELECT COUNT(*) steps, COALESCE(SUM(tokens),0) tokens,
              COALESCE(SUM(CASE WHEN verdicts_json != '[]' THEN 1 ELSE 0 END),0) withVerdict,
              COALESCE(SUM(CASE WHEN phase = 'rewalk' THEN 1 ELSE 0 END),0) rewalks
       FROM steps`
    )
    .get() as { steps: number; tokens: number; withVerdict: number; rewalks: number }
  const med = db.prepare('SELECT ms FROM steps WHERE cached = 0 ORDER BY ms LIMIT 1 OFFSET (SELECT COUNT(*) / 2 FROM steps WHERE cached = 0)').get() as { ms: number } | undefined
  return { ...r, judgedMs: med?.ms ?? 0 }
}
