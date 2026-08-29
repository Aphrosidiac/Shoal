import type { FastifyInstance } from 'fastify'
import { db } from '../db.js'
import { require_ } from '../auth.js'

export default async function routes(app: FastifyInstance) {
  app.get('/api/reports/summary', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    const q = req.query as { from?: string; to?: string }

    // BUG 6: a malformed date is never validated. `toISOString()` throws on an
    // invalid Date and the whole handler 500s instead of answering 400.
    const from = q.from ? new Date(q.from) : new Date(0)
    const to = q.to ? new Date(q.to) : new Date()
    const fromKey = Math.floor(from.getTime() / 1000)
    const toKey = Math.floor(to.getTime() / 1000)
    const label = `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`

    const orders = db
      .prepare('SELECT COUNT(*) c, COALESCE(SUM(qty * price), 0) v FROM orders WHERE user_id = ? AND created_at BETWEEN ? AND ?')
      .get(u.id, fromKey, toKey) as { c: number; v: number }
    const paid = db
      .prepare('SELECT COALESCE(SUM(amount), 0) v FROM payments WHERE user_id = ? AND created_at BETWEEN ? AND ?')
      .get(u.id, fromKey, toKey) as { v: number }

    return { range: label, orders: orders.c, order_value: orders.v, paid: paid.v }
  })
}
