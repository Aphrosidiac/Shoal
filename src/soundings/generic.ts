/**
 * Soundings that hold for any system, not just one.
 *
 * The distinction that runs through this whole tool: some rules come from the
 * BUSINESS and some come from the SHAPE of a system. "Payments sum to the
 * figure on the invoice" is the first kind — nobody can write it for you, and
 * it is where most of the value is. "Walking a paged list sees every row
 * exactly once" is the second kind, and there is no reason for every target to
 * write it again.
 *
 * These are the second kind. They are parameterised, not hardcoded: give one a
 * route and a key and it works against anything. A new target gets a real
 * instrument on the first day, and the domain invariants are what you add
 * afterwards.
 */
import type { ProbeContext, ProbeSounding, SqlSounding } from '../core/types.js'
import { call } from '../core/driver.js'

const rowsOf = (body: any, key: string): any[] => {
  const arr = body?.[key] ?? body?.items ?? body?.data ?? body
  return Array.isArray(arr) ? arr : []
}

/**
 * Walking a paged list sees every row exactly once.
 *
 * The commonest way this fails is an ORDER BY on a column that is not unique,
 * paged with OFFSET. The database is free to order tied rows differently for
 * each page, so one row appears twice and another appears on no page at all —
 * and every request answers 200 with a full-looking page. A row that is on no
 * page is, for anyone working from that list, a row that does not exist.
 *
 * Needs enough data to page. Run seasoning, or this passes vacuously.
 */
export function pagingIsStable(opts: {
  /** Path with `{limit}` and `{page}` placeholders. */
  path: string
  /** Key holding the array in the response body. */
  itemsKey: string
  /** Key holding the grand total in the response body. */
  totalKey?: string
  /** Field that identifies a row, for spotting repeats. */
  idField?: string
  /** Field to print in the evidence, if more readable than the id. */
  labelField?: string
  pageSize?: number
  maxPages?: number
  id?: string
}): ProbeSounding {
  const size = opts.pageSize ?? 5
  const totalKey = opts.totalKey ?? 'total'
  const idField = opts.idField ?? 'id'
  return {
    kind: 'probe',
    id: opts.id ?? `paging-is-stable:${opts.path.split('?')[0]}`,
    title: `walking ${opts.path.split('?')[0]} sees every row exactly once`,
    because:
      'A list longer than one page is read by paging through it. If the pages overlap, a row is ' +
      'worked twice; if they leave a gap, one is never seen at all — and either way every page ' +
      'answers 200 and looks complete.',
    async take(ctx: ProbeContext) {
      const at = (page: number) => opts.path.replace('{limit}', String(size)).replace('{page}', String(page))
      const head = await call(ctx.surveyor, 'GET', at(1))
      if (head.status !== 200) return [{ problem: 'the list itself failed', status: head.status }]

      const total = Number(head.body?.[totalKey] ?? 0)
      if (total <= size) return []

      const seen = new Map<string, number>()
      const pages = Math.min(Math.ceil(total / size), opts.maxPages ?? 8)
      // Kept so a violation carries the pages themselves. Counts alone —
      // "expected 40, saw 38" — leave nothing to diagnose and no way to tell an
      // unstable sort from a mistake in the check.
      const walk: string[] = []

      for (let page = 1; page <= pages; page++) {
        const out = await call(ctx.surveyor, 'GET', at(page))
        const items = rowsOf(out.body, opts.itemsKey)
        walk.push(`p${page}: ${items.map((d: any) => d[opts.labelField ?? idField]).join(' ')}`)
        for (const d of items) seen.set(String(d[idField]), (seen.get(String(d[idField])) ?? 0) + 1)
      }

      const expected = Math.min(total, pages * size)
      const repeated = [...seen.entries()].filter(([, n]) => n > 1)
      if (!repeated.length && seen.size >= expected) return []

      return [
        {
          problem: repeated.length ? 'a row appeared on more than one page' : 'the pages do not add up',
          total,
          pageSize: size,
          pagesWalked: pages,
          expectedDistinct: expected,
          distinctSeen: seen.size,
          walk,
        },
      ]
    },
  }
}

