#!/usr/bin/env tsx
/**
 * shoal — run a voyage, take soundings, chart what it ran aground on.
 *
 *   shoal doctor  bbf
 *   shoal run     bbf --seed 4471 --waves 60 --collide 0.4
 *   shoal run     bbf --seed 4471 --minimise
 *   shoal replay  charts/bbf-4471.json --attempts 5
 *   shoal soundings bbf
 */
import { join } from 'node:path'
import { mkdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bootTarget, readDotEnv } from './core/boot.js'
import { Soundings, dbUrl, ensureTemplate, resetWorkDb } from './core/db.js'
import { login } from './core/driver.js'
import { mulberry32 } from './core/rng.js'
import { runVoyage } from './core/voyage.js'
import type { Action, LogEntry, ProbeContext, Session, Target, World, Violation } from './core/types.js'
import { sweepAll } from './core/sound.js'
import { bbf, password } from './targets/bbf/index.js'
import { buildFrontend, serveDist } from './core/webserve.js'
import { replayLog } from './triage/replay.js'
import { minimise } from './triage/minimise.js'
import { writeChart, type Chart } from './triage/chart.js'

const TARGETS: Record<string, Target> = { bbf }
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const CHARTS = join(ROOT, 'charts')

const argv = process.argv.slice(2)
const command = argv[0]
const positional = argv.slice(1).filter((a) => !a.startsWith('--'))
const flag = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const next = argv[i + 1]
  return next && !next.startsWith('--') ? next : 'true'
}
const num = (name: string, fallback: number) => {
  const v = flag(name)
  return v === undefined ? fallback : Number(v)
}
const has = (name: string) => argv.includes(`--${name}`)

function target(): Target {
  const t = TARGETS[positional[0] ?? '']
  if (!t) {
    console.error(`unknown target "${positional[0]}". known: ${Object.keys(TARGETS).join(', ')}`)
    process.exit(2)
  }
  return t
}

/** The base Postgres URL the target itself uses, minus its database name. */
function pgBase(t: Target) {
  const url = readDotEnv(join(t.root, '.env')).DATABASE_URL
  if (!url) throw new Error(`no DATABASE_URL in ${join(t.root, '.env')}`)
  return url
}

interface Rig {
  sessions: Session[]
  /**
   * The actor the survey runs as.
   *
   * It has to be the manager. Every other role is page-gated — the first
   * survey ran as a salesperson, whose token cannot reach
   * /api/logistics/resources, so it reported zero delivery windows and the
   * swarm quietly never booked anything. A 403 during setup looks exactly
   * like an empty system.
   */
  surveyor: Session
  db: Soundings
  stop: () => Promise<void>
  stderr: string[]
}

/**
 * A fresh database, a booted target, and every persona logged in.
 *
 * The reset is first and unconditional. A voyage that starts on whatever the
 * last voyage left behind is not reproducible and its findings cannot be
 * attributed to anything.
 */
async function rig(t: Target, quiet: boolean): Promise<Rig> {
  const base = pgBase(t)
  await ensureTemplate(base, t.sourceDb, t.templateDb, has('rebuild-template'))
  await resetWorkDb(base, t.workDb, t.templateDb)

  const booted = await bootTarget({
    root: t.root,
    entry: 'src/server.ts',
    port: t.port,
    databaseUrl: dbUrl(base, t.workDb),
    quiet,
  })

  const url = `http://127.0.0.1:${t.port}`
  const sessions: Session[] = []
  for (const p of t.personas) {
    const copies = Math.max(1, p.instances ?? 1)
    for (let i = 0; i < copies; i++) {
      sessions.push({
        // The suffix only appears when there is more than one, so single-session
        // personas keep the id their logs and charts already use.
        id: copies === 1 ? p.name : `${p.name}#${i + 1}`,
        persona: p.name,
        role: p.role,
        email: p.email,
        token: await login(url, p.email, password),
        base: url,
      })
    }
  }

  const surveyor = sessions.find((s) => s.role === 'MANAGER')
  if (!surveyor) throw new Error(`${t.name} defines no MANAGER persona; the survey has nothing ungated to run as`)

  const db = new Soundings(dbUrl(base, t.workDb))
  await db.open()
  let stopped = false
  return {
    sessions,
    surveyor,
    db,
    stderr: booted.stderr,
    // Idempotent on purpose. The caller stops the rig early before shrinking
    // and the `finally` stops it again on the way out.
    stop: async () => {
      if (stopped) return
      stopped = true
      await db.close()
      await booted.stop()
    },
  }
}

/** Everything a probe sounding is allowed to reach. */
function context(r: Rig, world: World): ProbeContext {
  return {
    sessions: new Map(r.sessions.map((s) => [s.id, s])),
    surveyor: r.surveyor,
    sql: (text) => r.db.take(text),
    memory: new Map(),
    world,
  }
}

async function sweep(t: Target, ctx: ProbeContext, atWave: number): Promise<Violation[]> {
  return sweepAll(t.soundings, ctx, atWave)
}

