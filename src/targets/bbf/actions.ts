/**
 * What an actor can do to BBF.
 *
 * `collidable` marks an action worth pointing several actors at simultaneously
 * against the same row. That flag is the generated form of the four races
 * BBF's own suite writes out by hand — the difference being that a flag can be
 * put on an action nobody suspects, which is where the next one will be.
 */
import type { Action, DocRef, Rng, World } from '../../core/types.js'
import { call } from '../../core/driver.js'
import { int, pick } from '../../core/rng.js'

const SALES_ROLES = ['SALES', 'ADMIN', 'MANAGER']
const LOGI_ROLES = ['LOGISTICS', 'MANAGER']
const ALL = ['SALES', 'ADMIN', 'LOGISTICS', 'MANAGER']

const money = (n: number) => Math.round(n * 100) / 100

/**
 * A third of documents are dated into the past.
 *
 * Documents get entered late, and a system that has been running has months of
 * them. It also puts real traffic through more than one numbering prefix,
 * which is the only way `sequence-covers-issued-numbers` says anything.
 */
function backdated(rng: Rng): { docDate?: string } {
  if (rng() > 0.34) return {}
  const days = int(rng, 20, 200)
  const d = new Date(Date.now() - days * 86_400_000)
  return { docDate: d.toISOString().slice(0, 10) }
}

/** Records a document into the world the moment the API confirms it. */
function remember(list: DocRef[], body: any) {
  const doc = body?.doc ?? body
  if (doc?.id) {
    list.push({ id: doc.id, docNo: doc.docNo ?? '', total: Number(doc.total ?? 0), status: doc.status ?? 'DRAFT' })
  }
}

const findRef = (w: World, id: string) =>
  w.quotations.find((d) => d.id === id) ?? w.invoices.find((d) => d.id === id)

/**
 * How a document moves, as the business moves it — enough to keep the swarm
 * on paths that exist. One in five picks is deliberately off the path, because
 * a request that ought to be refused is worth making.
 */
const QUOTE_NEXT: Record<string, string[]> = {
  DRAFT: ['SENT', 'SENT', 'SENT', 'VOID'],
  SENT: ['ACCEPTED', 'ACCEPTED', 'ACCEPTED', 'REJECTED', 'EXPIRED'],
  REJECTED: ['SENT'],
  EXPIRED: ['SENT'],
}
const INVOICE_NEXT: Record<string, string[]> = {
  DRAFT: ['SENT', 'SENT', 'SENT', 'VOID'],
  SENT: ['PARTIAL', 'PAID', 'VOID'],
  PARTIAL: ['PAID'],
}
/** No outward edges anywhere. A document here is finished and picking it wastes the turn. */
const TERMINAL = new Set(['VOID', 'PAID', 'CONVERTED'])
const OFF_PATH = ['DRAFT', 'VOID', 'PAID', 'CONVERTED', 'ACCEPTED']