/** A list's reported total matches what the table actually holds. */
export function listingMatchesCount(opts: {
  path: string
  totalKey?: string
  /** Counts the rows the list is supposed to be showing. */
  sql: string
  id?: string
}): ProbeSounding {
  const totalKey = opts.totalKey ?? 'total'
  return {
    kind: 'probe',
    id: opts.id ?? `listing-matches-count:${opts.path.split('?')[0]}`,
    title: `${opts.path.split('?')[0]} counts what the table holds`,
    because:
      'A list showing fewer rows than exist hides work from whoever reads it, and reports no ' +
      'problem while doing so.',
    async take(ctx: ProbeContext) {
      const counted = (await ctx.sql(opts.sql)) as { n: number }[]
      const n = counted[0]?.n ?? 0
      const out = await call(ctx.surveyor, 'GET', opts.path)
      if (out.status !== 200) return [{ problem: 'the list failed', status: out.status }]
      const reported = Number(out.body?.[totalKey] ?? NaN)
      return Number.isFinite(reported) && reported === n ? [] : [{ database: n, listReported: out.body?.[totalKey] ?? null }]
    },
  }
}

/**
 * Every actor reaches exactly the routes their role allows, and no others.
 *
 * Checked in BOTH directions on purpose. A route answered for someone who was
 * never granted it is a leak; a refusal for someone who was is a person locked
 * out of their own job, which gets reported as "the system is broken" and never
 * as a permissions bug.
 */
export function roleGating(opts: {
  routes: { path: string; allow(session: { role: string; id: string }): boolean }[]
  /** Status the target refuses with. */
  denyStatus?: number
  id?: string
}): ProbeSounding {
  const deny = opts.denyStatus ?? 403
  return {
    kind: 'probe',
    id: opts.id ?? 'role-gating-holds',
    title: 'a role reaches exactly the routes it was granted',
    because:
      'Permissions are the only thing standing between one job and another. Both directions ' +
      'matter: an open door nobody noticed, and a locked one nobody reports as a permissions bug.',
    async take(ctx: ProbeContext) {
      const bad: any[] = []
      for (const s of ctx.sessions.values()) {
        for (const r of opts.routes) {
          const allowed = r.allow(s)
          const out = await call(s, 'GET', r.path)
          if (allowed && out.status === deny) {
            bad.push({ actor: s.id, role: s.role, path: r.path, expected: 'granted', got: out.status })
          }
          if (!allowed && out.status !== deny) {
            bad.push({ actor: s.id, role: s.role, path: r.path, expected: deny, got: out.status })
          }
        }
      }
      return bad
    },
  }
}

/**
 * Fields that must stop changing once a row reaches a certain state.
 *
 * A rule about CHANGE, which no single query can see, so the probe remembers
 * what it saw on an earlier sweep and compares. Snapshots on a sent document
 * are the usual case: they are a record of what was agreed and to whom, and
 * editing the source record afterwards must not reach back and rewrite them.
 */
export function frozenAfter(opts: {
  /** Selects the frozen rows: an id, a label, and the fields being watched. */
  sql: string
  idField?: string
  labelField?: string
  fields: string[]
  id?: string
  title?: string
  because?: string
}): ProbeSounding {
  const idField = opts.idField ?? 'id'
  return {
    kind: 'probe',
    id: opts.id ?? 'fields-are-frozen',
    title: opts.title ?? 'a row that has gone out never has these fields rewritten',
    because:
      opts.because ??
      'These fields are a record of what was true when the row was issued. Changing them ' +
        'afterwards silently rewrites history, and nothing anywhere reports it.',
    async take(ctx: ProbeContext) {
      const now = (await ctx.sql(opts.sql)) as Record<string, any>[]
      const bad: any[] = []
      for (const row of now) {
        const key = `frozen:${opts.id ?? 'default'}:${row[idField]}`
        const before = ctx.memory.get(key) as Record<string, any> | undefined
        if (!before) {
          ctx.memory.set(key, row)
          continue
        }
        for (const field of opts.fields) {
          if (before[field] !== row[field]) {
            bad.push({ row: row[opts.labelField ?? idField], field, was: before[field], now: row[field] })
          }
        }
      }
      return bad
    },
  }
}

