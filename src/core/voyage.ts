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
import type {
  Action, CollisionGroup, LogEntry, Persona, ProbeContext, Rng, Session, Sounding, Violation, World,
} from './types.js'
import { pick, weighted } from './rng.js'
import { sweepAll } from './sound.js'

/** Every create route here answers with the row under one of these keys. */
export function extractId(body: any): string | undefined {
  const c = body?.doc ?? body?.delivery ?? body?.customer ?? body?.payment ?? body
  return typeof c?.id === 'string' ? c.id : undefined
}

export interface VoyageOpts {
  waves: number
  collideRate: number
  soundEvery: number
  /** Share of collision waves given to a cross-action group, when any exist. */
  groupRate?: number
  onWave?: (wave: number, log: LogEntry[]) => void
}

export interface VoyageResult {
  log: LogEntry[]
  violations: Violation[]
  serverFaults: LogEntry[]
  waves: number
  /**
   * Actions the swarm tried repeatedly and never once completed.
   *
   * A swarm being turned away at the door is indistinguishable from a swarm
   * finding nothing, and it has now produced three false clean runs on this
   * one target. A voyage that never succeeded at booking a delivery has said
   * NOTHING about delivery booking, and must not be read as though it had.
   */
  starved: { action: string; attempts: number }[]
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
  groups: CollisionGroup[],
  groupRate: number,
): Plan[] {
  if (collide && groups.length && rng() < groupRate) {
    // A cross-action contention. Each item names its own action, so the actors
    // are assigned per item rather than all doing the same thing.
    const group = pick(rng, groups)
    const items = group?.build(world, rng, sessions.length)
    if (items && items.length >= 2) {
      const free = [...sessions]
      const plans: Plan[] = []
      for (const item of items) {
        const action = actions.find((a) => a.name === item.action)
        if (!action) continue
        const idx = free.findIndex((s) => action.roles.includes(s.role))
        if (idx === -1) continue
        plans.push({ session: free.splice(idx, 1)[0]!, action, args: item.args })
      }
      if (plans.length >= 2) return plans
    }
  }

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
  ctx: ProbeContext,
  opts: VoyageOpts,
  groups: CollisionGroup[] = [],
): Promise<VoyageResult> {
  const personas = new Map(personaList.map((p) => [p.name, p]))
  const log: LogEntry[] = []
  const violations: Violation[] = []
  const seen = new Set<string>()

  for (let wave = 0; wave < opts.waves; wave++) {
    const collide = rng() < opts.collideRate
    const plans = planWave(rng, sessions, personas, actions, world, collide, groups, opts.groupRate ?? 0.4)

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
      // One violation per sounding per voyage. A broken invariant stays broken
      // for every later sweep, and reporting it forty times buries everything
      // else.
      for (const v of await sweepAll(soundings, ctx, wave)) {
        if (seen.has(v.sounding)) continue
        seen.add(v.sounding)
        violations.push(v)
      }
    }
  }

  const serverFaults = log.filter((e) => e.status >= 500 || e.status === 0)

  const attempts = new Map<string, { n: number; ok: number }>()
  for (const e of log) {
    const a = attempts.get(e.action) ?? { n: 0, ok: 0 }
    a.n++
    if (e.status >= 200 && e.status < 300) a.ok++
    attempts.set(e.action, a)
  }
  const starved = [...attempts.entries()]
    .filter(([, a]) => a.n >= 5 && a.ok === 0)
    .map(([action, a]) => ({ action, attempts: a.n }))

  return { log, violations, serverFaults, waves: opts.waves, starved }
}
