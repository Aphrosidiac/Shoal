#!/usr/bin/env node
import { setDefaultResultOrder } from 'node:dns'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, assertLocal, parseDuration, type Config } from './config.js'
import { openReadOnly, shoalDir } from './store/db.js'
import { build } from './report/build.js'
import { html, markdown, text } from './report/render.js'
import * as map from './store/repo/map.js'
import * as findingsRepo from './store/repo/findings.js'
import { currentRun } from './store/repo/run.js'

// Dev servers bind 127.0.0.1 far more often than they bind ::1, and Node's
// default resolution order will happily hand us ::1 for "localhost" and then
// fail to connect to an app that is plainly running. Browsers retry the other
// family; an HTTP client does not.
setDefaultResultOrder('ipv4first')

const HELP = `shoal — a swarm of agents that use your app until it breaks

  shoal run <url>          start a run, or continue the one in this directory
  shoal status             what is happening right now
  shoal ui                 open the dashboard (default http://localhost:7717)
  shoal report [--open]    regenerate the report file
  shoal findings [id]      list findings, or show one in full
  shoal recheck <id>       re-run one finding's repro against the app as it is
  shoal map                dump what Shoal knows about the app
  shoal stop               stop the run, leave everything on disk
  shoal reset [--all]      clear findings and traffic; --all clears the map too
  shoal doctor             check the setup before wasting a run on it
  shoal bench              run against the calibration fixture and score
  shoal mcp                run as an MCP server on stdio

  --explorers N  --hammerers N  --confirmers N  --pace N
  --for 30m|24h  --budget N  --driver name  --planner name
  --no-ui  --redact  --verbose  --headed
`

type Flags = Record<string, string | number | boolean>

function parse(argv: string[]): { cmd: string; args: string[]; flags: Flags } {
  const args: string[] = []
  const flags: Flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith('--')) {
      args.push(a)
      continue
    }
    const [rawKey, inline] = a.slice(2).split('=', 2)
    const key = rawKey!
    if (inline !== undefined) {
      flags[key] = bool(inline)
      continue
    }
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = bool(next)
      i++
    } else flags[key] = true
  }
  return { cmd: args.shift() ?? 'help', args, flags }
}

const bool = (v: string): string | boolean => (v === 'true' ? true : v === 'false' ? false : v)

function toConfigFlags(f: Flags, args: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (args[0]) out.url = args[0]
  for (const k of ['explorers', 'hammerers', 'confirmers', 'pace', 'mailPort', 'slowMs'] as const) {
    if (f[k] !== undefined) out[k] = Number(f[k])
  }
  if (f.budget !== undefined) out.budgetPerHour = Number(f.budget)
  if (f.for !== undefined) out.forMs = parseDuration(String(f.for))
  if (f.driver !== undefined) out.driver = { model: String(f.driver) }
  if (f.planner !== undefined) out.planner = { model: String(f.planner) }
  if (f['no-ui']) out.ui = { enabled: false }
  if (f.redact) out.redact = true
  if (f.verbose) out.verbose = true
  if (f.headed) out.headless = false
  return out
}

const stamp = (): string => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

function logger(verbose: boolean) {
  const quiet = new Set(['note'])
  return (kind: string, message: string): void => {
    if (!verbose && quiet.has(kind)) return
    process.stderr.write(`${stamp()}  ${kind.padEnd(8)} ${message}\n`)
  }
}

