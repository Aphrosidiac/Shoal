/**
 * What an actor can do to BBF.
 *
 * `collidable` marks an action worth pointing several actors at simultaneously
 * against the same row. That flag is the generated form of the four races
 * BBF's own suite writes out by hand — the difference being that a flag can be
 * put on an action nobody suspects, which is where the next one will be.
 */
import type { Action, DocRef, World } from '../../core/types.js'
import { call } from '../../core/driver.js'
import { int, pick } from '../../core/rng.js'

const SALES_ROLES = ['SALES', 'ADMIN', 'MANAGER']
const LOGI_ROLES = ['LOGISTICS', 'MANAGER']
const ALL = ['SALES', 'ADMIN', 'LOGISTICS', 'MANAGER']

const money = (n: number) => Math.round(n * 100) / 100

/** Records a document into the world the moment the API confirms it. */
function remember(list: DocRef[], body: any) {
  const doc = body?.doc ?? body
  if (doc?.id) list.push({ id: doc.id, docNo: doc.docNo ?? '', total: Number(doc.total ?? 0) })
}

export const actions: Action[] = [
  {
    name: 'create-customer',
    roles: SALES_ROLES,
    weight: 2,
    pick: (_w, rng) => ({ name: `Shoal Customer ${int(rng, 1000, 9999)}`, phone: `01${int(rng, 10000000, 99999999)}` }),
    async run(s, args, w) {
      const out = await call(s, 'POST', '/api/customers', args)
      const id = out.body?.customer?.id ?? out.body?.id
      if (id) w.customers.push(id)
      return out
    },
  },
  {
    name: 'create-quotation',
    roles: SALES_ROLES,
    weight: 6,
    pick: (w, rng) => {
      const customerId = pick(rng, w.customers)
      if (!customerId) return null
      const lines = int(rng, 1, 3)
      return {
        customerId,
        items: Array.from({ length: lines }, (_, i) => ({
          description: `Shoal line ${i + 1}`,
          qty: int(rng, 1, 4),
          unitPrice: money(int(rng, 100, 4000)),
        })),
      }
    },
    async run(s, args, w) {
      const out = await call(s, 'POST', '/api/quotations', args)
      if (out.status < 300) remember(w.quotations, out.body)
      return out
    },
  },
  {
    name: 'create-invoice',
    roles: SALES_ROLES,
    weight: 5,
    pick: (w, rng) => {
      const customerId = pick(rng, w.customers)
      if (!customerId) return null
      return {
        customerId,
        items: [{ description: 'Shoal direct sale', qty: int(rng, 1, 3), unitPrice: money(int(rng, 200, 3000)) }],
      }
    },
    async run(s, args, w) {
      const out = await call(s, 'POST', '/api/invoices', args)
      if (out.status < 300) remember(w.invoices, out.body)
      return out
    },
  },
  {
    name: 'edit-doc-lines',
    roles: SALES_ROLES,
    weight: 3,
    // Editing while someone else is paying or converting is the ordinary way a
    // total and its lines come apart.
    collidable: true,
    pick: (w, rng) => {
      const doc = pick(rng, [...w.quotations, ...w.invoices])
      if (!doc) return null
      return {
        id: doc.id,
        items: Array.from({ length: int(rng, 1, 3) }, (_, i) => ({
          description: `Shoal revised ${i + 1}`,
          qty: int(rng, 1, 5),
          unitPrice: money(int(rng, 50, 2500)),
        })),
      }
    },
    run: (s, a) => call(s, 'PUT', `/api/sales-docs/${a.id}`, { items: a.items }),
  },
  {
    name: 'advance-doc-status',
    roles: SALES_ROLES,
    weight: 6,
    collidable: true,
    pick: (w, rng) => {
      const doc = pick(rng, [...w.quotations, ...w.invoices])
      if (!doc) return null
      const status = pick(rng, ['SENT', 'ACCEPTED', 'SENT', 'REJECTED', 'EXPIRED', 'VOID'])
      return { id: doc.id, status }
    },
    run: (s, a) => call(s, 'PUT', `/api/sales-docs/${a.id}/status`, { status: a.status }),
  },
  {
    name: 'convert-quotation',
    roles: SALES_ROLES,
    weight: 4,
    collidable: true,
    pick: (w, rng) => {
      const doc = pick(rng, w.quotations)
      return doc ? { id: doc.id } : null
    },
    async run(s, a, w) {
      const out = await call(s, 'POST', `/api/quotations/${a.id}/convert`)
      if (out.status < 300) remember(w.invoices, out.body)
      return out
    },
  },
  {
    name: 'record-payment',
    roles: SALES_ROLES,
    weight: 8,
    // The one that mattered: five concurrent RM200 payments against a RM1000
    // invoice once produced five payment rows and an invoice claiming RM400.
    collidable: true,
    pick: (w, rng) => {
      const doc = pick(rng, w.invoices)
      if (!doc || !(doc.total > 0)) return null
      // A half-payment is the interesting size. Two of them settle the
      // invoice; two of them landing together should still settle it exactly
      // once, and each actor's own read says there is room.
      const fraction = pick(rng, [0.5, 0.5, 0.25, 1])!
      return { id: doc.id, amount: money(doc.total * fraction) }
    },
    run: (s, a) =>
      call(s, 'POST', `/api/invoices/${a.id}/payments`, { amount: a.amount, method: 'BANK_TRANSFER' }),
  },
  {
    name: 'create-delivery',
    roles: LOGI_ROLES,
    weight: 5,
    pick: (w, rng) => {
      const customerId = pick(rng, w.customers)
      if (!customerId) return null
      return {
        customerId,
        address: `Shoal address ${int(rng, 1, 400)}, Johor Bahru`,
        items: [{ description: 'Shoal delivery line', qty: int(rng, 1, 3) }],
      }
    },
    async run(s, args, w) {
      const out = await call(s, 'POST', '/api/logistics/deliveries', args)
      const id = out.body?.delivery?.id ?? out.body?.id
      if (id) w.deliveries.push(id)
      return out
    },
  },
  {
    name: 'schedule-delivery',
    roles: LOGI_ROLES,
    weight: 9,
    // Availability is a read and races the booking. The capacity re-check
    // inside the transaction is what stands between this and an overbooked
    // window; a collision wave is the only thing that exercises it.
    collidable: true,
    pick: (w, rng) => {
      const id = pick(rng, w.deliveries)
      const slotId = pick(rng, w.slots)
      const date = pick(rng, w.dates)
      if (!id || !slotId || !date) return null
      return { id, slotId, date }
    },
    run: (s, a) =>
      call(s, 'POST', `/api/logistics/deliveries/${a.id}/schedule`, { date: a.date, slotId: a.slotId }),
  },
  {
    name: 'advance-delivery-status',
    roles: LOGI_ROLES,
    weight: 6,
    collidable: true,
    pick: (w, rng) => {
      const id = pick(rng, w.deliveries)
      if (!id) return null
      const status = pick(rng, ['DISPATCHED', 'DELIVERED', 'FAILED', 'PLANNING', 'CANCELLED'])!
      return { id, status }
    },
    run: (s, a) =>
      call(s, 'PUT', `/api/logistics/deliveries/${a.id}/status`, {
        status: a.status,
        ...(a.status === 'FAILED' ? { failReason: 'Shoal probe' } : {}),
      }),
  },
  {
    name: 'add-blackout',
    roles: LOGI_ROLES,
    weight: 2,
    // Blacking out a date while somebody is booking onto it.
    collidable: true,
    pick: (w, rng) => {
      const date = pick(rng, w.dates)
      return date ? { date, reason: 'Shoal blackout' } : null
    },
    run: (s, a) => call(s, 'POST', '/api/logistics/blackouts', a),
  },
  {
    name: 'read-availability',
    roles: LOGI_ROLES,
    weight: 3,
    pick: (w, rng) => {
      const date = pick(rng, w.dates)
      return date ? { date } : null
    },
    run: (s, a) => call(s, 'GET', `/api/logistics/availability?from=${a.date}&to=${a.date}`),
  },
  {
    name: 'read-dashboard',
    roles: ALL,
    weight: 2,
    pick: () => ({}),
    run: (s) => call(s, 'GET', '/api/dashboard'),
  },
  {
    name: 'read-invoices',
    roles: SALES_ROLES,
    weight: 2,
    pick: () => ({}),
    run: (s) => call(s, 'GET', '/api/invoices?limit=50'),
  },
  {
    /**
     * PARKED at weight 0, on purpose.
     *
     * Shrinking a window's capacity below what is already booked leaves an
     * overbooked window with no race involved at all, so it trips
     * `slot-capacity` on almost every voyage and buries the findings that
     * needed concurrency to produce. Whether that is a defect in BBF or an
     * accepted admin action is a question for Fakhrul, not for the swarm —
     * turn it on with `--include parked` once the rest is quiet.
     */
    name: 'shrink-slot-capacity',
    roles: LOGI_ROLES,
    weight: 0,
    pick: (w, rng) => {
      const slotId = pick(rng, w.slots)
      return slotId ? { slotId } : null
    },
    run: (s, a) => call(s, 'PUT', `/api/logistics/slots/${a.slotId}`, { capacity: 1 }),
  },
]
