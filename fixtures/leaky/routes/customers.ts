import type { FastifyInstance } from 'fastify'
import { db, now } from '../db.js'
import { require_ } from '../auth.js'

type Body = { name?: string; email?: string; phone?: string; notes?: string }

export default async function routes(app: FastifyInstance) {
  app.get('/api/customers', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    return db
      .prepare('SELECT * FROM customers WHERE user_id = ? ORDER BY id DESC LIMIT 200')
      .all(u.id)
  })

  app.post('/api/customers', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    const b = (req.body ?? {}) as Body
    // NOT A BUG: correctly rejects bad input with a 400.
    if (!b.name || b.name.trim().length === 0) return reply.code(400).send({ error: 'name is required' })
    if (b.email && !b.email.includes('@')) return reply.code(400).send({ error: 'email is not valid' })
    const info = db
      .prepare('INSERT INTO customers (user_id, name, email, phone, notes, created_at) VALUES (?,?,?,?,?,?)')
      .run(u.id, b.name.trim(), b.email ?? null, b.phone ?? null, b.notes ?? null, now())
    return reply.code(201).send(db.prepare('SELECT * FROM customers WHERE id = ?').get(Number(info.lastInsertRowid)))
  })

  app.get('/api/customers/:id', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    const id = Number((req.params as { id: string }).id)
    const row = db.prepare('SELECT * FROM customers WHERE id = ? AND user_id = ?').get(id, u.id)
    if (!row) return reply.code(404).send({ error: 'no such customer' })
    return row
  })

  app.patch('/api/customers/:id', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    const id = Number((req.params as { id: string }).id)
    const b = (req.body ?? {}) as Body
    const row = db.prepare('SELECT * FROM customers WHERE id = ? AND user_id = ?').get(id, u.id) as
      | Record<string, unknown>
      | undefined
    if (!row) return reply.code(404).send({ error: 'no such customer' })
    // NOT A BUG: correctly rejects bad input with a 400.
    if (b.email !== undefined && b.email !== null && b.email !== '' && !b.email.includes('@')) {
      return reply.code(400).send({ error: 'email is not valid' })
    }

    // BUG 5: `phone` is read off the body and echoed back in the response, but
    // it is never written. The update statement forgot the column.
    db.prepare('UPDATE customers SET name = COALESCE(?, name), email = COALESCE(?, email), notes = COALESCE(?, notes) WHERE id = ?')
      .run(b.name ?? null, b.email ?? null, b.notes ?? null, id)

    const saved = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Record<string, unknown>
    return { ...saved, ...(b.phone !== undefined ? { phone: b.phone } : {}) }
  })
}
