/**
 * Start the target against Shoal's own database, and wait until it answers.
 *
 * The target is NOT started through its own `npm run dev`. That script passes
 * `--env-file`, and whether a file value beats an inherited one has changed
 * between Node versions — so a voyage would sometimes run against the app's
 * real development database without saying so. Shoal reads the .env itself,
 * overrides DATABASE_URL and PORT, and hands the result to tsx directly. The
 * database a voyage points at is never in doubt.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function readDotEnv(path: string): Record<string, string> {
  let raw = ''
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return {}
  }
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m || line.trimStart().startsWith('#')) continue
    let v = (m[2] ?? '').trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1] as string] = v
  }
  return out
}

/**
 * Wait until the port is (or is not) answering.
 *
 * `expectOpen: false` is the one that matters: it is the difference between a
 * clean restart and a health check answered by the corpse of the last one.
 */
async function waitForPort(port: number, expectOpen: boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    let open = false
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1000),
      })
      open = res.ok
    } catch {
      open = false
    }
    if (open === expectOpen) return
    if (Date.now() > deadline) {
      throw new Error(`port ${port} is still ${open ? 'in use' : 'closed'} after ${timeoutMs}ms`)
    }
    await new Promise((r) => setTimeout(r, 200))
  }
}

export interface Booted {
  proc: ChildProcess
  stop: () => Promise<void>
  /** Everything the target wrote, kept for the crash sounding. */
  stderr: string[]
}

export async function bootTarget(opts: {
  root: string
  entry: string
  port: number
  databaseUrl: string
  quiet?: boolean
}): Promise<Booted> {
  const env = {
    ...process.env,
    ...readDotEnv(join(opts.root, '.env')),
    DATABASE_URL: opts.databaseUrl,
    PORT: String(opts.port),
    NODE_ENV: 'development',
    // A voyage must never reach a real customer. These are the outbound
    // channels on the systems here; blanking them makes the agent fall back to
    // handing the message to a person, which is a no-op in a simulation.
    OPENROUTER_API_KEY: '',
    WHATSAPP_ACCESS_TOKEN: '',
    AUTOCOUNT_USE_MOCK: 'true',
  }

  const stderr: string[] = []
  // Detached, so the whole process group can be killed together.
  //
  // `npx tsx` is a wrapper around a node child. SIGTERM to the wrapper leaves
  // the child holding the port, and the NEXT boot's health check is answered
  // by the previous target — which is by then pointed at a database the reset
  // has dropped. It presents as a 500 on login, minutes into a reduction, and
  // says nothing about ports.
  const proc = spawn('npx', ['tsx', opts.entry], {
    cwd: opts.root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  const keep = (chunk: Buffer) => {
    const s = chunk.toString()
    stderr.push(s)
    if (stderr.length > 4000) stderr.splice(0, 2000)
    if (!opts.quiet) process.stderr.write(s)
  }
  proc.stdout?.on('data', keep)
  proc.stderr?.on('data', keep)

  await waitForPort(opts.port, false, 15_000)

  const deadline = Date.now() + 60_000
  for (;;) {
    if (proc.exitCode !== null) {
      throw new Error(`target exited (${proc.exitCode}) before it answered:\n${stderr.slice(-12).join('')}`)
    }
    try {
      const res = await fetch(`http://127.0.0.1:${opts.port}/api/health`)
      if (res.ok) break
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error('target did not answer /api/health within 60s')
    await new Promise((r) => setTimeout(r, 250))
  }

  const killGroup = (signal: NodeJS.Signals) => {
    try {
      if (proc.pid) process.kill(-proc.pid, signal)
    } catch {
      /* already gone */
    }
  }

  const stop = async () => {
    if (proc.exitCode === null) {
      await new Promise<void>((resolve) => {
        proc.once('exit', () => resolve())
        killGroup('SIGTERM')
        setTimeout(() => {
          killGroup('SIGKILL')
          resolve()
        }, 4000).unref()
      })
    }
    // Waiting on the process is not enough — the port is what the next boot
    // collides with, so wait on the port.
    await waitForPort(opts.port, false, 10_000)
  }

  return { proc, stop, stderr }
}
