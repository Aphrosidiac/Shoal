import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Config } from './config.js'
import { assertLocal } from './config.js'
import { close, open, shoalDir } from './store/db.js'
import * as runRepo from './store/repo/run.js'
import * as coverage from './store/repo/coverage.js'
import * as map from './store/repo/map.js'
import { Patterns } from './map/normalise.js'
import { AppWatch } from './target/watch.js'
import { probe } from './target/probe.js'
import { BrowserPool } from './browser/pool.js'
import { Session } from './browser/session.js'
import { MailCatcher } from './signup/mail.js'
import { AuthStore } from './signup/auth.js'
import { Meter } from './budget/meter.js'
import { Vault } from './signup/vault.js'
import { buildModels } from './model/index.js'
import { Throttle } from './budget/throttle.js'
import { scout } from './agent/scout.js'
import { RunMemory } from './agent/loop.js'
import type { Ctx } from './ctx.js'
import { build } from './report/build.js'
import { html, markdown, text } from './report/render.js'

export type RunHandle = {
  ctx: Ctx
  stop: () => Promise<void>
  finished: Promise<void>
}

export type Supervisor = Awaited<ReturnType<typeof boot>>

/**
 * Boots everything, owns the lifecycle, and puts it all down again. One Node
 * process, one SQLite file, everything async inside it.
 */
export async function boot(cfg: Config, log: (kind: string, message: string) => void) {
  const url = assertLocal(cfg.url)
  const base = url.origin

  const p = await probe(base)
  if (!p.up) throw new Error(p.error ?? `nothing answered at ${base}`)

  const db = open(cfg.dir)
  const run = runRepo.startRun(db, base, cfg)
  const patterns = new Patterns()

  const app = new AppWatch(db, base)
  await app.start()

  const mail = new MailCatcher(cfg.mailPort)
  const mailUp = await mail.start()
  if (!mailUp) log('mail', `port ${cfg.mailPort} is busy; email verification will be skipped`)

  const models = await buildModels(db, cfg)
  // A local model's first call pays for loading six gigabytes off disk. Do it
  // now, while nothing is waiting on it, rather than inside the first turn.
  if (cfg.driver.provider === 'openai-compatible') {
    const t0 = Date.now()
    await models.driver
      .call({ system: 'Answer with the tool.', messages: [{ role: 'user', content: 'Say ok.' }], tools: [], maxTokens: 8 })
      .then(() => log('model', `driver warm in ${Math.round((Date.now() - t0) / 1000)}s`))
      .catch((e: Error) => log('model', `driver did not answer: ${e.message.split('\n')[0]}`))
  }
  const throttle = new Throttle(cfg.pace)
  const pool = new BrowserPool(cfg.headless)

  let stopping = false
  const ctx: Ctx = {
    cfg,
    db,
    runId: run.id,
    base,
    patterns,
    app,
    models,
    throttle,
    mail: mailUp ? mail : null,
    auth: new AuthStore(),
    meter: null as unknown as Meter,
    log: (kind, message) => {
      runRepo.event(db, kind, message)
      log(kind, message)
    },
    stopping: () => stopping,
  }

  ctx.meter = new Meter(ctx)

  const vault = new Vault(ctx)
  vault.setSignupPath(p.signupPath)

  const sessions: Session[] = []

  async function newSession(worker: string): Promise<Session> {
    const s = new Session(ctx, pool, worker)
    await s.start()
    sessions.push(s)
    return s
  }

  function writeReport(): void {
    const r = build(db, base)
    const dir = shoalDir(cfg.dir)
    writeFileSync(join(dir, 'report.md'), markdown(r))
    writeFileSync(join(dir, 'report.txt'), text(r))
    writeFileSync(join(dir, 'report.html'), html(r))
  }

  async function shutdown(): Promise<void> {
    stopping = true
    app.stop()
    throttle.dispose()
    for (const s of sessions) {
      try { await s.stop() } catch { /* already gone */ }
    }
    await pool.stop()
    await mail.stop()
    try { writeReport() } catch { /* report is best effort at shutdown */ }
    runRepo.stopRun(db, run.id)
    close()
  }

  return { ctx, probe: p, vault, pool, newSession, writeReport, shutdown, run }
}

/**
 * M1's whole job in one function: get in, look around, and come back with a
 * map you recognise.
 */
export async function scoutOnce(cfg: Config, log: (k: string, m: string) => void, turns = 60) {
  const sup = await boot(cfg, log)
  const { ctx } = sup
  try {
    ctx.log('start', `${sup.probe.rendering}-rendered app at ${ctx.base}${sup.probe.title ? ` — "${sup.probe.title}"` : ''}`)
    if (sup.probe.signupPath) ctx.log('start', `signup looks like ${sup.probe.signupPath}`)

    const memory = new RunMemory()
    const s = await sup.newSession('scout-1')
    const r = await scout(ctx, s, sup.vault, { turns, memory })

    coverage.set(ctx.db, 'pages', map.pages(ctx.db).length)
    coverage.set(ctx.db, 'endpoints', map.endpoints(ctx.db).length)
    sup.writeReport()
    return { ...r, ctx }
  } finally {
    await sup.shutdown()
  }
}
