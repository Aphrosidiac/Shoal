/**
 * A worked example of a target. Read this before writing your own.
 *
 * It describes an imaginary ordering system — customers, orders, payments —
 * and does not run against anything. It is here to show the shape and the
 * reasoning, both of which matter more than the code.
 *
 * A target is a plugin. Nothing in `src/` imports it; the CLI loads it by path
 * at runtime. Keep yours beside the system it describes rather than in this
 * repository, and point `--target` at it.
 */
import type { Action, Persona, Session, Sounding, World } from '../../src/core/types.js'
import { defineTarget, httpAction } from '../../src/target/define.js'
import { required } from '../../src/core/config.js'
import { call } from '../../src/core/driver.js'
import { int, pick } from '../../src/core/rng.js'
import { listingMatchesCount, pagingIsStable, roleGating } from '../../src/soundings/index.js'

/** Your own nouns. The engine's `World` is an open bag; this says what is in it. */
interface ExampleWorld extends World {
  customers: string[]
  orders: { id: string; total: number }[]
}

/**
 * Personas are OPERATIONAL, not demographic.
 *
 * Role, competence, intent, environment and tenure change which code runs.
 * "Ahmad, 34, likes coffee" does not. `instances` is how many simultaneous
 * sessions this login runs — two tabs is an ordinary way for a person to work,
 * and contention is bounded by how many actors can legally reach an action.
 */
const personas = (domain: string): Persona[] => [
  { name: 'clerk', email: `clerk@${domain}`, role: 'STAFF', instances: 3, bias: { 'take-payment': 2 } },
  { name: 'manager', email: `manager@${domain}`, role: 'MANAGER', bias: {} },
]

const actions: Action<any, ExampleWorld>[] = [
  httpAction<{ name: string }, ExampleWorld>({
    name: 'create-customer',
    roles: ['STAFF', 'MANAGER'],
    weight: 2,
    pick: (_w, rng) => ({ name: `Example ${int(rng, 1000, 9999)}` }),
    request: (a) => ['POST', '/api/customers', a],
    remembers: (body, _a, w) => body?.id && w.customers.push(body.id),
  }),
  httpAction<{ customerId: string; amount: number }, ExampleWorld>({
    name: 'create-order',
    roles: ['STAFF', 'MANAGER'],
    weight: 5,
    // Returning null means "not applicable yet" — a turn spent elsewhere, not
    // a failure. Without any customers there is nothing to order for.
    pick: (w, rng) => {
      const customerId = pick(rng, w.customers)
      return customerId ? { customerId, amount: int(rng, 100, 5000) } : null
    },
    request: (a) => ['POST', '/api/orders', a],
    remembers: (body, _a, w) => body?.id && w.orders.push({ id: body.id, total: Number(body.total ?? 0) }),
  }),
  httpAction<{ id: string; amount: number }, ExampleWorld>({
    name: 'take-payment',
    roles: ['STAFF', 'MANAGER'],
    weight: 6,
    // `collidable` points several actors at the SAME row at once. This is the
    // shape that finds "two people paid the same order and one payment
    // vanished". For contention over a scarce shared resource — different rows
    // competing for one booking slot — use `collideVariants` instead, or the
    // wave books one job five times and proves nothing.
    collidable: true,
    pick: (w, rng) => {
      const order = pick(rng, w.orders)
      return order && order.total > 0 ? { id: order.id, amount: Math.round(order.total / 2) } : null
    },
    request: (a) => ['POST', `/api/orders/${a.id}/payments`, { amount: a.amount }],
  }),
]

/**
 * The soundings, and the whole point of the tool.
 *
 * Write every `because` from what is true of the BUSINESS. An invariant
 * extracted from the implementation encodes the implementation's bugs and then
 * agrees with them for ever. If you cannot write that sentence without reading
 * the source, the sounding is not ready.
 *
 * A SQL sounding returns the rows that VIOLATE it; empty is a pass.
 */
const soundings: Sounding[] = [
  {
    id: 'paid-matches-payments',
    title: 'the paid figure equals the sum of the payment rows',
    because:
      'The payments table is the record of money actually received; the cached figure is a copy ' +
      'of it. When they disagree, either a customer is chased for money they have paid, or the ' +
      'books show money nobody sent.',
    sql: `
      SELECT o.id, o.paid_amount, COALESCE(SUM(p.amount), 0) AS payments_total
        FROM orders o LEFT JOIN payments p ON p.order_id = o.id
       GROUP BY o.id, o.paid_amount
      HAVING ABS(o.paid_amount - COALESCE(SUM(p.amount), 0)) > 0.005`,
  },
  // Structural rules come from the library rather than being written again.
  roleGating({
    routes: [{ path: '/api/reports', allow: (s: Session) => s.role === 'MANAGER' }],
  }),
  pagingIsStable({ path: '/api/orders?limit={limit}&page={page}', itemsKey: 'orders' }),
  listingMatchesCount({ path: '/api/orders?limit=1', sql: 'SELECT COUNT(*)::int AS n FROM orders' }),
]

export default defineTarget<ExampleWorld>((cfg) => ({
  name: 'example',
  root: cfg.root,
  password: required(cfg, 'password'),
  // Cloned once into the template, then re-created before every voyage. The
  // target's own database is never touched.
  sourceDb: 'example',
  workDb: 'example_shoal',
  templateDb: 'example_shoal_tpl',
  port: 3920,
  // Without these a voyage sails over an empty world and reports calm.
  requiresWorld: ['customers'],
  personas: personas(required(cfg, 'emailDomain')),
  actions,
  soundings,
  /** Weights for the seasoning waves: build depth, do not probe. */
  seasonBias: { 'create-customer': 3, 'create-order': 3, 'take-payment': 2 },
  /**
   * Reads the starting world back off the API.
   *
   * Must run as an ungated role. A 403 during setup looks exactly like an
   * empty system, and a swarm that cannot see anything finds nothing while
   * reporting clear water.
   */
  async survey(s: Session): Promise<ExampleWorld> {
    const out = await call(s, 'GET', '/api/customers?limit=100')
    const list = Array.isArray(out.body?.customers) ? out.body.customers : []
    return { customers: list.map((c: any) => c.id).filter(Boolean), orders: [] }
  },
}))