/**
 * Boots the frontend for a browser probe: builds it if needed, then serves the
 * bundle with /api pointed at this voyage's backend.
 */
async function serveUi(t: Target): Promise<{ url: string; stop: () => Promise<void> }> {
  if (!t.web) throw new Error(`${t.name} declares no frontend to drive`)
  process.stdout.write('  building the frontend …\r')
  const dist = await buildFrontend(t.web.root, has('rebuild-ui'))
  const served = await serveDist(dist, t.web.port, t.port)
  process.stdout.write('                           \r')
  return { url: `http://127.0.0.1:${t.web.port}`, stop: served.stop }
}

async function cmdRun() {
  const t = target()
  const seed = num('seed', 4471)
  const waves = num('waves', 60)
  const collide = Number(flag('collide', '0.4'))
  const soundEvery = num('sound-every', 5)
  const seasonWaves = num('season', 25)
  const quiet = !has('verbose')

  console.log(`\n  shoal · ${t.name} · seed ${seed} · ${seasonWaves} seasoning + ${waves} waves\n`)
  const r = await rig(t, quiet)
  try {
    const world = await t.survey(r.surveyor)
    console.log(
      `  ${r.sessions.length} actors · surveyed ${world.customers.length} customers, ` +
        `${world.slots.length} windows, ${world.dates.length} bookable dates\n`,
    )
    if (!world.customers.length || !world.slots.length) {
      throw new Error('the survey came back empty — is the source database seeded?')
    }

    const result = await runVoyage(
      mulberry32(seed),
      r.sessions,
      t.personas,
      t.actions,
      world,
      t.soundings,
      context(r, world),
      {
        waves,
        collideRate: collide,
        soundEvery,
        seasonWaves,
        onWave: (w) => {
          const total = seasonWaves + waves
          if (w % 10 === 9) {
            const label = w < seasonWaves ? 'seasoning' : 'wave'
            process.stdout.write(`  ${label} ${w + 1}/${total}   \r`)
          }
        },
      },
      t.collisionGroups ?? [],
      t.seasonBias ?? {},
    )
    process.stdout.write('                          \r')

    const chart: Chart = {
      target: t.name,
      seed,
      waves: seasonWaves + waves,
      actors: r.sessions.length,
      violations: result.violations,
      serverFaults: result.serverFaults,
      starved: result.starved,
      log: result.log,
    }

    // The browser probe runs ONCE, after the voyage, rather than on every
    // sweep. Launching Chrome forty times to look at the same eight pages is
    // most of a voyage's wall clock and tells you nothing the last look does
    // not.
    if (has('ui') && t.uiProbe) {
      const ui = await serveUi(t)
      try {
        const found = await sweepAll([t.uiProbe({ url: ui.url })], context(r, world), seasonWaves + waves)
        chart.violations.push(...found)
        if (!found.length) console.log('  browser: 8 pages loaded clean')
      } finally {
        await ui.stop()
      }
    }

    report(chart)

    // The rig comes down BEFORE the shrinker starts.
    //
    // Every reduction trial resets the working database, and a reset
    // terminates every connection to it. Leaving this rig up means dropping
    // the database out from under its own sounding client and the target still
    // running against it — which is exactly how this failed the first time.
    await r.stop()

    if (has('minimise') && (chart.violations.length || chart.serverFaults.length)) {
      const targetSounding = chart.violations[0]?.sounding
      console.log(`\n  shrinking against ${targetSounding ?? 'the server fault'} …`)
      const attempts = num('attempts', 3)
      const actions = new Map(t.actions.map((a) => [a.name, a]))
      let hits = 0
      let tries = 0

      const reproduce = async (log: LogEntry[]) => {
        for (let i = 0; i < attempts; i++) {
          tries++
          const again = await rig(t, true)
          try {
            const world = await t.survey(again.surveyor)
            const sessions = new Map(again.sessions.map((s) => [s.id, s]))
            await replayLog(log, sessions, actions, world)
            const v = await sweep(t, context(again, world), -1)
            if (targetSounding ? v.some((x) => x.sounding === targetSounding) : v.length) {
              hits++
              return true
            }
          } finally {
            await again.stop()
          }
        }
        return false
      }

      const minimised = await minimise(chart.log, reproduce, (kept, total, trials) =>
        process.stdout.write(`  ${kept}/${total} waves kept after ${trials} trials\r`),
      )
      process.stdout.write('                                             \r')
      chart.minimised = minimised
      chart.reproductionRate = `${hits}/${tries} replays`
      console.log(`  minimal: ${minimised.length} actions across ${new Set(minimised.map((e) => e.wave)).size} waves`)
    }

    mkdirSync(CHARTS, { recursive: true })
    const path = writeChart(CHARTS, chart, t.soundings)
    console.log(`\n  chart: ${path}\n`)
    process.exitCode = chart.violations.length || chart.serverFaults.length ? 1 : 0
  } finally {
    await r.stop()
  }
}

