import type { DB } from '../db.js'
import { now } from '../db.js'

export type Page = {
  id: number; url_pattern: string; title: string | null; screen_fp: string
  example_url: string | null
  requires_auth: number; visits: number; explored: number
  first_seen_at: number; last_seen_at: number
}
export type Endpoint = {
  id: number; method: string; path_pattern: string; writes: number; calls: number
  statuses_json: string; hammered: number; readback_id: number | null; first_seen_at: number
}
export type Form = { id: number; page_id: number; name: string | null; endpoint_id: number | null }
export type Field = { id: number; form_id: number; name: string; type: string | null; required: number; tried_json: string }

export function upsertPage(
  db: DB,
  p: { url_pattern: string; title?: string | null; screen_fp: string; requires_auth?: boolean; example_url?: string }
): Page {
  const t = now()
  const existing = db.prepare('SELECT * FROM pages WHERE screen_fp = ?').get(p.screen_fp) as Page | undefined
  if (existing) {
    // A screen seen once without a session is a public screen, whatever it
    // looks like the rest of the time. So this only ever ratchets down.
    const auth = existing.requires_auth === 1 && p.requires_auth !== false ? 1 : 0
    db.prepare(
      'UPDATE pages SET visits = visits + 1, last_seen_at = ?, title = COALESCE(?, title), example_url = COALESCE(example_url, ?), requires_auth = ? WHERE id = ?'
    ).run(t, p.title ?? null, p.example_url ?? null, auth, existing.id)
    return { ...existing, visits: existing.visits + 1, last_seen_at: t, requires_auth: auth, example_url: existing.example_url ?? p.example_url ?? null }
  }
  const info = db
    .prepare(
      'INSERT INTO pages (url_pattern, title, screen_fp, example_url, requires_auth, visits, explored, first_seen_at, last_seen_at) VALUES (?,?,?,?,?,1,0,?,?)'
    )
    .run(p.url_pattern, p.title ?? null, p.screen_fp, p.example_url ?? null, p.requires_auth === false ? 0 : 1, t, t)
  return db.prepare('SELECT * FROM pages WHERE id = ?').get(Number(info.lastInsertRowid)) as Page
}

export const markExplored = (db: DB, pageId: number): void => {
  db.prepare('UPDATE pages SET explored = 1 WHERE id = ?').run(pageId)
}

export const pages = (db: DB): Page[] =>
  db.prepare('SELECT * FROM pages ORDER BY explored ASC, visits ASC, id ASC').all() as Page[]

export const pageByFp = (db: DB, fp: string): Page | undefined =>
  db.prepare('SELECT * FROM pages WHERE screen_fp = ?').get(fp) as Page | undefined

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function upsertEndpoint(db: DB, method: string, pathPattern: string, status?: number): Endpoint {
  const m = method.toUpperCase()
  let row = db.prepare('SELECT * FROM endpoints WHERE method = ? AND path_pattern = ?').get(m, pathPattern) as
    | Endpoint
    | undefined
  if (!row) {
    db.prepare(
      'INSERT OR IGNORE INTO endpoints (method, path_pattern, writes, calls, statuses_json, first_seen_at) VALUES (?,?,?,0,?,?)'
    ).run(m, pathPattern, WRITE.has(m) ? 1 : 0, '{}', now())
    row = db.prepare('SELECT * FROM endpoints WHERE method = ? AND path_pattern = ?').get(m, pathPattern) as Endpoint
  }
  const statuses = JSON.parse(row.statuses_json) as Record<string, number>
  if (status !== undefined) statuses[String(status)] = (statuses[String(status)] ?? 0) + 1
  db.prepare('UPDATE endpoints SET calls = calls + 1, statuses_json = ? WHERE id = ?')
    .run(JSON.stringify(statuses), row.id)
  return { ...row, calls: row.calls + 1, statuses_json: JSON.stringify(statuses) }
}

export const endpoints = (db: DB): Endpoint[] =>
  db.prepare('SELECT * FROM endpoints ORDER BY hammered ASC, calls ASC, id ASC').all() as Endpoint[]

export const endpointById = (db: DB, id: number): Endpoint | undefined =>
  db.prepare('SELECT * FROM endpoints WHERE id = ?').get(id) as Endpoint | undefined

