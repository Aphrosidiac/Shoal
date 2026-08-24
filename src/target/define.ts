/**
 * Writing a target.
 *
 * A target is a plugin, not part of Shoal. It says what the system under test
 * is, how to act on it, and what must be true of it — and it lives wherever
 * makes sense, usually beside the system it describes rather than in this
 * repository.
 *
 * The engine never imports a target. The CLI loads one by path at runtime, so
 * adding a system means writing one directory and touching nothing here.
 */
import type { Action, Outcome, Rng, Session, Target, World } from '../core/types.js'
import type { TargetConfig } from '../core/config.js'
import { call } from '../core/driver.js'

export type TargetFactory<W extends World = any> = (cfg: TargetConfig) => Target<W> | Promise<Target<W>>

/**
 * Declares a target. The factory receives the target's entry from
 * shoal.local.json, so paths and credentials never reach the source.
 */
export function defineTarget<W extends World = any>(factory: TargetFactory<W>): TargetFactory<W> {
  return factory
}

/**
 * A world made of the collections you name.
 *
 * There is no default set. The engine used to ship one — customers, invoices,
 * delivery windows — which meant every target inherited another system's nouns
 * whether or not they meant anything to it.
 */
export function world<W extends Record<string, any[]>>(collections: W): W {
  return collections
}

/**
 * An action defined as a request rather than as a function.
 *
 * Most actions are "choose some arguments, send one request, remember what came
 * back". Written out longhand that is six lines of identical plumbing per
 * route, and the plumbing is where the mistakes hide — a forgotten `await`, a
 * response recorded on a failure. Say what the request is instead.
 */
export function httpAction<A, W extends World = World>(spec: {
  name: string
  roles: string[]
  weight: number
  collidable?: boolean
  /** Arguments for this turn, or null when the action does not apply yet. */
  pick(w: W, rng: Rng): A | null
  /** Same, for a collision wave that needs one shared resource and different rows. */
  collideVariants?(w: W, rng: Rng, actors: number): A[] | null
  /** The request to send. */
  request(args: A): [method: string, path: string, body?: unknown]
  /** Runs only on a 2xx, to fold the result back into the world. */
  remembers?(body: any, args: A, w: W): void
}): Action<A, W> {
  return {
    name: spec.name,
    roles: spec.roles,
    weight: spec.weight,
    ...(spec.collidable ? { collidable: true } : {}),
    ...(spec.collideVariants ? { collideVariants: spec.collideVariants } : {}),
    pick: spec.pick,
    async run(session: Session, args: A, world: W): Promise<Outcome> {
      const [method, path, body] = spec.request(args)
      const out = await call(session, method, path, body)
      if (out.status >= 200 && out.status < 300) spec.remembers?.(out.body, args, world)
      return out
    },
  }
}
