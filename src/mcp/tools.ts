import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openReadOnly, shoalDir } from '../store/db.js'
import { build } from '../report/build.js'
import { text } from '../report/render.js'
import * as findingsRepo from '../store/repo/findings.js'
import * as map from '../store/repo/map.js'
import { currentRun } from '../store/repo/run.js'
import { assertLocal } from '../config.js'

export type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }

const ok = (s: string): ToolResult => ({ content: [{ type: 'text', text: s }] })
const bad = (s: string): ToolResult => ({ content: [{ type: 'text', text: s }], isError: true })

export const TOOLS = [
  {
    name: 'shoal_start',
    description:
      'Start Shoal against a localhost app. It signs itself up, maps the app, hammers it and reports what breaks. ' +
      'Returns immediately; the run continues in the background until shoal_stop.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'the app under test, e.g. http://localhost:3000' },
        dir: { type: 'string', description: 'where to keep .shoal/ (defaults to the current directory)' },
        explorers: { type: 'number' },
        hammerers: { type: 'number' },
        for: { type: 'string', description: 'how long to run, e.g. 30m or 24h. Omit to run until stopped.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'shoal_status',
    description: 'Coverage, frontier size, spend, and whether it is still running.',
    inputSchema: { type: 'object', properties: { dir: { type: 'string' } }, required: [], additionalProperties: false },
  },
  {
    name: 'shoal_findings',
    description: 'Confirmed findings, worst first. Each one has reproduced against the app before it appears here.',
    inputSchema: {
      type: 'object',
      properties: { dir: { type: 'string' }, limit: { type: 'number' } },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'shoal_finding',
    description: 'One finding in full, with the shortest sequence of requests that still reproduces it.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number' }, dir: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'shoal_map',
    description: 'What Shoal knows about the app: screens, endpoints and forms, untouched things first.',
    inputSchema: { type: 'object', properties: { dir: { type: 'string' } }, required: [], additionalProperties: false },
  },
  {
    name: 'shoal_recheck',
    description: 'Re-run one finding against the app as it is right now. Use this after fixing something.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number' }, dir: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'shoal_stop',
    description: 'Stop the run. Everything stays on disk and shoal_start picks it up again.',
    inputSchema: { type: 'object', properties: { dir: { type: 'string' } }, required: [], additionalProperties: false },
  },
] as const

const where = (args: Record<string, unknown>): string => String(args.dir ?? process.cwd())

