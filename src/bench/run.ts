import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { request } from 'undici'
import { loadConfig, parseDuration } from '../config.js'
import { openReadOnly } from '../store/db.js'
import { build } from '../report/build.js'
import { text } from '../report/render.js'
import * as map from '../store/repo/map.js'
import type { Flags } from '../bench-types.js'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const FIXTURE = join(repo, 'fixtures', 'leaky')
const PORT = Number(process.env.SHOAL_BENCH_PORT ?? 4100)

type Expect = { bug: number; check: string | string[]; endpoint?: string; screen?: string; why: string }

/**
 * The instrument. Five numbers, every one of which can move in the wrong
 * direction, and each says something different:
 *
 *   found                  did the checks work
 *   false positives        is it trustworthy
 *   model calls per action is the map doing its job as a cache
 *   wall clock             is the scheduler spending time well
 *   spend                  is it affordable to leave on
 *
 * A change that raises `found` and also raises `false positives` is not an
 * improvement.
 */
export async function runBench(flags: Flags): Promise<number> {
  const expect = (JSON.parse(readFileSync(join(FIXTURE, 'EXPECT.json'), 'utf8')) as { bugs: Expect[] }).bugs
  const forMs = flags.for ? parseDuration(String(flags.for)) : 10 * 60_000
  const label = String(flags.label ?? 'bench')
  const dir = String(flags.dir ?? join(repo, '.bench'))
  const keep = flags.keep === true

  if (!keep && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  const fixture = await startFixture()
  let stopped = false
  const stop = (): void => { try { fixture.kill('SIGKILL') } catch { /* gone */ } }
  process.once('exit', stop)
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      stopped = true
      stop()
      process.exit(130)
    })
  }
  const t0 = Date.now()
  try {
    // Read the driver and planner from wherever the user ran `shoal bench`,
    // not from the scratch directory this wipes at the start of every run.
    // A bench that quietly falls back to different models is not an
    // instrument, it is a coin toss.
    const cfg = loadConfig(
      {
        url: `http://localhost:${PORT}`,
        forMs,
        ui: { enabled: false },
        ...(flags.explorers ? { explorers: Number(flags.explorers) } : {}),
        ...(flags.hammerers ? { hammerers: Number(flags.hammerers) } : {}),
        ...(flags['jev-max-usd'] ? { jev: { maxUsd: Number(flags['jev-max-usd']) } } : {}),
      },
      process.cwd()
    )
    cfg.dir = dir
    const { runSwarm } = await import('../run.js')
    await runSwarm(cfg, (k, m) => process.stderr.write(`    ${k.padEnd(8)} ${m}\n`))
  } finally {
    fixture.kill('SIGKILL')
  }

  const wall = Date.now() - t0
  // A run that was killed has nothing to say. The summary below scores against
  // whatever is on disk now, and for an interrupted run that is not what it
  // saw — six entries in BENCH.md read `found 0 of 11, requests 0` for runs
  // that had five to eight findings when they were stopped.
  if (stopped) {
    process.stdout.write(`\nStopped after ${Math.round(wall / 60000)}m. No score written: an interrupted run has not measured anything.\n`)
    return 0
  }
  const db = openReadOnly(dir)
  const report = build(db, `http://localhost:${PORT}`)
  const eps = new Map(map.endpoints(db).map((e) => [e.id, `${e.method} ${e.path_pattern}`]))

  const found = new Set<number>()
  const falsePositives: string[] = []
  for (const f of report.findings) {
    const repro = JSON.parse(f.repro_json) as { check?: string; screen?: string }
    const check = repro.check ?? f.kind
    const endpoint = f.endpoint_id ? eps.get(f.endpoint_id) ?? '' : ''
    const screen = repro.screen ?? ''
    const hit = expect.find((e) => {
      const checks = Array.isArray(e.check) ? e.check : [e.check]
      if (!checks.includes(check)) return false
      if (e.screen) return e.screen === '*' ? screen !== '' : e.screen === screen
      return e.endpoint === '*' || e.endpoint === endpoint
    })
    if (hit) found.add(hit.bug)
    else falsePositives.push(`${check} @ ${screen || endpoint || '(nowhere)'} — ${f.title}`)
  }

  // A bug may have more than one way of being seen — #5 is a read-back over
  // HTTP and a dropped value on a screen — so the count is of bugs, not rows.
  const bugs = [...new Set(expect.map((e) => e.bug))]
  const missed = bugs.filter((b) => !found.has(b)).map((b) => expect.find((e) => e.bug === b)!)
  const perAction = report.spend.perAction
  const lines = [
    '',
    `found            ${found.size} of ${bugs.length}`,
    `missed           ${missed.length ? missed.map((m) => `#${m.bug} (${Array.isArray(m.check) ? m.check[0] : m.check})`).join(', ') : '—'}`,
    `false positives  ${falsePositives.length}`,
    `wall clock       ${Math.round(wall / 60000)}m ${Math.round((wall % 60000) / 1000)}s`,
    `model calls      ${report.spend.calls}        (${perAction.toFixed(2)} per action)`,
    `spend            $${report.spend.usd.toFixed(2)}`,
  ]
  if (falsePositives.length) {
    lines.push('', 'FALSE POSITIVES — each one of these fails the gate:')
    for (const fp of falsePositives) lines.push(`  ${fp}`)
  }
  process.stdout.write(lines.join('\n') + '\n')

  if (flags.report) process.stdout.write('\n' + text(report) + '\n')

  if (flags.append !== false) {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
    appendFileSync(
      join(FIXTURE, 'BENCH.md'),
      `\n## ${stamp} — ${label}\n\n` +
        '```\n' +
        lines.filter((l) => l.trim()).join('\n') +
        '\n```\n' +
        `\npages ${report.coverage.pages}, endpoints ${report.coverage.endpoints}, ` +
        `accounts ${report.coverage.accounts}, requests ${report.coverage.recordings}, ` +
        `actions ${report.coverage.actions}\n`
    )
  }

  return falsePositives.length ? 1 : 0
}

async function startFixture(): Promise<ChildProcess> {
  // Not `inherit`: the fixture would hold this process's stderr open, and a
  // bench that crashed would look like a bench that was still running.
  const child = spawn(join(repo, 'node_modules', '.bin', 'tsx'), [join(FIXTURE, 'server.ts')], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, LEAKY_PORT: String(PORT), LEAKY_SMTP_PORT: '1025', LEAKY_BASE_URL: `http://localhost:${PORT}` },
  })
  for (let i = 0; i < 60; i++) {
    try {
      const res = await request(`http://localhost:${PORT}/health`, {})
      await res.body.text()
      if (res.statusCode === 200) return child
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  child.kill('SIGKILL')
  throw new Error('the fixture would not start on :' + PORT)
}
