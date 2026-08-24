/**
 * Misbehaving at the edges.
 *
 * A large share of the production incidents behind this tool came from the
 * boundary rather than the core: a callback delivered twice, a channel that
 * was dead while the process manager showed green, a payment confirmation that
 * never arrived at all. None of it is reachable by driving the system's own
 * routes politely, because the system is not the one behaving badly.
 *
 * So the swarm behaves badly on the boundary's behalf. Four faults, each
 * corresponding to something a real provider does:
 *
 *   fresh      — an ordinary event, the control
 *   duplicate  — the same event again, because every provider retries and a
 *                retry of something already processed must be a no-op
 *   late       — an event stamped well in the past, arriving after newer ones
 *   malformed  — a truncated payload, which must be a 4xx and never a 5xx
 *
 * What is NOT here, and cannot be: an event that never arrives. Absence is not
 * something an action can send. It is tested by a SOUNDING instead — "anything
 * that reached the gateway is reconciled within an hour" — which only the
 * target can write, because only the target knows what the fallback is. If
 * your system depends on a callback firing, that sounding is the most valuable
 * one you will write, and its absence is why nobody notices for six weeks.
 */
import type { Action, Rng, World } from '../core/types.js'
import { call } from '../core/driver.js'
import { pick } from '../core/rng.js'

export type Fault = 'fresh' | 'duplicate' | 'late' | 'malformed'

export interface WebhookSpec<W extends World> {
  name?: string
  /** Where the provider posts. Usually unauthenticated, so any actor may send. */
  path: string
  roles: string[]
  weight: number
  /**
   * Builds one event. `id` is the provider's own identifier for it, and
   * `at` is when the event claims to have happened.
   */
  event(args: { id: string; at: Date; rng: Rng }): unknown
  /** World collection holding ids already delivered, so one can be re-sent. */
  delivered: string
  /** Share of deliveries given to each fault. The remainder are fresh. */
  faults?: Partial<Record<Exclude<Fault, 'fresh'>, number>>
  /** Signature or provider headers, computed over the body. */
  headers?(body: unknown): Record<string, string>
}

// Malformed is weighted highest of the three. It is the cheapest to send and
// the only one that tests a specific rule rather than a behaviour: a bad
// payload from a provider is the provider's fault and must be a 4xx. A 5xx
// there is the server blaming itself for someone else's mistake, and it is how
// a retry storm starts.
const DEFAULT_FAULTS = { duplicate: 0.25, late: 0.15, malformed: 0.2 }

/**
 * Cuts a payload down to something structurally wrong but plausible.
 *
 * Deliberately not random bytes. A provider does not send noise; it sends a
 * truncated or partially-populated object when something upstream went wrong,
 * and that is what tends to reach a handler that assumed the field was there.
 */
function truncate(body: any): unknown {
  if (Array.isArray(body)) return body.slice(0, Math.max(0, body.length - 1)).map(truncate)
  if (body && typeof body === 'object') {
    const keys = Object.keys(body)
    const out: any = {}
    for (const k of keys.slice(0, Math.max(1, keys.length - 1))) out[k] = truncate(body[k])
    return out
  }
  return body
}

export function webhookAction<W extends World = World>(spec: WebhookSpec<W>): Action<any, W> {
  const rates = { ...DEFAULT_FAULTS, ...spec.faults }

  /**
   * Picks a fault by cumulative share.
   *
   * Written out rather than accumulated in the conditions, because the first
   * version only advanced the running total INSIDE an `if` that was skipped
   * whenever nothing had been delivered yet — so early in a voyage every
   * threshold sat lower than intended and the mix was not the one configured.
   * A skewed distribution is invisible in a summary; it just quietly tests one
   * thing less than you asked for.
   */
  const chooseFault = (rng: Rng, canDuplicate: boolean): Fault => {
    const weights: [Fault, number][] = [
      ['duplicate', canDuplicate ? rates.duplicate : 0],
      ['late', rates.late],
      ['malformed', rates.malformed],
    ]
    const r = rng()
    let seen = 0
    for (const [fault, share] of weights) {
      seen += share
      if (r < seen) return fault
    }
    return 'fresh'
  }

  return {
    name: spec.name ?? 'deliver-webhook',
    roles: spec.roles,
    weight: spec.weight,
    // Two copies of one retry landing together is the case the unique
    // constraint is supposed to cover and the find-or-create above it usually
    // is not.
    collidable: true,
    pick: (w, rng) => {
      const already = (w[spec.delivered] ?? []) as string[]
      const fault = chooseFault(rng, already.length > 0)
      const id =
        fault === 'duplicate'
          ? (pick(rng, already) as string)
          : `evt_${Math.floor(rng() * 1e9).toString(36)}${Math.floor(rng() * 1e9).toString(36)}`
      if (!id) return null
      // A late event claims to have happened before things already processed.
      const at = fault === 'late' ? new Date(Date.UTC(2026, 0, 1 + Math.floor(rng() * 60))) : new Date(0)
      return { id, fault, at: at.toISOString() }
    },
    async run(session, args, world) {
      const body = spec.event({ id: args.id, at: new Date(args.at), rng: () => 0.5 })
      const payload = args.fault === 'malformed' ? truncate(body) : body
      const out = await call(session, 'POST', spec.path, payload)

      // Only a delivery that was accepted AND was not already known counts as
      // one that can later be re-sent.
      if (out.status >= 200 && out.status < 300 && args.fault !== 'duplicate' && args.fault !== 'malformed') {
        // Written through `World` rather than `W`: a generic world is
        // read-only to the compiler, and the collection is the target's own.
        const bag = world as World
        const list = (bag[spec.delivered] ??= []) as string[]
        list.push(args.id)
      }
      return out
    },
  }
}

/**
 * The sounding a webhook-dependent system needs and usually does not have.
 *
 * Shoal cannot inject a missing callback, so it cannot find this for you. What
 * it can do is hold you to the rule once you have written it: anything handed
 * to an external system must reach a settled state on its own, without the
 * callback, within a stated time. A system that only settles when the provider
 * calls back has no answer for the day the provider does not.
 */
export const MISSING_CALLBACK_NOTE = `
Write a sounding of this shape for anything that waits on an external callback:

  SELECT id FROM <things awaiting confirmation>
   WHERE handed_to_provider_at < now() - interval '1 hour'
     AND status = '<still waiting>'

If the only thing that moves that row is the provider's callback, this is the
sounding that tells you the day it stops arriving — and it will.
`
