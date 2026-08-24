/**
 * The voyage: K actors act at once, then everyone stops and a sounding is taken.
 *
 * WAVES, NOT STREAMS. Each wave dispatches one action per actor simultaneously
 * and awaits all of them before the sweep. Two things fall out of that. The
 * requests genuinely overlap, which is the only way a race is reachable at all;
 * and every violation is pinned to a wave index, so the shrinker has a unit to
 * remove.
 *
 * COLLISION IS FORCED, NOT HOPED FOR. Left to chance, K actors picking from a
 * dozen actions over a world of forty entities almost never touch the same row
 * in the same wave, and a swarm that never collides is an expensive way to run
 * a single-threaded test. So with probability `collideRate` a wave is a
 * COLLISION WAVE: one action, one target row, every actor at once. That is the
 * generated form of the four races BBF's suite writes by hand — except it is
 * generated for every action marked collidable, including the ones nobody
 * thought to suspect.
 */
import type { Action, LogEntry, Persona, Rng, Session, Sounding, Violation, World } from './types.js'
import { pick, weighted } from './rng.js'
import type { Soundings } from './db.js'

/** Every create route here answers with the row under one of these keys. */
export function extractId(body: any): string | undefined {
  const c = body?.doc ?? body?.delivery ?? body?.customer ?? body?.payment ?? body
  return typeof c?.id === 'string' ? c.id : undefined
}

export interface VoyageOpts {
  waves: number
  collideRate: number
  soundEvery: number
  onWave?: (wave: number, log: LogEntry[]) => void
}

export interface VoyageResult {
  log: LogEntry[]
  violations: Violation[]
  serverFaults: LogEntry[]
  waves: number
}

/** One wave's worth of decisions, made before anything is dispatched. */
interface Plan {
  session: Session
  action: Action
  args: any
}

function planWave(
  rng: Rng,
  sessions: Session[],
  personas: Map<string, Persona>,
  actions: Action[],
  world: World,
  collide: boolean,
): Plan[] {
  if (collide) {
    // Everyone piles onto one action against one set of arguments.
    const candidates = actions.filter((a) => a.collidable)
    for (let attempt = 0; attempt < 6; attempt++) {
      const action = pick(rng, candidates)
      if (!action) break
      const eligible = sessions.filter((s) => action.roles.includes(s.role))
      if (eligible.length < 2) continue

      if (action.collideVariants) {
        const variants = action.collideVariants(world, rng, eligible.length)
        if (!variants || variants.length < 2) continue
        return variants
          .slice(0, eligible.length)
          .map((args, i) => ({ session: eligible[i]!, action, args }))
      }

      const args = action.pick(world, rng)
      if (args === null) continue
      return eligible.map((session) => ({ session, action, args }))
    }
  }

  const plans: Plan[] = []
  for (const session of sessions) {
    const persona = personas.get(session.persona)
    const usable = actions.filter((a) => a.roles.includes(session.role) && (persona?.bias[a.name] ?? 1) > 0)
    for (let attempt = 0; attempt < 8; attempt++) {
      const action = weighted(rng, usable, (a) => a.weight * (persona?.bias[a.name] ?? 1))
      if (!action) break
      const args = action.pick(world, rng)
      if (args === null) continue
      plans.push({ session, action, args })
      break
    }
  }
  return plans
}

export async function runVoyage(
  rng: Rng,
  sessions: Session[],
  personaList: Persona[],
  actions: Action[],
  world: World,
  soundings: Sounding[],
  db: Soundings,
  opts: VoyageOpts,
): Promise<VoyageResult> {
  const personas = new Map(personaList.map((p) => [p.name, p]))
  const log: LogEntry[] = []
  const violations: Violation[] = []
  const seen = new Set<string>()

  for (let wave = 0; wave < opts.waves; wave++) {
    const collide = rng() < opts.collideRate
    const plans = planWave(rng, sessions, personas, actions, world, collide)

    const entries = await Promise.all(
      plans.map(async (p): Promise<LogEntry> => {
        const base = { wave, session: p.session.id, persona: p.session.persona, action: p.action.name, args: p.args }
        try {
          const out = await p.action.run(p.session, p.args, world)
          const note = out.status >= 400 ? String(out.body?.error ?? '').slice(0, 120) : undefined
          return { ...base, status: out.status, ms: out.ms, produced: extractId(out.body), note }
        } catch (e: any) {
          return { ...base, status: 0, ms: 0, error: String(e?.message ?? e).slice(0, 300) }
        }
      }),
    )
    log.push(...entries)
    opts.onWave?.(wave, entries)

    if (wave % opts.soundEvery === opts.soundEvery - 1 || wave === opts.waves - 1) {
      for (const s of soundings) {
        let rows: any[]
        try {
          rows = await db.take(s.sql)
        } catch (e: any) {
          throw new Error(`sounding ${s.id} could not run: ${e.message}`)
        }
        // One violation per sounding per voyage. A broken invariant stays
        // broken for every later sweep, and reporting it forty times buries
        // everything else.
        if (rows.length && !seen.has(s.id)) {
          seen.add(s.id)
          violations.push({ sounding: s.id, title: s.title, rows: rows.slice(0, 5), atWave: wave })
        }
      }
    }
  }

  const serverFaults = log.filter((e) => e.status >= 500 || e.status === 0)
  return { log, violations, serverFaults, waves: opts.waves }
}