function report(chart: Chart) {
  // Printed FIRST, and before any verdict. A voyage that never managed to do
  // something has not tested it, and the reader has to know that before they
  // read anything else as reassurance.
  for (const s of chart.starved ?? []) {
    console.log(`  STARVED  "${s.action}" was refused all ${s.attempts} times it was tried`)
    console.log(`           nothing this voyage says about it means anything`)
  }
  if (!chart.violations.length && !chart.serverFaults.length) {
    console.log(`  ${chart.log.length} actions. Nothing tripped.`)
    return
  }
  for (const v of chart.violations) {
    console.log(`  AGROUND  ${v.title}`)
    console.log(`           ${v.sounding} · after wave ${v.atWave} · ${v.rows.length} row(s)`)
  }
  if (chart.serverFaults.length) {
    const routes = new Set(chart.serverFaults.map((f) => f.action))
    console.log(`  FAULT    ${chart.serverFaults.length} server fault(s) across ${routes.size} action(s)`)
  }
}

async function cmdReplay() {
  const file = positional[0]
  if (!file) throw new Error('usage: shoal replay <chart.json> [--attempts 5] [--minimised]')
  const chart: Chart = JSON.parse(readFileSync(file, 'utf8'))
  const t = TARGETS[chart.target]!
  const log = has('minimised') && chart.minimised ? chart.minimised : chart.log
  const attempts = num('attempts', 3)
  const actions = new Map(t.actions.map((a) => [a.name, a]))

  let hits = 0
  for (let i = 0; i < attempts; i++) {
    const r = await rig(t, true)
    try {
      const world = await t.survey(r.surveyor)
      await replayLog(log, new Map(r.sessions.map((s) => [s.id, s])), actions, world)
      const v = await sweep(t, context(r, world), -1)
      if (v.length) hits++
      console.log(`  attempt ${i + 1}: ${v.length ? v.map((x) => x.sounding).join(', ') : 'clear'}`)
    } finally {
      await r.stop()
    }
  }
  console.log(`\n  reproduced ${hits}/${attempts}\n`)
  process.exitCode = hits ? 1 : 0
}

async function cmdSoundings() {
  const t = target()
  console.log(`\n  ${t.soundings.length} soundings for ${t.name}\n`)
  for (const s of t.soundings) {
    console.log(`  ${s.id}`)
    console.log(`    ${s.title}`)
    console.log(`    ${s.because.replace(/\s+/g, ' ')}\n`)
  }
}

async function cmdDoctor() {
  const t = target()
  const base = pgBase(t)
  console.log(`\n  target   ${t.name} at ${t.root}`)
  console.log(`  postgres ${new URL(base.replace(/\?.*$/, '')).host}`)
  await ensureTemplate(base, t.sourceDb, t.templateDb, has('rebuild-template'))
  console.log(`  template ${t.templateDb} ready (cloned from ${t.sourceDb})`)
  await resetWorkDb(base, t.workDb, t.templateDb)
  console.log(`  work db  ${t.workDb} reset`)
  const r = await rig(t, true)
  try {
    const world = await t.survey(r.surveyor)
    console.log(`  booted   port ${t.port}, ${r.sessions.length} personas logged in`)
    console.log(`  world    ${world.customers.length} customers · ${world.products.length} products · ${world.slots.length} windows`)
    const v = await sweep(t, context(r, world), -1)
    console.log(`  sweep    ${t.soundings.length} soundings ran, ${v.length} tripped on the seeded data`)
    for (const x of v) {
      console.log(`           ! ${x.sounding} — ${x.title}`)
      // The rows, not just the name. A doctor that says which sounding tripped
      // but not why sends you reading source to find out whether the check or
      // the seed is wrong.
      for (const row of x.rows) console.log(`             ${JSON.stringify(row)}`)
    }

    const empty = ['customers', 'products', 'slots'].filter((k) => (world as any)[k].length === 0)
    if (empty.length) {
      console.log(`\n  The survey found no ${empty.join(', ')}. A voyage would sail over an empty world and`)
      console.log(`  report clear water. Seed the source database, then rebuild with --rebuild-template.\n`)
      process.exitCode = 1
    } else if (v.length) {
      console.log('\n  Seed data violates a sounding. Fix the sounding or the seed before trusting a voyage.\n')
      process.exitCode = 1
    } else {
      console.log('\n  Ready.\n')
    }
  } finally {
    await r.stop()
  }
}

const commands: Record<string, () => Promise<void>> = {
  run: cmdRun,
  replay: cmdReplay,
  soundings: cmdSoundings,
  doctor: cmdDoctor,
}

const fn = commands[command ?? '']
if (!fn) {
  console.log(`\n  shoal <run|replay|soundings|doctor> [target] [flags]\n`)
  process.exit(2)
}
fn().catch((e) => {
  console.error(`\n  ${e.message}\n`)
  process.exit(1)
})
