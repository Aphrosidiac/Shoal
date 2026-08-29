import type { FastifyInstance } from 'fastify'
import { db, now } from '../db.js'
import { currentUser, issue, setCookie } from '../auth.js'
import { sendVerification } from '../mailer.js'

type Body = { email?: string; password?: string; name?: string }

export default async function routes(app: FastifyInstance) {
  app.post('/api/auth/register', async (req, reply) => {
    const b = (req.body ?? {}) as Body
    const email = (b.email ?? '').trim().toLowerCase()
    const password = b.password ?? ''
    if (!email.includes('@') || email.length < 5) return reply.code(400).send({ error: 'a valid email is required' })
    if (password.length < 6) return reply.code(400).send({ error: 'password must be at least 6 characters' })
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
    if (existing) return reply.code(409).send({ error: 'that email is already registered' })

    const info = db
      .prepare('INSERT INTO users (email, password, name, role, created_at) VALUES (?,?,?,?,?)')
      .run(email, password, b.name ?? email.split('@')[0], 'user', now())
    const id = Number(info.lastInsertRowid)
    const token = issue(id)
    setCookie(reply, token)
    void sendVerification(email, token)
    return reply.code(201).send({ id, email, token })
  })

  app.post('/api/auth/login', async (req, reply) => {
    const b = (req.body ?? {}) as Body
    const email = (b.email ?? '').trim().toLowerCase()
    const row = db.prepare('SELECT id, password FROM users WHERE email = ?').get(email) as
      | { id: number; password: string }
      | undefined
    if (!row || row.password !== (b.password ?? '')) return reply.code(401).send({ error: 'wrong email or password' })
    const token = issue(row.id)
    setCookie(reply, token)
    return { id: row.id, email, token }
  })

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.header('set-cookie', 'leaky_session=; Path=/; Max-Age=0')
    return { ok: true }
  })

  app.get('/api/me', async (req, reply) => {
    const u = currentUser(req)
    if (!u) return reply.code(401).send({ error: 'not authenticated' })
    return u
  })

  // Email verification link target. Harmless; exists so a verification mail
  // has somewhere to point.
  app.get('/verify', async (req, reply) => {
    const t = (req.query as { token?: string }).token ?? ''
    const s = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(t)
    if (!s) return reply.code(400).type('text/html').send('<h1>Bad verification link</h1>')
    setCookie(reply, t)
    return reply.redirect('/app')
  })
}
