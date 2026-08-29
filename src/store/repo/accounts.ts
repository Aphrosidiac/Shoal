import type { DB } from '../db.js'
import { now } from '../db.js'

export type Account = {
  id: number; email: string; password: string; display: string | null
  role: string | null; tenant_key: string | null; verified: number
  state: string; created_at: number
}

export function create(
  db: DB,
  a: { email: string; password: string; display?: string | null; role?: string | null }
): Account {
  const info = db
    .prepare('INSERT INTO accounts (email, password, display, role, verified, state, created_at) VALUES (?,?,?,?,0,?,?)')
    .run(a.email, a.password, a.display ?? null, a.role ?? null, 'ok', now())
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(info.lastInsertRowid)) as Account
}

export const all = (db: DB): Account[] =>
  db.prepare('SELECT * FROM accounts ORDER BY id').all() as Account[]

export const usable = (db: DB): Account[] =>
  db.prepare("SELECT * FROM accounts WHERE state = 'ok' ORDER BY id").all() as Account[]

export const byId = (db: DB, id: number): Account | undefined =>
  db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Account | undefined

export const markVerified = (db: DB, id: number): void => {
  db.prepare('UPDATE accounts SET verified = 1 WHERE id = ?').run(id)
}

/** On a 401 mid-run we re-login once, then give up on the account. */
export const markBroken = (db: DB, id: number, why: string): void => {
  db.prepare("UPDATE accounts SET state = ? WHERE id = ?").run('broken:' + why.slice(0, 60), id)
}

export const setRole = (db: DB, id: number, role: string): void => {
  db.prepare('UPDATE accounts SET role = ? WHERE id = ?').run(role, id)
}

export const setTenantKey = (db: DB, id: number, key: string): void => {
  db.prepare('UPDATE accounts SET tenant_key = ? WHERE id = ?').run(key, id)
}
