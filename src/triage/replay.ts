/**
 * Re-run a recorded log against a fresh database.
 *
 * REPLAY IS NOT DETERMINISTIC AND DOES NOT PRETEND TO BE. The seed fixes every
 * choice Shoal makes about what to do; it has no say in the order the target's
 * event loop, its connection pool and Postgres serve those requests in. A race
 * that showed up once may not show up next time.
 *
 * So a replay answers "did it reproduce" rather than "is it identical", and
 * everything built on top — the shrinker especially — asks for several
 * attempts and treats one reproduction out of N as a yes. A race that
 * reproduces one time in five is still a race.
 *
 * Identifiers are rewritten on the way through. The seeded rows come from the
 * template and keep their ids, but anything a voyage created is a fresh uuid
 * on every run, so each entry's `produced` id is mapped to whatever the replay
 * produced in its place and every later argument is rewritten through that map.
 */
import type { Action, LogEntry, Session, World } from '../core/types.js'
import { extractId } from '../core/voyage.js'

function rewrite<T>(value: T, map: Map<string, string>): T {
  if (typeof value === 'string') return (map.get(value) ?? value) as T
  if (Array.isArray(value)) return value.map((v) => rewrite(v, map)) as T
  if (value && typeof value === 'object') {
    const out: any = {}
    for (const [k, v] of Object.entries(value)) out[k] = rewrite(v, map)
    return out
  }
  return value
}

export async function replayLog(
  log: LogEntry[],
  sessions: Map<string, Session>,
  actions: Map<string, Action>,
  world: World,
): Promise<void> {
  const map = new Map<string, string>()
  const waves = new Map<number, LogEntry[]>()
  for (const e of log) {
    const list = waves.get(e.wave)
    if (list) list.push(e)
    else waves.set(e.wave, [e])
  }

  for (const wave of [...waves.keys()].sort((a, b) => a - b)) {
    const entries = waves.get(wave)!
    // Dispatched together, exactly as they were the first time. Replaying a
    // wave sequentially would remove the only condition the bug needs.
    const results = await Promise.all(
      entries.map(async (e) => {
        const action = actions.get(e.action)
        const session = sessions.get(e.session)
        if (!action || !session) return undefined
        try {
          const out = await action.run(session, rewrite(e.args, map), world)
          return { original: e.produced, replayed: extractId(out.body) }
        } catch {
          return undefined
        }
      }),
    )
    for (const r of results) {
      if (r?.original && r.replayed) map.set(r.original, r.replayed)
    }
  }
}