export async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const dir = where(args)
  try {
    switch (name) {
      case 'shoal_start': {
        const url = String(args.url ?? '')
        assertLocal(url)
        const argv = ['run', url]
        for (const k of ['explorers', 'hammerers'] as const) if (args[k] !== undefined) argv.push(`--${k}`, String(args[k]))
        if (args.for !== undefined) argv.push('--for', String(args.for))
        const child = spawn(process.execPath, [...selfArgs(), ...argv], {
          cwd: dir,
          detached: true,
          stdio: 'ignore',
        })
        child.unref()
        return ok(`Shoal is running against ${url} in ${dir}. Ask for shoal_status in a few minutes, or wait — confirmed findings are pushed here as they are found.`)
      }

      case 'shoal_status': {
        const db = openReadOnly(dir)
        const r = build(db, appUrl(dir))
        const run = currentRun(db, r.appUrl)
        const alive = Date.now() - (run?.last_seen_at ?? 0) < 30_000
        const c = r.coverage
        return ok(
          [
            `${r.appUrl}  ${alive ? 'running' : 'stopped'}`,
            `screens ${c.pagesExplored}/${c.pages} explored, endpoints ${c.endpointsHammered}/${c.writeEndpoints} writes hammered`,
            `accounts ${c.accounts}${r.tenancy ? ` (${r.tenancy})` : ''}, requests ${c.recordings}, actions ${c.actions}`,
            `findings ${r.findings.filter((f) => f.state === 'open').length} confirmed, ${r.unconfirmed.length} unconfirmed`,
            `model calls ${r.spend.calls} (${r.spend.perAction.toFixed(2)} per action), $${r.spend.usd.toFixed(2)}`,
            r.starved.length ? `STARVED: ${r.starved.map((s) => `${s.action} ${s.ok}/${s.tries}`).join('; ')}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        )
      }

      case 'shoal_findings': {
        const db = openReadOnly(dir)
        const r = build(db, appUrl(dir))
        const limit = Number(args.limit ?? 25)
        if (!r.findings.length) return ok('Nothing confirmed yet.')
        return ok(
          r.findings
            .slice(0, limit)
            .map((f) => `#${f.id}  ${f.kind.padEnd(10)} ${f.reproduced}/${f.attempts}  ${f.state.padEnd(6)}  ${f.title}`)
            .join('\n')
        )
      }

      case 'shoal_finding': {
        const db = openReadOnly(dir)
        const f = findingsRepo.byId(db, Number(args.id))
        if (!f) return bad(`No finding #${String(args.id)}.`)
        const repro = JSON.parse(f.repro_json) as { steps?: Array<Record<string, unknown>>; detail?: string }
        return ok(
          [
            `#${f.id}  ${f.kind.toUpperCase()}  ${f.title}`,
            `reproduced ${f.reproduced}/${f.attempts}, seen ${f.occurrences} times, ${f.reach} steps from signup, state ${f.state}`,
            '',
            repro.detail ?? '',
            '',
            ...(repro.steps ?? []).map(
              (s, i) => `${i + 1}  ${String(s.method ?? '')} ${String(s.path ?? '')}${s.as ? `  as ${String(s.as)}` : ''}  ${String(s.status ?? '')}${s.note ? `  <- ${String(s.note)}` : ''}`
            ),
          ].join('\n')
        )
      }

      case 'shoal_map': {
        const db = openReadOnly(dir)
        const lines: string[] = []
        for (const p of map.pages(db)) lines.push(`${p.explored ? ' ' : '*'} ${p.url_pattern}  ${p.visits} visits`)
        lines.push('')
        for (const e of map.endpoints(db)) lines.push(`${e.hammered ? ' ' : '*'} ${e.method} ${e.path_pattern}  ${e.calls} calls  ${e.statuses_json}`)
        return ok(lines.join('\n') || 'Nothing mapped yet.')
      }

      case 'shoal_recheck': {
        const out = await new Promise<string>((resolve) => {
          const child = spawn(process.execPath, [...selfArgs(), 'recheck', String(args.id)], { cwd: dir })
          let buf = ''
          child.stdout.on('data', (d) => (buf += String(d)))
          child.stderr.on('data', (d) => (buf += String(d)))
          child.on('close', () => resolve(buf))
        })
        return ok(out.trim() || 'nothing came back')
      }

      case 'shoal_stop': {
        writeFileSync(join(shoalDir(dir), 'stop'), String(Date.now()))
        return ok('Asked the run to stop. Everything stays on disk.')
      }

      default:
        return bad(`No tool called ${name}.`)
    }
  } catch (e) {
    return bad((e as Error).message)
  }
}

export function reportText(dir: string): string {
  const db = openReadOnly(dir)
  return text(build(db, appUrl(dir)))
}

function appUrl(dir: string): string {
  if (!existsSync(join(shoalDir(dir), 'run.db'))) throw new Error(`No run in ${dir}. Start one with shoal_start.`)
  const db = openReadOnly(dir)
  const row = db.prepare('SELECT app_url FROM runs ORDER BY id DESC LIMIT 1').get() as { app_url: string } | undefined
  if (!row) throw new Error(`No run in ${dir}. Start one with shoal_start.`)
  return row.app_url
}

/**
 * Re-run ourselves the way we were run. Under tsx that means keeping the
 * loader flags, or the child is plain node being handed a TypeScript file.
 */
export function selfArgs(): string[] {
  return [...process.execArgv, process.argv[1]!]
}
