import type { FastifyInstance } from 'fastify'
import { db, now } from '../db.js'
import { require_ } from '../auth.js'

export default async function routes(app: FastifyInstance) {
  app.get('/api/slots', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    return db.prepare('SELECT * FROM slots ORDER BY id').all()
  })

  app.get('/api/deliveries', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    return db.prepare('SELECT * FROM deliveries WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(u.id)
  })

  app.post('/api/deliveries', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    const b = (req.body ?? {}) as { slot?: string; address?: string }
    const slot = (b.slot ?? '').trim()
    if (!slot) return reply.code(400).send({ error: 'slot is required' })

    // NOT A BUG: one synchronous transaction, no await between the read and the
    // write, and capacity is checked inside it. Hammering this endpoint books
    // exactly `capacity` deliveries and refuses the rest.
    const book = db.transaction((label: string, address: string | null) => {
      const s = db.prepare('SELECT * FROM slots WHERE label = ?').get(label) as
        | { id: number; capacity: number; booked: number }
        | undefined
      if (!s) return { code: 404 as const, body: { error: 'no such slot' } }
      if (s.booked >= s.capacity) return { code: 409 as const, body: { error: 'that slot is full' } }
      db.prepare('UPDATE slots SET booked = booked + 1 WHERE id = ? AND booked < capacity').run(s.id)
      const info = db
        .prepare('INSERT INTO deliveries (user_id, slot, taken, address, created_at) VALUES (?,?,1,?,?)')
        .run(u.id, label, address, now())
      return { code: 201 as const, body: db.prepare('SELECT * FROM deliveries WHERE id = ?').get(Number(info.lastInsertRowid)) }
    })

    const out = book(slot, b.address ?? null)
    return reply.code(out.code).send(out.body)
  })
}
