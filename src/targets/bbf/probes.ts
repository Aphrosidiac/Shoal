/**
 * Probe soundings for BBF: rules the database cannot answer on its own.
 *
 * Everything in `soundings.ts` reads the state the system ended in. These ask
 * the system questions and check the answers — against each other, against the
 * database, and against what the same actor was told last time. That reaches
 * three things a table cannot show:
 *
 *   · a 200 with an empty body, which is not an error anywhere
 *   · a page answered for a role that was never granted it
 *   · a value that CHANGED when it was supposed to be frozen
 *
 * Note what is deliberately absent. Documents here record a showroom but the
 * listings do not filter by it, so a salesperson seeing another showroom's
 * quotations is how BBF is built, not a leak. A sounding for a rule the
 * business does not have is a false finding, and false findings are how an
 * instrument stops being read.
 */
import type { ProbeContext, ProbeSounding } from '../../core/types.js'
import { call } from '../../core/driver.js'

/** Straight from the target's seed. MANAGER bypasses the list entirely. */
const PAGES_BY_ROLE: Record<string, string[] | null> = {
  MANAGER: null,
  ADMIN: ['dashboard', 'customers', 'products', 'quotations', 'invoices', 'autocount', 'reports', 'knowledge'],
  SALES: ['dashboard', 'customers', 'products', 'quotations', 'invoices', 'whatsapp'],
  LOGISTICS: ['dashboard', 'customers', 'logistics'],
}

/**
 * ANY of the listed pages opens the route, because `requirePage` takes a list.
 *
 * The first version of this gave each route one page and reported SALES
 * reaching /api/knowledge/docs as a leak. It is not: the guard is
 * `requirePage('knowledge', 'whatsapp')` and SALES has whatsapp, because the
 * agent answers customers out of the knowledge base and cannot do that behind
 * a door its operator may not open. The rule was mine and it was wrong.
 */
const GATED_ROUTES: { path: string; pages: string[] }[] = [
  { path: '/api/quotations?limit=1', pages: ['quotations'] },
  { path: '/api/invoices?limit=1', pages: ['invoices'] },
  { path: '/api/logistics/deliveries?limit=1', pages: ['logistics'] },
  { path: '/api/products?limit=1', pages: ['products'] },
  { path: '/api/knowledge/docs', pages: ['knowledge', 'whatsapp'] },
  { path: '/api/autocount/status', pages: ['autocount'] },
]

const rows = (body: any, key: string): any[] => {
  const arr = body?.[key] ?? body?.items ?? body
  return Array.isArray(arr) ? arr : []
}