export const setReadback = (db: DB, writeId: number, readId: number): void => {
  db.prepare('UPDATE endpoints SET readback_id = ? WHERE id = ? AND readback_id IS NULL').run(readId, writeId)
}

export const markHammered = (db: DB, id: number): void => {
  db.prepare('UPDATE endpoints SET hammered = hammered + 1 WHERE id = ?').run(id)
}

export function upsertForm(
  db: DB,
  f: { page_id: number; name: string | null; endpoint_id?: number | null }
): Form {
  const row = db.prepare("SELECT * FROM forms WHERE page_id = ? AND IFNULL(name, '') = IFNULL(?, '')")
    .get(f.page_id, f.name) as Form | undefined
  if (row) {
    if (f.endpoint_id && !row.endpoint_id) {
      db.prepare('UPDATE forms SET endpoint_id = ? WHERE id = ?').run(f.endpoint_id, row.id)
    }
    return row
  }
  const info = db.prepare('INSERT INTO forms (page_id, name, endpoint_id) VALUES (?,?,?)')
    .run(f.page_id, f.name, f.endpoint_id ?? null)
  return db.prepare('SELECT * FROM forms WHERE id = ?').get(Number(info.lastInsertRowid)) as Form
}

export function upsertField(
  db: DB,
  f: { form_id: number; name: string; type: string | null; required: boolean }
): Field {
  const row = db.prepare('SELECT * FROM fields WHERE form_id = ? AND name = ?').get(f.form_id, f.name) as
    | Field
    | undefined
  if (row) return row
  const info = db.prepare('INSERT INTO fields (form_id, name, type, required, tried_json) VALUES (?,?,?,?,?)')
    .run(f.form_id, f.name, f.type, f.required ? 1 : 0, '[]')
  return db.prepare('SELECT * FROM fields WHERE id = ?').get(Number(info.lastInsertRowid)) as Field
}

export function markTried(db: DB, fieldId: number, valueClass: string): void {
  const row = db.prepare('SELECT tried_json FROM fields WHERE id = ?').get(fieldId) as { tried_json: string } | undefined
  if (!row) return
  const tried = new Set(JSON.parse(row.tried_json) as string[])
  tried.add(valueClass)
  db.prepare('UPDATE fields SET tried_json = ? WHERE id = ?').run(JSON.stringify([...tried]), fieldId)
}

export const forms = (db: DB): Form[] => db.prepare('SELECT * FROM forms ORDER BY id').all() as Form[]
export const fieldsOf = (db: DB, formId: number): Field[] =>
  db.prepare('SELECT * FROM fields WHERE form_id = ? ORDER BY id').all(formId) as Field[]
export const formsOnPage = (db: DB, pageId: number): Form[] =>
  db.prepare('SELECT * FROM forms WHERE page_id = ?').all(pageId) as Form[]

export function addElement(
  db: DB,
  e: { page_id: number; role: string; name: string | null; selector: string | null; kind: string | null }
): number {
  const row = db.prepare("SELECT id FROM elements WHERE page_id = ? AND role = ? AND IFNULL(name,'') = IFNULL(?,'')")
    .get(e.page_id, e.role, e.name) as { id: number } | undefined
  if (row) return row.id
  const info = db.prepare('INSERT INTO elements (page_id, role, name, selector, kind) VALUES (?,?,?,?,?)')
    .run(e.page_id, e.role, e.name, e.selector, e.kind)
  return Number(info.lastInsertRowid)
}

export function addEdge(db: DB, fromPageId: number, toPageId: number, elementId: number | null): void {
  const row = db
    .prepare('SELECT id FROM edges WHERE from_page_id = ? AND to_page_id = ? AND IFNULL(element_id,0) = IFNULL(?,0)')
    .get(fromPageId, toPageId, elementId) as { id: number } | undefined
  if (row) {
    db.prepare('UPDATE edges SET taken = taken + 1 WHERE id = ?').run(row.id)
    return
  }
  db.prepare('INSERT INTO edges (from_page_id, to_page_id, element_id, taken) VALUES (?,?,?,1)')
    .run(fromPageId, toPageId, elementId)
}

export const edgesFrom = (db: DB, pageId: number): Array<{ to_page_id: number; element_id: number | null; taken: number }> =>
  db.prepare('SELECT to_page_id, element_id, taken FROM edges WHERE from_page_id = ?').all(pageId) as Array<{
    to_page_id: number; element_id: number | null; taken: number
  }>
