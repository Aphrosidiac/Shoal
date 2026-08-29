import type { FastifyInstance } from 'fastify'
import { db } from '../db.js'
import { require_ } from '../auth.js'

export default async function routes(app: FastifyInstance) {
  app.get('/api/admin/export', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    // BUG 9: authentication is checked, authorisation is not. Any signed-up
    // user can export every account's data.
    const users = db.prepare('SELECT id, email, name, role FROM users').all()
    const orders = db.prepare('SELECT * FROM orders LIMIT 500').all()
    const invoices = db.prepare('SELECT * FROM invoices LIMIT 500').all()
    return { generated_for: u.email, users, orders, invoices }
  })

  app.get('/api/admin/settings', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    // NOT A BUG: the role is checked and a normal user is correctly refused.
    if (u.role !== 'admin') return reply.code(403).send({ error: 'admins only' })
    return { smtp: 'localhost:1025', retention_days: 90, signups_open: true }
  })

  app.get('/api/admin/users', async (req, reply) => {
    const u = require_(req, reply); if (!u) return
    // NOT A BUG: also correctly refused.
    if (u.role !== 'admin') return reply.code(403).send({ error: 'admins only' })
    return db.prepare('SELECT id, email, role FROM users').all()
  })
}