export const actions: Action[] = [
  {
    name: 'create-customer',
    roles: SALES_ROLES,
    weight: 2,
    // `companyName`, not `name` — every create was refused with "Customer name
    // is required", which the starvation guard caught and a clean run would not
    // have.
    pick: (_w, rng) => ({
      companyName: `Shoal Customer ${int(rng, 1000, 9999)}`,
      phone: `01${int(rng, 10000000, 99999999)}`,
    }),
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
        ...backdated(rng),
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
        ...backdated(rng),
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
      // Split by type and drop the finished ones. Drawing uniformly from one
      // combined pool left quotations stalled at SENT — nothing ever reached
      // ACCEPTED, so convert-quotation was refused 26 times out of 26 and the
      // whole conversion path went untested behind a clean-looking run.
      const quotes = w.quotations.filter((d) => !TERMINAL.has(d.status))
      const invoices = w.invoices.filter((d) => !TERMINAL.has(d.status))
      const useQuote = quotes.length > 0 && (invoices.length === 0 || rng() < 0.5)
      const pool = useQuote ? quotes : invoices
      // Prefer a document already under way.
      //
      // Drawn uniformly, each of twenty documents gets picked well under twice
      // in a voyage, so almost none walks DRAFT → SENT → ACCEPTED and the
      // conversion path is never reached at all. A pipeline has to be pushed
      // along, not poked at random.
      const moving = pool.filter((d) => d.status !== 'DRAFT')
      const doc = pick(rng, moving.length && rng() < 0.75 ? moving : pool)
      if (!doc) return null
      const onPath = (useQuote ? QUOTE_NEXT : INVOICE_NEXT)[doc.status] ?? ['SENT']
      const status = rng() < 0.8 ? pick(rng, onPath) : pick(rng, OFF_PATH)
      return { id: doc.id, status }
    },
    async run(s, a, w) {
      const out = await call(s, 'PUT', `/api/sales-docs/${a.id}/status`, { status: a.status })
      if (out.status < 300) {
        const ref = findRef(w, a.id)
        if (ref) ref.status = out.body?.doc?.status ?? a.status
      }
      return out
    },
  },
  {
    name: 'convert-quotation',
    roles: SALES_ROLES,
    weight: 4,
    collidable: true,
    pick: (w, rng) => {
      // Prefer one that can actually convert; fall back to any, because a
      // refused convert is still worth issuing.
      const ready = w.quotations.filter((d) => d.status === 'ACCEPTED')
      const doc = pick(rng, ready.length ? ready : w.quotations)
      return doc ? { id: doc.id } : null
    },
    async run(s, a, w) {
      const out = await call(s, 'POST', `/api/quotations/${a.id}/convert`)
      if (out.status < 300) {
        remember(w.invoices, out.body)
        const ref = findRef(w, a.id)
        if (ref) ref.status = 'CONVERTED'
      }
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
    // Shared-resource contention, not same-row: DIFFERENT jobs, ONE window.
    // Pointing every actor at the same delivery books one job five times and
    // proves nothing about capacity.
    collideVariants: (w, rng, actors) => {
      const slotId = pick(rng, w.slots)
      const date = pick(rng, w.dates)
      if (!slotId || !date) return null
      // The tail of the list, because a delivery that has been in the world a
      // while has usually been advanced out of PLANNING by someone and can no
      // longer be booked — every scheduling call in the first run was a 400
      // for that reason, which reads as "found nothing".
      const pool = w.deliveries.slice(-14)
      const chosen: string[] = []
      while (chosen.length < actors && pool.length) {
        chosen.push(...pool.splice(Math.floor(rng() * pool.length), 1))
      }
      return chosen.length < 2 ? null : chosen.map((id) => ({ id, slotId, date }))
    },
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
    // Deliberately below create and schedule. Advancing jobs faster than they
    // are booked empties the pool of anything schedulable.
    weight: 3,
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
    // Blacking out a date while somebody is booking onto it — see the
    // blackout-vs-booking collision group, which is where the contention is
    // actually generated. On its own this only ever consumes a spare date:
    // closing one the swarm books into removes it permanently, and three of
    // those closed an entire voyage out of the delivery half of the system.
    collidable: true,
    pick: (w) => {
      const date = w.spareDates.shift()
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
     * accepted admin action is a question for the target's owner, not for the
     * swarm —
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

/**
 * Boundary actions: the edges where BBF meets something it does not control.
 *
 * Several of the production incidents across these systems came from here
 * rather than from the core — a callback that never fired, a channel that was
 * dead while the process manager showed green. The swarm cannot make Meta
 * misbehave, so it does the misbehaving itself: the same inbound message
 * delivered twice, and a document pushed to accounting by two people at once.
 */
export const boundaryActions: Action[] = [
  {
    name: 'deliver-webhook',
    // The webhook is unauthenticated by design; any actor can post it. Signed
    // requests are not required outside production, which is what makes this
    // reachable at all.
    roles: ALL,
    weight: 3,
    collidable: true,
    pick: (w, rng) => {
      // A THIRD of deliveries are re-deliveries. Meta retries, and a retry of
      // something already processed must be a no-op, not a second message and
      // not a 500.
      const replay = rng() < 0.33 ? pick(rng, w.waMessageIds) : null
      const from = `601${int(rng, 10000000, 99999999)}`
      return {
        waMessageId: replay ?? `wamid.SHOAL${int(rng, 100000, 999999)}${int(rng, 100000, 999999)}`,
        from: replay ? (w.waMessageIds.length ? from : from) : from,
        text: `Shoal enquiry ${int(rng, 1, 9999)}`,
        replay: Boolean(replay),
      }
    },
    async run(s, a, w) {
      const out = await call(s, 'POST', '/api/whatsapp/webhook', {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'shoal',
            changes: [
              {
                field: 'messages',
                value: {
                  contacts: [{ wa_id: a.from, profile: { name: `Shoal ${a.from.slice(-4)}` } }],
                  messages: [
                    {
                      id: a.waMessageId,
                      from: a.from,
                      timestamp: String(Math.floor(Date.parse('2026-08-24T00:00:00Z') / 1000)),
                      type: 'text',
                      text: { body: a.text },
                    },
                  ],
                },
              },
            ],
          },
        ],
      })
      if (out.status < 300 && !a.replay) w.waMessageIds.push(a.waMessageId)
      return out
    },
  },
  {
    name: 'push-to-autocount',
    roles: ['ADMIN', 'MANAGER'],
    weight: 2,
    // Two people pressing push on the same document. The external system has
    // no idea the other request exists.
    collidable: true,
    pick: (w, rng) => {
      const doc = pick(rng, w.invoices.filter((d) => d.status !== 'DRAFT'))
      return doc ? { id: doc.id } : null
    },
    run: (s, a) => call(s, 'POST', `/api/autocount/push/${a.id}`),
  },
]
