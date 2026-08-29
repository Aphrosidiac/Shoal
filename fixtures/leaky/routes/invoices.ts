import type { FastifyInstance } from 'fastify'
import { db } from '../db.js'
import { require_ } from '../auth.js'

function derive(total: number, paid: number): string {
  if (paid <= 0) return 'UNPAID'
  if (paid >= total) return 'PAID'
  return 'PARTIAL'
}

export default async function routes(app: FastifyInstance) {
  app.get('/api/invoices', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    const q = req.query as { page?: string; limit?: string }
    const page = Math.max(1, Number(q.page ?? 1) || 1)
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 20) || 20))
    // NOT A BUG: paged on a stable unique key. Walking every page of this list
    // returns every row exactly once.
    const rows = db
      .prepare('SELECT * FROM invoices WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
      .all(u.id, limit, (page - 1) * limit) as Array<Record<string, unknown>>
    const total = (db.prepare('SELECT COUNT(*) c FROM invoices WHERE user_id = ?').get(u.id) as { c: number }).c
    // BUG 7 (half of it): the list derives status from the figures...
    for (const r of rows) r.status = derive(Number(r.total), Number(r.paid_amt))
    return { page, limit, total, rows }
  })

  app.get('/api/invoices/:id', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    const id = Number((req.params as { id: string }).id)
    // NOT A BUG: correctly scoped to the account. Another account gets a 404.
    const row = db.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?').get(id, u.id) as
      | Record<string, unknown>
      | undefined
    if (!row) return reply.code(404).send({ error: 'no such invoice' })
    // BUG 7 (the other half): the detail route returns the stored column.
    // Whatever POST /status last wrote is what you see here, so the two reads
    // of the same invoice can disagree.
    row.balance = Number(row.total) - Number(row.paid_amt)
    return row
  })

  app.get('/api/invoices/:id/payments', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    const id = Number((req.params as { id: string }).id)
    const inv = db.prepare('SELECT id FROM invoices WHERE id = ? AND user_id = ?').get(id, u.id)
    if (!inv) return reply.code(404).send({ error: 'no such invoice' })
    const rows = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY id').all(id) as Array<{ amount: number }>
    return { rows, count: rows.length, sum: rows.reduce((a, r) => a + Number(r.amount), 0) }
  })

  app.post('/api/invoices/:id/status', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    const id = Number((req.params as { id: string }).id)
    const b = (req.body ?? {}) as { status?: string }
    const status = (b.status ?? '').toUpperCase()
    if (!['UNPAID', 'PARTIAL', 'PAID', 'VOID'].includes(status)) {
      return reply.code(400).send({ error: 'status must be UNPAID, PARTIAL, PAID or VOID' })
    }
    const row = db.prepare('SELECT id FROM invoices WHERE id = ? AND user_id = ?').get(id, u.id)
    if (!row) return reply.code(404).send({ error: 'no such invoice' })
    // BUG 7: writes the column directly, with no regard for the figures the
    // list endpoint derives its own answer from.
    db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, id)
    return db.prepare('SELECT * FROM invoices WHERE id = ?').get(id)
  })
}
