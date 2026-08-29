import type { FastifyInstance } from 'fastify'
import { db, now, rid } from '../db.js'
import { require_ } from '../auth.js'

type Body = { customer_id?: number; qty?: number; price?: number; notes?: string; ref?: string }

/** Deliberately quadratic. Only bites once there is real data. */
function lev(a: string, b: string): number {
  const m = a.length, n = b.length
  let prev = new Array<number>(n + 1)
  let cur = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost)
    }
    const t = prev; prev = cur; cur = t
  }
  return prev[n]!
}

export default async function routes(app: FastifyInstance) {
  app.get('/api/orders', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    const q = req.query as { page?: string; limit?: string }
    const page = Math.max(1, Number(q.page ?? 1) || 1)
    // BUG 10: `limit` is not capped, and when the table gets big the handler
    // does a similarity pass over every row it returns. Fast on an empty
    // database, slow past a few hundred orders.
    const limit = Number(q.limit ?? 20) || 20
    // BUG 4: the sort key is created_at, a second-resolution integer that is
    // not unique, and the offset arithmetic skips a row at every page boundary
    // after the first. Walking the list end to end never returns some rows.
    const offset = page === 1 ? 0 : (page - 1) * limit + 1
    const rows = db
      .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(u.id, limit, offset) as Array<Record<string, unknown>>

    const total = (db.prepare('SELECT COUNT(*) c FROM orders WHERE user_id = ?').get(u.id) as { c: number }).c
    if (total > 300) {
      const all = db.prepare('SELECT ref, notes FROM orders WHERE user_id = ?').all(u.id) as Array<{ ref: string; notes: string | null }>
      for (const r of rows) {
        let near = 0
        for (const o of all) if (lev(String(r.notes ?? r.ref), String(o.notes ?? o.ref)) < 4) near++
        r.similar = near
      }
    }
    return { page, limit, total, rows }
  })

  app.post('/api/orders', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    const b = (req.body ?? {}) as Body
    const qty = Number(b.qty ?? 1)
    const price = Number(b.price ?? 0)
    if (!Number.isFinite(qty) || !Number.isFinite(price)) return reply.code(400).send({ error: 'qty and price must be numbers' })

    // BUG 8: the client sends an Idempotency-Key and the server ignores it
    // completely, so a double submit creates two orders.
    const info = db
      .prepare('INSERT INTO orders (user_id, customer_id, ref, qty, price, notes, idem_key, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(
        u.id,
        b.customer_id ?? null,
        b.ref ?? 'ORD-' + rid(6).toUpperCase(),
        qty,
        price,
        b.notes ?? 'order placed by ' + u.email,
        (req.headers['idempotency-key'] as string) ?? null,
        now()
      )
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(info.lastInsertRowid)) as Record<string, unknown>

    // every order gets an invoice, which is what gives payments something to hit
    db.prepare('INSERT INTO invoices (user_id, order_id, ref, total, paid_amt, status, created_at) VALUES (?,?,?,?,0,?,?)')
      .run(u.id, order.id, 'INV-' + rid(6).toUpperCase(), qty * price, 'UNPAID', now())

    return reply.code(201).send(order)
  })

  app.get('/api/orders/:id', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    const id = Number((req.params as { id: string }).id)
    // BUG 3: no `AND user_id = ?`. Any authenticated user can read any order.
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id)
    if (!row) return reply.code(404).send({ error: 'no such order' })
    return row
  })

  app.delete('/api/orders/:id', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    const id = Number((req.params as { id: string }).id)
    const row = db.prepare('SELECT id FROM orders WHERE id = ? AND user_id = ?').get(id, u.id)
    if (!row) return reply.code(404).send({ error: 'no such order' })
    db.prepare('DELETE FROM invoices WHERE order_id = ?').run(id)
    db.prepare('DELETE FROM orders WHERE id = ?').run(id)
    return { ok: true }
  })
}
