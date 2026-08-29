import type { FastifyInstance } from 'fastify'
import { db, now } from '../db.js'
import { require_ } from '../auth.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default async function routes(app: FastifyInstance) {
  app.post('/api/invoices/:id/payments', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    const id = Number((req.params as { id: string }).id)
    const b = (req.body ?? {}) as { amount?: number | string; method?: string; reference?: string }
    const amount = Number(b.amount)
    if (!Number.isFinite(amount) || amount <= 0) return reply.code(400).send({ error: 'amount must be a positive number' })

    const inv = db.prepare('SELECT * FROM invoices WHERE id = ? AND user_id = ?').get(id, u.id) as
      | { id: number; total: number; paid_amt: number }
      | undefined
    if (!inv) return reply.code(404).send({ error: 'no such invoice' })

    // BUG 2: nothing checks the amount against what is still owed, so an
    // invoice for 100 will happily accept a payment of 5,000.

    // BUG 1: read, then think, then write. Two payments that overlap in this
    // window both read the same paid_amt and the second overwrites the first.
    const before = Number(inv.paid_amt)
    await pause(12)
    const after = before + amount
    db.prepare('UPDATE invoices SET paid_amt = ? WHERE id = ?').run(after, id)

    db.prepare('INSERT INTO payments (invoice_id, user_id, amount, method, reference, created_at) VALUES (?,?,?,?,?,?)')
      .run(id, u.id, amount, b.method ?? 'card', b.reference ?? null, now())

    const saved = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as { total: number; paid_amt: number }
    return reply.code(201).send({
      ok: true,
      invoice_id: id,
      amount,
      total: saved.total,
      paid_amt: saved.paid_amt,
      balance: Number(saved.total) - Number(saved.paid_amt),
    })
  })
}
