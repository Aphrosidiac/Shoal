import type { FastifyReply, FastifyRequest } from 'fastify'
import { db, now, rid } from './db.js'

export type User = { id: number; email: string; name: string | null; role: string }

export function issue(userId: number): string {
  const token = rid(28)
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)').run(token, userId, now())
  return token
}

function tokenOf(req: FastifyRequest): string | null {
  const auth = req.headers.authorization
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7)
  const cookie = req.headers.cookie
  if (!cookie) return null
  for (const part of cookie.split(';')) {
    const [k, v] = part.trim().split('=')
    if (k === 'leaky_session' && v) return decodeURIComponent(v)
  }
  return null
}

export function currentUser(req: FastifyRequest): User | null {
  const t = tokenOf(req)
  if (!t) return null
  const row = db
    .prepare(
      'SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
    )
    .get(t) as User | undefined
  return row ?? null
}

/** Returns the user or replies 401 and returns null. */
export function require_(req: FastifyRequest, reply: FastifyReply): User | null {
  const u = currentUser(req)
  if (!u) {
    reply.code(401).send({ error: 'not authenticated' })
    return null
  }
  return u
}

export function setCookie(reply: FastifyReply, token: string): void {
  reply.header('set-cookie', `leaky_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`)
}
