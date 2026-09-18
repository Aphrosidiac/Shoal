import Fastify from 'fastify'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Config } from '../config.js'
import { openReadOnly, shoalDir, type DB } from '../store/db.js'
import { CSS, HTML, JS } from './page.js'
import { state, stepDetail } from './state.js'
import * as stepsRepo from '../store/repo/steps.js'
import { readFile } from 'node:fs/promises'

export type UiHandle = { port: number; close: () => Promise<void> }

/**
 * Served by the Shoal process itself. Plain HTML, CSS and a little vanilla
 * JavaScript, no build step — this has to start reliably at 2am on somebody
 * else's machine, and a dashboard that can fail to compile is a dashboard that
 * stops you shipping.
 *
 * Read-only, with three exceptions: start, stop and recheck a finding.
 */
export async function serve(cfg: Config, get: () => Record<string, unknown>): Promise<UiHandle> {
  // forceCloseConnections: an open dashboard tab holds an SSE stream forever, and
  // a close() that waits for it is a run that never exits after its report.
  const app = Fastify({ logger: false, forceCloseConnections: true })

  app.get('/', async (_req, reply) => reply.type('text/html').send(HTML))
  app.get('/app.css', async (_req, reply) => reply.type('text/css').send(CSS))
  app.get('/app.js', async (_req, reply) => reply.type('application/javascript').send(JS))
  app.get('/api/state', async () => get())

  // The filmstrip: one judged screen with everything Jev answered about it.
  app.get<{ Params: { id: string } }>('/api/step/:id', async (req, reply) => {
    const db = openReadOnly(cfg.dir)
    try {
      const r = stepsRepo.byId(db, Number(req.params.id))
      if (!r) return reply.code(404).send({ error: 'no such step' })
      return stepDetail(r)
    } finally {
      db.close()
    }
  })
  app.get<{ Querystring: { before?: string; limit?: string } }>('/api/steps', async (req) => {
    const db = openReadOnly(cfg.dir)
    try {
      const { stepSummary } = await import('./state.js')
      return stepsRepo.recent(db, Math.min(200, Number(req.query.limit ?? 60)), req.query.before ? Number(req.query.before) : undefined).map(stepSummary)
    } finally {
      db.close()
    }
  })
  app.get<{ Params: { file: string } }>('/shots/:file', async (req, reply) => {
    if (!/^\d+\.jpg$/.test(req.params.file)) return reply.code(404).send('')
    try {
      const buf = await readFile(join(shoalDir(cfg.dir), 'shots', req.params.file))
      return reply.type('image/jpeg').header('cache-control', 'max-age=3600').send(buf)
    } catch {
      return reply.code(404).send('')
    }
  })

  app.get('/events', async (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    })
    const send = (): void => {
      try {
        reply.raw.write(`data: ${JSON.stringify(get())}\n\n`)
      } catch {
        clearInterval(timer)
      }
    }
    send()
    const timer = setInterval(send, 1500)
    req.raw.on('close', () => clearInterval(timer))
    await new Promise<void>((resolve) => req.raw.on('close', () => resolve()))
  })

  app.post('/api/stop', async () => {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(shoalDir(cfg.dir), 'stop'), String(Date.now()))
    return { message: 'asked the run to stop' }
  })

  app.post<{ Params: { id: string } }>('/api/recheck/:id', async (req) => {
    const id = Number(req.params.id)
    const out = await new Promise<string>((resolve) => {
      const child = spawn(process.execPath, [...selfArgs(), 'recheck', String(id)], { cwd: cfg.dir })
      let buf = ''
      child.stdout.on('data', (d) => (buf += String(d)))
      child.stderr.on('data', (d) => (buf += String(d)))
      child.on('error', (e) => resolve('could not run recheck: ' + e.message))
      child.on('close', () => resolve(buf.trim()))
    })
    return { message: out.split('\n').filter(Boolean).pop() ?? 'done' }
  })

  let port = cfg.ui.port
  for (let i = 0; i < 20; i++) {
    try {
      await app.listen({ port, host: '127.0.0.1' })
      break
    } catch (e) {
      if (!/EADDRINUSE/.test(String((e as Error).message))) throw e
      port++
      if (i === 19) throw new Error(`ports ${cfg.ui.port}-${port} are all busy`)
    }
  }
  return { port, close: async () => { await app.close() } }
}

/** `shoal ui` on its own: the same views, read out of the file on disk. */
export async function serveOnly(cfg: Config): Promise<number> {
  if (!existsSync(join(shoalDir(cfg.dir), 'run.db'))) {
    process.stderr.write(`No run in ${cfg.dir}. Start one with: shoal run <url>\n`)
    return 1
  }
  let db: DB = openReadOnly(cfg.dir)
  const appUrl = (db.prepare('SELECT app_url FROM runs ORDER BY id DESC LIMIT 1').get() as { app_url: string }).app_url

  const h = await serve(cfg, () => {
    // Reopen on each read: a run writing in another process moves the file on.
    try {
      db.close()
    } catch {
      /* already closed */
    }
    db = openReadOnly(cfg.dir)
    return state(db, cfg, appUrl, 'unknown')
  })
  process.stdout.write(`shoal ui  http://localhost:${h.port}\n`)
  await new Promise<void>((resolve) => {
    process.on('SIGINT', resolve)
    process.on('SIGTERM', resolve)
  })
  await h.close()
  return 0
}

/**
 * Re-run ourselves the way we were run. Under tsx that means keeping the
 * loader flags, or the child is plain node being handed a TypeScript file.
 */
export function selfArgs(): string[] {
  return [...process.execArgv, process.argv[1]!]
}
