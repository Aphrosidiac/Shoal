import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type DB = Database.Database

const here = dirname(fileURLToPath(import.meta.url))

function schemaSql(): string {
  for (const p of [join(here, 'schema.sql'), resolve(here, '../../src/store/schema.sql')]) {
    if (existsSync(p)) return readFileSync(p, 'utf8')
  }
  throw new Error('store/schema.sql is missing. Reinstall shoal.')
}

/** Everything Shoal writes lives here, so deleting it removes Shoal. */
export function shoalDir(dir: string): string {
  const d = resolve(dir, '.shoal')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

let opened: DB | null = null

export function open(dir: string): DB {
  if (opened) return opened
  const db = new Database(join(shoalDir(dir), 'run.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
  db.exec(schemaSql())
  migrate(db)
  opened = db
  return db
}

/** A second process reading the same file while a run is going. */
export function openReadOnly(dir: string): DB {
  const file = join(shoalDir(dir), 'run.db')
  if (!existsSync(file)) throw new Error(`No run in ${resolve(dir)}. Start one with: shoal run <url>`)
  const db = new Database(file, { readonly: true })
  db.pragma('busy_timeout = 5000')
  return db
}

export function close(): void {
  if (opened) {
    try { opened.close() } catch { /* already gone */ }
    opened = null
  }
}

export const now = (): number => Date.now()

/**
 * Versioned migrations. schema.sql is idempotent and creates the current
 * shape; these only exist to move a file written by an older Shoal.
 */
const MIGRATIONS: Array<{ v: number; sql: string }> = [
  { v: 2, sql: "ALTER TABLE pages ADD COLUMN example_url TEXT" },
]

function migrate(db: DB): void {
  const v = (db.pragma('user_version', { simple: true }) as number) ?? 0
  for (const m of MIGRATIONS) {
    if (m.v <= v) continue
    try {
      db.exec(m.sql)
    } catch (e) {
      // schema.sql already creates the current shape, so a migration that
      // duplicates it is a no-op rather than a failure.
      if (!/duplicate column/i.test(String((e as Error).message))) throw e
    }
    db.pragma(`user_version = ${m.v}`)
  }
  const top = MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1]!.v : 1
  if (v < top) db.pragma(`user_version = ${top}`)
}