async function main(): Promise<number> {
  const { cmd, args, flags } = parse(process.argv.slice(2))
  const dir = process.cwd()

  switch (cmd) {
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HELP)
      return 0

    case 'run': {
      const cfg = loadConfig(toConfigFlags(flags, args), dir)
      const told = Boolean(args[0]) || Boolean(process.env.SHOAL_URL) || existsSync(join(dir, 'shoal.config.json'))
      if (!told && !existsSync(join(shoalDir(dir), 'run.db'))) {
        process.stderr.write('shoal run needs a URL the first time: shoal run http://localhost:3000\n')
        return 2
      }
      assertLocal(cfg.url)
      const { runSwarm } = await import('./run.js')
      return runSwarm(cfg, logger(cfg.verbose))
    }

    case 'doctor': {
      const cfg = loadConfig(toConfigFlags(flags, args), dir)
      const { doctor } = await import('./doctor.js')
      return doctor(cfg)
    }

    case 'report': {
      const cfg = loadConfig(toConfigFlags(flags, args), dir)
      const db = openReadOnly(dir)
      const appUrl = urlOf(db, cfg)
      const r = build(db, appUrl)
      const out = shoalDir(dir)
      writeFileSync(join(out, 'report.md'), markdown(r))
      writeFileSync(join(out, 'report.txt'), text(r))
      writeFileSync(join(out, 'report.html'), html(r))
      if (flags.open) {
        const { spawn: sp } = await import('node:child_process')
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
        sp(opener, [join(out, 'report.html')], { detached: true, stdio: 'ignore' }).unref()
      }
      process.stdout.write(text(r) + '\n')
      return 0
    }

    case 'status': {
      const cfg = loadConfig(toConfigFlags(flags, args), dir)
      const db = openReadOnly(dir)
      const r = build(db, urlOf(db, cfg))
      const c = r.coverage
      const alive = Date.now() - (currentRun(db, r.appUrl)?.last_seen_at ?? 0) < 30_000
      process.stdout.write(
        [
          `${r.appUrl}  ${alive ? 'running' : 'stopped'}`,
          `pages ${c.pagesExplored}/${c.pages}   endpoints ${c.endpointsHammered}/${c.endpoints} hammered   accounts ${c.accounts}`,
          `findings ${r.findings.filter((f) => f.state === 'open').length} confirmed, ${r.unconfirmed.length} unconfirmed`,
          `requests ${c.recordings}   model calls ${r.spend.calls} (${r.spend.perAction.toFixed(2)}/action)   $${r.spend.usd.toFixed(2)}`,
          r.starved.length
            ? 'STARVED  ' + r.starved.map((x) => `${x.action} ${x.ok}/${x.tries} always ${x.statuses}`).join('\n         ')
            : '',
          r.events
            .filter((e) => e.kind === 'restart' || e.kind === 'budget' || e.kind === 'model')
            .slice(0, 3)
            .map((e) => `${new Date(e.at).toLocaleTimeString()}  ${e.kind}  ${e.message}`)
            .join('\n'),
        ]
          .filter(Boolean)
          .join('\n') + '\n'
      )
      return 0
    }

    case 'map': {
      const cfg = loadConfig(toConfigFlags(flags, args), dir)
      const db = openReadOnly(dir)
      void cfg
      const pages = map.pages(db)
      const eps = map.endpoints(db)
      const out: string[] = []
      out.push(`PAGES  ${pages.length}   (untouched first)`)
      for (const p of pages) {
        out.push(`  ${p.explored ? ' ' : '*'} ${p.url_pattern.padEnd(34)} ${String(p.visits).padStart(4)} visits  ${p.title ?? ''}`)
      }
      out.push('', `ENDPOINTS  ${eps.length}`)
      for (const e of eps) {
        const statuses = Object.entries(JSON.parse(e.statuses_json) as Record<string, number>)
          .map(([s, n]) => `${s}×${n}`)
          .join(' ')
        out.push(
          `  ${e.hammered ? ' ' : '*'} ${e.method.padEnd(6)} ${e.path_pattern.padEnd(34)} ${String(e.calls).padStart(4)} calls  ${statuses}` +
            (e.readback_id ? `  readback #${e.readback_id}` : '')
        )
      }
      out.push('', 'FORMS')
      for (const f of map.forms(db)) {
        const fields = map.fieldsOf(db, f.id)
        const poked = fields.filter((x) => (JSON.parse(x.tried_json) as string[]).length).length
        out.push(`  ${(f.name ?? '(unnamed)').padEnd(30)} ${fields.length} fields, ${poked} poked`)
      }
      process.stdout.write(out.join('\n') + '\n')
      return 0
    }

    case 'findings': {
      const cfg = loadConfig(toConfigFlags(flags, args), dir)
      const db = openReadOnly(dir)
      const r = build(db, urlOf(db, cfg))
      if (args[0]) {
        const f = findingsRepo.byId(db, Number(args[0]))
        if (!f) {
          process.stderr.write(`no finding #${args[0]}\n`)
          return 1
        }
        process.stdout.write(JSON.stringify({ ...f, repro: JSON.parse(f.repro_json) as unknown }, null, 2) + '\n')
        return 0
      }
      for (const f of r.findings) {
        process.stdout.write(
          `#${String(f.id).padStart(3)}  ${f.kind.padEnd(10)} ${f.reproduced}/${f.attempts}  ${f.state.padEnd(6)}  ${f.title}\n`
        )
      }
      if (!r.findings.length) process.stdout.write('nothing confirmed yet\n')
      return 0
    }

    case 'recheck': {
      const cfg = loadConfig(toConfigFlags(flags, args), dir)
      const { recheck } = await import('./recheck.js')
      return recheck(cfg, Number(args[0]), logger(true))
    }

    case 'stop': {
      const f = join(shoalDir(dir), 'stop')
      writeFileSync(f, String(Date.now()))
      process.stdout.write('asked the run to stop\n')
      return 0
    }

    case 'reset': {
      const d = shoalDir(dir)
      if (flags.all) {
        rmSync(d, { recursive: true, force: true })
        process.stdout.write('cleared everything, map included\n')
        return 0
      }
      const { reset } = await import('./reset.js')
      reset(dir)
      process.stdout.write('cleared findings, suspicions and traffic. The map is still there.\n')
      return 0
    }

    case 'bench': {
      const { bench } = await import('./bench.js')
      return bench(flags)
    }

    case 'ui': {
      const cfg = loadConfig(toConfigFlags(flags, args), dir)
      const { serveOnly } = await import('./ui/server.js')
      return serveOnly(cfg)
    }

    case 'mcp': {
      const { serveMcp } = await import('./mcp/server.js')
      return serveMcp(dir)
    }

    default:
      process.stderr.write(`unknown command "${cmd}"\n\n${HELP}`)
      return 2
  }
}

function urlOf(db: ReturnType<typeof openReadOnly>, cfg: Config): string {
  const row = db.prepare('SELECT app_url FROM runs ORDER BY id DESC LIMIT 1').get() as { app_url: string } | undefined
  return row?.app_url ?? cfg.url
}

main()
  .then((code) => process.exit(code))
  .catch((e: Error) => {
    process.stderr.write(`\n${e.message}\n`)
    if (process.env.SHOAL_DEBUG) process.stderr.write(String(e.stack) + '\n')
    process.exit(1)
  })
