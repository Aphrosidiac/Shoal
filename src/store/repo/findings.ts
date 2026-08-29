import type { DB } from '../db.js'
import { now } from '../db.js'

export type Kind = 'leak' | 'data-loss' | 'money' | 'race' | 'auth' | 'fault' | 'wrong' | 'slow' | 'noise'

export const RANK: Record<Kind, number> = {
  leak: 1, 'data-loss': 2, money: 3, race: 4, auth: 5, fault: 6, wrong: 7, slow: 8, noise: 9,
}

export type Finding = {
  id: number; fingerprint: string; kind: Kind; title: string; reach: number
  endpoint_id: number | null; app_version_id: number; repro_json: string
  attempts: number; reproduced: number; occurrences: number
  first_seen_at: number; last_seen_at: number; state: 'open' | 'fixed' | 'stale'
}

/**
 * Only replay/verdict.ts calls this. Agents may not, watchers may not.
 * The same bug seen nine hundred times increments a counter; it does not add
 * a row.
 */
export function record(
  db: DB,
  f: {
    fingerprint: string; kind: Kind; title: string; reach: number
    endpoint_id: number | null; app_version_id: number
    repro: unknown; attempts: number; reproduced: number
    recording_ids?: number[]
  }
): Finding {
  const t = now()
  const existing = db.prepare('SELECT * FROM findings WHERE fingerprint = ?').get(f.fingerprint) as Finding | undefined
  if (existing) {
    db.prepare(
      `UPDATE findings SET occurrences = occurrences + 1, last_seen_at = ?, state = 'open',
       attempts = ?, reproduced = ?, app_version_id = ?, repro_json = ? WHERE id = ?`
    ).run(t, f.attempts, f.reproduced, f.app_version_id, JSON.stringify(f.repro), existing.id)
    addEvents(db, existing.id, f.recording_ids ?? [], t)
    return db.prepare('SELECT * FROM findings WHERE id = ?').get(existing.id) as Finding
  }
  const info = db
    .prepare(
      `INSERT INTO findings
       (fingerprint, kind, title, reach, endpoint_id, app_version_id, repro_json, attempts, reproduced, occurrences, first_seen_at, last_seen_at, state)
       VALUES (?,?,?,?,?,?,?,?,?,1,?,?,'open')`
    )
    .run(f.fingerprint, f.kind, f.title, f.reach, f.endpoint_id, f.app_version_id, JSON.stringify(f.repro), f.attempts, f.reproduced, t, t)
  const id = Number(info.lastInsertRowid)
  addEvents(db, id, f.recording_ids ?? [], t)
  return db.prepare('SELECT * FROM findings WHERE id = ?').get(id) as Finding
}

function addEvents(db: DB, findingId: number, recordingIds: number[], t: number): void {
  const stmt = db.prepare('INSERT INTO finding_events (finding_id, recording_id, at) VALUES (?,?,?)')
  for (const r of recordingIds.slice(0, 8)) stmt.run(findingId, r, t)
}

export const all = (db: DB): Finding[] => db.prepare('SELECT * FROM findings').all() as Finding[]

export const byId = (db: DB, id: number): Finding | undefined =>
  db.prepare('SELECT * FROM findings WHERE id = ?').get(id) as Finding | undefined

export const byFingerprint = (db: DB, fp: string): Finding | undefined =>
  db.prepare('SELECT * FROM findings WHERE fingerprint = ?').get(fp) as Finding | undefined

/** Category, then reproduction ratio, then reachability. Nothing invented. */
export function ranked(db: DB): Finding[] {
  return all(db).sort((a, b) => {
    const r = (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9)
    if (r) return r
    const ra = a.attempts ? a.reproduced / a.attempts : 0
    const rb = b.attempts ? b.reproduced / b.attempts : 0
    if (rb !== ra) return rb - ra
    if (a.reach !== b.reach) return a.reach - b.reach
    return a.id - b.id
  })
}

/** A `fixed` finding is never deleted. */
export const setState = (db: DB, id: number, state: 'open' | 'fixed' | 'stale', appVersionId?: number): void => {
  db.prepare('UPDATE findings SET state = ?, last_seen_at = ?, app_version_id = COALESCE(?, app_version_id) WHERE id = ?')
    .run(state, now(), appVersionId ?? null, id)
}

export const eventsOf = (db: DB, id: number): number[] =>
  (db.prepare('SELECT recording_id FROM finding_events WHERE finding_id = ? AND recording_id IS NOT NULL ORDER BY id')
    .all(id) as Array<{ recording_id: number }>).map((r) => r.recording_id)

export const openCount = (db: DB): number =>
  (db.prepare("SELECT COUNT(*) c FROM findings WHERE state = 'open'").get() as { c: number }).c

/** The same failure seen again is a count, not a row. */
export function touch(db: DB, fingerprint: string, recordingId: number | null): boolean {
  const f = db.prepare('SELECT id FROM findings WHERE fingerprint = ?').get(fingerprint) as { id: number } | undefined
  if (!f) return false
  db.prepare('UPDATE findings SET occurrences = occurrences + 1, last_seen_at = ? WHERE id = ?').run(now(), f.id)
  if (recordingId) {
    const c = (db.prepare('SELECT COUNT(*) c FROM finding_events WHERE finding_id = ?').get(f.id) as { c: number }).c
    if (c < 8) db.prepare('INSERT INTO finding_events (finding_id, recording_id, at) VALUES (?,?,?)').run(f.id, recordingId, now())
  }
  return true
}
