import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Config } from './config.js'
import { shoalDir } from './store/db.js'
import { boot } from './supervisor.js'
import { RunMemory } from './agent/loop.js'
import { Scheduler, seed } from './queue/scheduler.js'
import { confirmerPool, explorerPool, hammererPool } from './pools.js'
import { watch } from './watch/index.js'
import { writeMissions } from './agent/missions.js'
import * as queue from './store/repo/queue.js'
import * as coverage from './store/repo/coverage.js'
import { text } from './report/render.js'
import { build } from './report/build.js'
import { scout } from './agent/scout.js'
import { heartbeat } from './store/repo/run.js'
import { serve } from './ui/server.js'
import { state } from './ui/state.js'

/**
 * There is no "run". This is a queue that never empties, with workers pulling
 * off it. Ten minutes explores a bit; twenty-four hours hammers everything it
 * found in the first hour. Stop it whenever you like and it did less or more.
 */
export async function runSwarm(cfg: Config, log: (k: string, m: string) => void): Promise<number> {
  const stopFile = join(shoalDir(cfg.dir), 'stop')
  if (existsSync(stopFile)) rmSync(stopFile)

  const sup = await boot(cfg, log)
  const { ctx } = sup
  const deadline = cfg.forMs ? Date.now() + cfg.forMs : null
  let external = false

  Object.assign(ctx, {
    stopping: () => external || (deadline !== null && Date.now() > deadline),
  })

  const onSignal = (): void => {
    if (external) process.exit(130)
    external = true
    log('stop', 'stopping — everything stays on disk, `shoal run` picks it up again')
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  const watchStop = setInterval(() => {
    if (existsSync(stopFile)) external = true
    heartbeat(ctx.db, ctx.runId)
  }, 1000)
  watchStop.unref?.()

  const writeReport = setInterval(() => {
    try { sup.writeReport() } catch { /* best effort */ }
  }, 60_000)
  writeReport.unref?.()

  // Missions are the most expensive thing the planner does and the thing that
  // most needs a map to exist first, so they are written as the map fills
  // rather than all at once at the start.
  const topUp = setInterval(() => {
    if (ctx.stopping()) return
    const waiting = queue.frontierByKind(ctx.db).mission ?? 0
    if (waiting < 3) void writeMissions(ctx).catch(() => undefined)
  }, 5 * 60_000)
  topUp.unref?.()

  const ui = cfg.ui.enabled
    ? await serve(cfg, () => state(ctx.db, cfg, ctx.base, ctx.app.fingerprint)).catch((e: Error) => {
        log('ui', `dashboard did not start: ${e.message}`)
        return null
      })
    : null
  if (ui) log('ui', `dashboard on http://localhost:${ui.port}`)

  const memory = new RunMemory()

  // Every recording goes through the checks from here on. Nothing in them
  // calls a model, and none of them can write a finding.
  watch(ctx)

  try {
    ctx.log('start', `${sup.probe.rendering}-rendered app at ${ctx.base}${sup.probe.title ? ` — "${sup.probe.title}"` : ''}`)
    if (sup.probe.signupPath) ctx.log('start', `signup looks like ${sup.probe.signupPath}`)

    const resumed = queue.frontier(ctx.db)
    if (resumed) ctx.log('start', `picking up ${resumed} item${resumed === 1 ? '' : 's'} left from last time`)

    // The first pass is a plain scout: without one there is nothing in the map
    // for the queue to be made of.
    if (!resumed) {
      const s = await sup.newSession('scout-1')
      const r = await scout(ctx, s, sup.vault, { turns: 40, memory })
      ctx.log('scout', `${r.reason}: ${r.result} (${r.turns} turns, ${r.modelCalls} model calls, ${r.fastActions} free)`)
      await s.stop()
      seed(ctx)
      await writeMissions(ctx)
      ctx.log('queue', `${queue.frontier(ctx.db)} items to work through`)
    }

    const sched = new Scheduler(ctx, [
      explorerPool(ctx, (w) => sup.newSession(w), sup.vault, memory),
      confirmerPool(ctx),
      hammererPool(ctx),
    ])
    await sched.start()
    await sched.wait()
    sched.stop()

    coverage.set(ctx.db, 'frontier', queue.frontier(ctx.db))
    sup.writeReport()
    process.stdout.write('\n' + text(build(ctx.db, ctx.base)) + '\n')
    return 0
  } finally {
    clearInterval(watchStop)
    clearInterval(writeReport)
    clearInterval(topUp)
    if (ui) await ui.close().catch(() => undefined)
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    await sup.shutdown()
  }
}