export const probes: ProbeSounding[] = [
  {
    kind: 'probe',
    id: 'role-gating-holds',
    title: 'a role reaches exactly the pages it was granted',
    because:
      'Permissions are the only thing standing between a salesperson and the delivery plan, or a ' +
      'driver and the invoice book. Checked in BOTH directions: a page answered for someone who ' +
      'was never granted it is a leak, and a 403 for someone who was is a person locked out of ' +
      'their own job, which is reported as "the system is broken" and never as a permissions bug.',
    async take(ctx: ProbeContext) {
      const bad: any[] = []
      for (const s of ctx.sessions.values()) {
        // An unknown role is not a pass. If the seed grows a role Shoal has
        // never heard of, saying nothing about it is the wrong answer.
        if (!(s.role in PAGES_BY_ROLE)) {
          bad.push({ actor: s.id, role: s.role, problem: 'no page list known for this role' })
          continue
        }
        const pages = PAGES_BY_ROLE[s.role] ?? null
        for (const r of GATED_ROUTES) {
          const allowed = pages === null || r.pages.some((p) => pages.includes(p))
          const out = await call(s, 'GET', r.path)
          if (allowed && out.status === 403) {
            bad.push({ actor: s.id, role: s.role, path: r.path, needs: r.pages, expected: 'granted', got: 403 })
          }
          if (!allowed && out.status !== 403) {
            bad.push({ actor: s.id, role: s.role, path: r.path, needs: r.pages, expected: 403, got: out.status })
          }
        }
      }
      return bad
    },
  },
  {
    kind: 'probe',
    id: 'date-range-is-a-union',
    title: 'a date range contains every day inside it',
    because:
      'Asking for a fortnight must return everything that asking for each of its days returns. ' +
      'It needs no knowledge of the right answer, only that the parts add up — which is the only ' +
      'kind of check that catches a list quietly returning less than it should. A filter that ' +
      'drops rows renders as an empty table, answers 200, and logs nothing.',
    async take(ctx: ProbeContext) {
      const dates = [...ctx.world.dates].sort()
      const first = dates[0]
      const last = dates[dates.length - 1]
      if (!first || !last || first === last) return []

      const whole = await call(ctx.surveyor, 'GET', `/api/logistics/deliveries?from=${first}&to=${last}&limit=200`)
      if (whole.status !== 200) return [{ problem: 'the range query itself failed', status: whole.status }]
      const inWhole = new Set(rows(whole.body, 'deliveries').map((d: any) => d.id))

      const missing: any[] = []
      for (const day of dates) {
        const one = await call(ctx.surveyor, 'GET', `/api/logistics/deliveries?from=${day}&to=${day}&limit=200`)
        for (const d of rows(one.body, 'deliveries')) {
          if (!inWhole.has(d.id)) {
            missing.push({ delivery: d.deliveryNo ?? d.id, onDay: day, range: `${first}..${last}` })
          }
        }
      }
      return missing
    },
  },
  {
    kind: 'probe',
    id: 'listing-agrees-with-the-books',
    title: 'the invoice list counts what the invoice table holds',
    because:
      'The list is where the money is chased from. If it shows fewer invoices than exist, the ' +
      'missing ones are simply never collected, and nothing anywhere reports a problem.',
    async take(ctx: ProbeContext) {
      const counted = (await ctx.sql(
        `SELECT COUNT(*)::int AS n FROM sales_docs WHERE type = 'INVOICE'`,
      )) as { n: number }[]
      const n = counted[0]?.n ?? 0
      const out = await call(ctx.surveyor, 'GET', '/api/invoices?limit=1')
      if (out.status !== 200) return [{ problem: 'the invoice list failed', status: out.status }]
      const reported = Number(out.body?.total ?? NaN)
      return Number.isFinite(reported) && reported === n
        ? []
        : [{ database: n, listReported: out.body?.total ?? null }]
    },
  },
  {
    kind: 'probe',
    id: 'sent-documents-print',
    title: 'anything that has gone to a customer can still be printed',
    because:
      'A sent document is a promise, and the PDF is the form the customer holds. One that will ' +
      'not render is discovered by a salesperson in front of a customer, not by a test.',
    async take(ctx: ProbeContext) {
      const docs = (await ctx.sql(
        `SELECT id, doc_no FROM sales_docs WHERE status <> 'DRAFT' ORDER BY created_at DESC LIMIT 5`,
      )) as { id: string; doc_no: string }[]
      const bad: any[] = []
      for (const d of docs) {
        const out = await call(ctx.surveyor, 'GET', `/api/sales-docs/${d.id}/pdf`)
        const looksLikePdf = typeof out.body?.raw === 'string' && out.body.raw.startsWith('%PDF')
        if (out.status !== 200 || !looksLikePdf) {
          bad.push({ doc: d.doc_no, status: out.status, startsWith: String(out.body?.raw ?? '').slice(0, 12) })
        }
      }
      return bad
    },
  },
  {
    kind: 'probe',
    id: 'paging-does-not-lose-or-repeat',
    title: 'walking the pages sees every document exactly once',
    because:
      'A list longer than one page is read by paging through it. If the pages overlap, a document ' +
      'is worked twice; if they leave a gap, one is never seen at all — and either way every page ' +
      'answers 200 and looks complete. This only bites once there is enough data to page, which ' +
      'is what the seasoning waves are for.',
    async take(ctx: ProbeContext) {
      const size = 5
      const head = await call(ctx.surveyor, 'GET', `/api/invoices?limit=${size}&page=1`)
      if (head.status !== 200) return [{ problem: 'the invoice list failed', status: head.status }]
      const total = Number(head.body?.total ?? 0)
      if (total <= size) return []

      const seen = new Map<string, number>()
      const pages = Math.min(Math.ceil(total / size), 8)
      // Kept so a violation carries the pages themselves.
      //
      // The first version reported only counts — "expected 40, saw 38" — and
      // when it tripped there was nothing to diagnose and no way to tell an
      // unstable sort from a mistake in the probe. A finding that cannot be
      // read is barely better than no finding.
      const walk: { page: number; docNos: string[] }[] = []
      for (let page = 1; page <= pages; page++) {
        const out = await call(ctx.surveyor, 'GET', `/api/invoices?limit=${size}&page=${page}`)
        const docs = rows(out.body, 'docs')
        walk.push({ page, docNos: docs.map((d: any) => d.docNo ?? d.id) })
        for (const d of docs) seen.set(d.id, (seen.get(d.id) ?? 0) + 1)
      }

      const repeated = [...seen.entries()].filter(([, n]) => n > 1)
      const expected = Math.min(total, pages * size)
      if (!repeated.length && seen.size >= expected) return []

      const dupes = new Set(
        walk.flatMap((p) => p.docNos).filter((n, i, a) => a.indexOf(n) !== i),
      )
      return [
        {
          problem: repeated.length ? 'a document appeared on more than one page' : 'the pages do not add up',
          total,
          pageSize: size,
          pagesWalked: pages,
          expectedDistinct: expected,
          distinctSeen: seen.size,
          onTwoPages: [...dupes],
          // The order the list came back in, so an unstable sort is visible
          // rather than inferred.
          walk: walk.map((p) => `p${p.page}: ${p.docNos.join(' ')}`),
        },
      ]
    },
  },
  {
    kind: 'probe',
    id: 'snapshots-are-frozen',
    title: 'a document that has gone out never has its details rewritten',
    because:
      'The customer name and address on a sent document are a record of what was agreed and to ' +
      'whom. Editing the customer record afterwards must not reach back and change it, or the ' +
      'system quietly loses an argument about what was sent. No single query can see this — it ' +
      'is a rule about change, so the probe remembers what it saw and compares.',
    async take(ctx: ProbeContext) {
      const now = (await ctx.sql(
        `SELECT id, doc_no, customer_name, COALESCE(address, '') AS address, COALESCE(phone, '') AS phone
           FROM sales_docs WHERE status NOT IN ('DRAFT')`,
      )) as Record<string, string>[]

      const bad: any[] = []
      for (const row of now) {
        const key = `snapshot:${row.id}`
        const before = ctx.memory.get(key) as Record<string, string> | undefined
        if (!before) {
          ctx.memory.set(key, row)
          continue
        }
        for (const field of ['customer_name', 'address', 'phone'] as const) {
          if (before[field] !== row[field]) {
            bad.push({ doc: row.doc_no, field, was: before[field], now: row[field] })
          }
        }
      }
      return bad
    },
  },
]
