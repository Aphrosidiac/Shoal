/**
 * BBFSystem — Big Brain's back office. The first target.
 *
 * Chosen because two of its races are already documented and fixed, so the
 * question "does this instrument work" has a known answer: point a voyage at
 * the commit before each fix and see whether it finds the bug WITHOUT being
 * told what to look for. See README, "Proving the instrument".
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CollisionGroup, Persona, Session, Target, World } from '../../core/types.js'
import { call } from '../../core/driver.js'
import { pick } from '../../core/rng.js'
import { actions, boundaryActions } from './actions.js'
import { soundings } from './soundings.js'
import { uiProbe } from './probes-ui.js'

const PASSWORD = '<moved to shoal.local.json>'

/**
 * Operational personas, not demographic ones.
 *
 * A persona is worth having only when it reaches different code. Two salespeople
 * in different showrooms is a real axis here — the documents they create
 * contend for the same numbering sequence. "Ahmad, 34, likes coffee" is not.
 */
export const personas: Persona[] = [
  {
    name: 'sales-jb',
    email: 'dus@<target domain>',
    role: 'SALES',
    bias: { 'create-quotation': 2, 'convert-quotation': 1.5, 'create-delivery': 0 },
  },
  {
    name: 'sales-pj',
    email: 'pjs@<target domain>',
    role: 'SALES',
    // The other showroom, quoting into the same month prefix at the same time.
    bias: { 'create-quotation': 2, 'record-payment': 0.5 },
  },
  {
    name: 'office',
    email: 'office@<target domain>',
    role: 'ADMIN',
    // The one who takes the money in. Heaviest on payments by design.
    bias: { 'record-payment': 3, 'create-invoice': 1.5, 'edit-doc-lines': 1.5, 'create-quotation': 0.3 },
  },
  {
    name: 'planner',
    email: 'logistics@<target domain>',
    role: 'LOGISTICS',
    // Four tabs. With one, a collision wave for a delivery window musters two
    // actors against a capacity of four and the window cannot be overbooked
    // however hard the swarm tries.
    instances: 4,
    bias: { 'schedule-delivery': 3, 'create-delivery': 2.5, 'add-blackout': 0.6 },
  },
  {
    name: 'manager',
    email: 'admin@<target domain>',
    role: 'MANAGER',
    // Ungated, and therefore the only actor who can reach both halves of the
    // system in one wave.
    bias: {},
  },
]

/** Tolerates the three list shapes the modules return. */
function ids(body: any, key: string): string[] {
  const arr = Array.isArray(body) ? body : (body?.[key] ?? body?.items ?? body?.data ?? [])
  return Array.isArray(arr) ? arr.map((x: any) => x?.id).filter(Boolean) : []
}

/** Weekday date keys ahead of today, in Malaysia's sense of a date. */
function upcomingDates(count: number, startOffset = 3): string[] {
  const out: string[] = []
  const now = new Date()
  for (let offset = startOffset; out.length < count && offset < 90; offset++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset))
    if (d.getUTCDay() === 0) continue // the slots seeded here do not run Sundays
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

export async function survey(s: Session): Promise<World> {
  const [customers, products, resources] = await Promise.all([
    call(s, 'GET', '/api/customers?limit=100'),
    call(s, 'GET', '/api/products?limit=100'),
    call(s, 'GET', '/api/logistics/resources'),
  ])
  const slots = ids(resources.body?.slots ?? resources.body, 'slots')
  return {
    customers: ids(customers.body, 'customers'),
    products: ids(products.body, 'products'),
    slots,
    // Three dates, not thirty. A swarm spread over a month of the calendar
    // never books the same window twice and never finds a capacity bug.
    dates: upcomingDates(3),
    // Well clear of the bookable three, so closing one cannot starve the
    // swarm of somewhere to deliver.
    spareDates: upcomingDates(20, 30),
    quotations: [],
    invoices: [],
    deliveries: [],
    waMessageIds: [],
  }
}

/**
 * Contentions between DIFFERENT actions.
 *
 * A collision wave of one action repeated cannot generate these. Closing a
 * delivery date and booking onto it are two count-then-write operations
 * against two different tables, and each passes its own check while the other
 * is still uncommitted — which is why BBF's fix keys its lock on the DATE
 * rather than on the window.
 */
const collisionGroups: CollisionGroup[] = [
  {
    name: 'blackout-vs-booking',
    build(w, rng, actors) {
      // A date of its own, consumed. The race needs a blackout and a booking
      // on the SAME date; it does not need that date to be one the rest of the
      // swarm depends on.
      const date = w.spareDates.shift()
      const slotId = pick(rng, w.slots)
      if (!date || !slotId) return null
      // Recent jobs only — an older one has usually been advanced out of
      // PLANNING by another actor and can no longer be booked.
      const pool = w.deliveries.slice(-14)
      if (pool.length < 2) return null

      const items: { action: string; args: any }[] = [{ action: 'add-blackout', args: { date, reason: 'Shoal closure' } }]
      const wanted = Math.max(2, Math.min(actors - 1, 4))
      const taken = new Set<string>()
      while (taken.size < wanted && taken.size < pool.length) {
        taken.add(pool[Math.floor(rng() * pool.length)]!)
      }
      for (const id of taken) items.push({ action: 'schedule-delivery', args: { id, slotId, date } })
      return items
    },
  },
]

/**
 * Weights for the seasoning waves.
 *
 * Build, do not probe. Reads are pointless when nothing is watching, and
 * anything that voids, cancels or closes would spend the phase destroying what
 * it is meant to be accumulating.
 */
const seasonBias: Record<string, number> = {
  'create-customer': 3,
  'create-quotation': 3,
  'create-invoice': 3,
  'create-delivery': 3,
  'record-payment': 2,
  'advance-doc-status': 2,
  'schedule-delivery': 2,
  'deliver-webhook': 2,
  'convert-quotation': 1,
  'edit-doc-lines': 0.5,
  'advance-delivery-status': 0.5,
  'add-blackout': 0,
  'push-to-autocount': 0,
  'read-availability': 0,
  'read-dashboard': 0,
  'read-invoices': 0,
}

export const bbf: Target = {
  name: 'bbf',
  root: join(homedir(), 'Desktop/dev/BBFSystem/backend'),
  sourceDb: 'bbfsystem',
  workDb: 'bbfsystem_shoal',
  templateDb: 'bbfsystem_shoal_tpl',
  port: 3915,
  web: { root: join(homedir(), 'Desktop/dev/BBFSystem/frontend'), port: 5915 },
  personas,
  actions: [...actions, ...boundaryActions],
  soundings,
  collisionGroups,
  seasonBias,
  uiProbe: ({ url }) => uiProbe({ url, email: 'admin@<target domain>', password: PASSWORD, enabled: true }),
  survey,
}

export const password = PASSWORD