/**
 * A cached figure equals the rows it is a cache of.
 *
 * Extracted, not designed. It was written by hand three times against three
 * unrelated systems before it earned this: an invoice's paid amount against
 * its payment rows, twice under two different column names, and a discount
 * code's use count against the orders that used it. The shape is always the
 * same — a number kept on the parent so a list can be drawn without a join,
 * and a set of child rows that is the actual truth.
 *
 * It is worth having because the failure is silent and the cache is what
 * every screen reads. It is also, in practice, where the concurrency bugs
 * are: a cache updated from a read that another transaction has already
 * invalidated is the single commonest defect this tool has found.
 */
export function cachedAggregateMatchesRows(opts: {
  id?: string
  title: string
  because: string
  /** Table holding the cached figure. */
  parent: string
  /** The cached column, quoted as your schema spells it. */
  cached: string
  /** Table holding the truth. */
  child: string
  /** Column on the child pointing at the parent. */
  foreignKey: string
  /** Column to sum, or omit to count rows. */
  sum?: string
  /** Extra condition on the child rows, without the WHERE. */
  where?: string
  /** How far apart the two may drift before it counts. Default one hundredth. */
  tolerance?: number
  /** A readable identifier for the parent, for the evidence. */
  label?: string
}): SqlSounding {
  const q = (name: string) => (name.includes('"') ? name : `"${name}"`)
  const agg = opts.sum ? `COALESCE(SUM(c.${q(opts.sum)}), 0)` : 'COUNT(c.id)'
  const label = opts.label ? `p.${q(opts.label)},` : ''
  const filter = opts.where ? ` AND (${opts.where})` : ''
  return {
    id: opts.id ?? `cache-matches-rows:${opts.parent}.${opts.cached}`,
    title: opts.title,
    because: opts.because,
    sql: `
      SELECT p.id, ${label} p.${q(opts.cached)} AS cached, ${agg} AS actual
        FROM ${q(opts.parent)} p
        LEFT JOIN ${q(opts.child)} c ON c.${q(opts.foreignKey)} = p.id${filter}
       GROUP BY p.id, ${label} p.${q(opts.cached)}
      HAVING ABS(p.${q(opts.cached)} - ${agg}) > ${opts.tolerance ?? 0.005}`,
  }
}

/**
 * No row points at a parent that is not there.
 *
 * Reads the foreign keys out of the catalogue, so it needs no configuration and
 * grows with the schema.
 *
 * Be clear about when this is worth having. Where the database enforces the
 * keys itself, it can never fire and is a vacuous pass — Prisma's default, and
 * most Rails and Django setups. It earns its place where relations are declared
 * in the ORM but NOT in the database: Prisma's `relationMode = "prisma"`,
 * PlanetScale and Vitess, sharded schemas, and anything where a migration
 * dropped a constraint nobody replaced. `doctor` reports how many keys it
 * found, so a zero is visible rather than quietly reassuring.
 */
export function noOrphanedRows(opts?: { schema?: string; id?: string }): ProbeSounding {
  const schema = opts?.schema ?? 'public'
  return {
    kind: 'probe',
    id: opts?.id ?? 'no-orphaned-rows',
    title: 'no row points at a parent that is not there',
    because:
      'A reference to something that does not exist is a record nobody can open, and it is ' +
      'usually discovered by whoever tries.',
    async take(ctx: ProbeContext) {
      const keys = (await ctx.sql(`
        SELECT tc.table_name AS child, kcu.column_name AS child_col,
               ccu.table_name AS parent, ccu.column_name AS parent_col
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = '${schema}'
      `)) as { child: string; child_col: string; parent: string; parent_col: string }[]

      const bad: any[] = []
      for (const k of keys) {
        const found = (await ctx.sql(`
          SELECT COUNT(*)::int AS n
            FROM "${k.child}" c
            LEFT JOIN "${k.parent}" p ON p."${k.parent_col}" = c."${k.child_col}"
           WHERE c."${k.child_col}" IS NOT NULL AND p."${k.parent_col}" IS NULL
        `)) as { n: number }[]
        if ((found[0]?.n ?? 0) > 0) {
          bad.push({ table: k.child, column: k.child_col, pointingAt: `${k.parent}.${k.parent_col}`, orphans: found[0]?.n })
        }
      }
      return bad
    },
  }
}
