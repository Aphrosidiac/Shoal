/**
 * Postgres: reset between voyages, and evaluate soundings.
 *
 * Reset is a TEMPLATE clone rather than a truncate-and-reseed. Seeding BBF
 * takes seconds and a voyage wants to start dozens of times; cloning a
 * template is a file copy and takes about a fifth of a second. It also
 * guarantees the starting state is byte-identical every run, which a reseed
 * does not — a seed script that calls `new Date()` gives every voyage a
 * slightly different world to explore.
 */
import { Client } from 'pg'

export function dbUrl(base: string, database: string) {
  const u = new URL(base.replace(/\?schema=.*$/, ''))
  u.pathname = `/${database}`
  return u.toString()
}

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url })
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

/** Cut every other connection to `db` so it can be dropped or cloned. */
async function evict(admin: Client, db: string) {
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [db],
  )
}

/**
 * Build the template once from the app's own seeded database.
 *
 * Postgres refuses to use a database as a template while anything is connected
 * to it, which includes a dev server someone forgot to stop. That is the most
 * common reason this step fails, so it says so rather than surfacing the raw
 * error.
 */
export async function ensureTemplate(baseUrl: string, sourceDb: string, templateDb: string, force = false) {
  await withClient(dbUrl(baseUrl, 'postgres'), async (admin) => {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [templateDb])
    if (rows.length && !force) return
    if (rows.length) {
      await evict(admin, templateDb)
      await admin.query(`DROP DATABASE ${quote(templateDb)}`)
    }
    await evict(admin, sourceDb)
    try {
      await admin.query(`CREATE DATABASE ${quote(templateDb)} TEMPLATE ${quote(sourceDb)}`)
    } catch (e: any) {
      if (/being accessed by other users/.test(e.message ?? '')) {
        throw new Error(
          `Cannot clone ${sourceDb}: something is still connected to it. Stop the target's dev server ` +
            `(and prisma studio) and run again.`,
        )
      }
      throw e
    }
  })
}

/** Drop the working database and re-clone it. Roughly 200ms on BBF. */
export async function resetWorkDb(baseUrl: string, workDb: string, templateDb: string) {
  await withClient(dbUrl(baseUrl, 'postgres'), async (admin) => {
    await evict(admin, workDb)
    await admin.query(`DROP DATABASE IF EXISTS ${quote(workDb)}`)
    await admin.query(`CREATE DATABASE ${quote(workDb)} TEMPLATE ${quote(templateDb)}`)
  })
}

const quote = (id: string) => `"${id.replace(/"/g, '""')}"`

/** A connection held open across the voyage, so a sweep is not a reconnect. */
export class Soundings {
  private client: Client
  constructor(url: string) {
    this.client = new Client({ connectionString: url })
    // A dropped database terminates this connection from the server side. pg
    // emits that as an 'error' event, and an unhandled one takes the process
    // down — which is how the first shrinker run died, several minutes into a
    // reduction, with a Postgres stack trace that said nothing about Shoal.
    this.client.on('error', () => {})
  }
  async open() {
    await this.client.connect()
  }
  async close() {
    await this.client.end().catch(() => {})
  }
  /** Runs one check. Rows returned are violations; none is a pass. */
  async take(sql: string): Promise<any[]> {
    const r = await this.client.query(sql)
    return r.rows
  }
}
