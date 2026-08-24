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
import type { Persona, Session, Target, World } from '../../core/types.js'
import { call } from '../../core/driver.js'
import { actions } from './actions.js'
import { soundings } from './soundings.js'

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

/** Weekday date keys a fortnight out, in Malaysia's sense of a date. */
function upcomingDates(count: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let offset = 3; out.length < count && offset < 40; offset++) {
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
    quotations: [],
    invoices: [],
    deliveries: [],
  }
}

export const bbf: Target = {
  name: 'bbf',
  root: join(homedir(), 'Desktop/dev/BBFSystem/backend'),
  sourceDb: 'bbfsystem',
  workDb: 'bbfsystem_shoal',
  templateDb: 'bbfsystem_shoal_tpl',
  port: 3915,
  personas,
  actions,
  soundings,
  survey,
}

export const password = PASSWORD
