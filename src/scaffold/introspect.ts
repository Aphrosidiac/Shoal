/**
 * Reads the schema out of Postgres, and proposes soundings from its shape.
 *
 * The catalogue is exact where a source scan is a guess, so anything derivable
 * from it is derived from it. What comes back is not a set of checks — it is a
 * set of QUESTIONS for a person, because the shape of a schema can suggest that
 * a rule exists and can never say what the rule means.
 *
 * The distinction matters more here than anywhere else in this tool. A sounding
 * generated from a schema is derived from the implementation, and a check
 * derived from the implementation agrees with the implementation's bugs for
 * ever. So these arrive commented out, with the `because` blank, and refuse to
 * be useful until somebody writes the sentence.
 */
import { Client } from 'pg'

export interface Column {
  table: string
  name: string
  type: string
  nullable: boolean
}

export interface ForeignKey {
  child: string
  childColumn: string
  parent: string
}

export interface Candidate {
  kind: 'cached-aggregate' | 'arithmetic' | 'non-negative' | 'unique-under-load'
  table: string
  /**
   * How much the schema's shape actually suggests this.
   *
   * A cached figure has no way of announcing which child table it counts, so
   * every foreign key pointing at the parent is a candidate and most are
   * nonsense. Ranking by name is crude and it is honest: `customers.totalOrders`
   * against `orders` is worth reading, against `whatsapp_contacts` is not.
   */
  confidence: 'likely' | 'possible'
  detail: string
  /** Draft to paste in once a person has written the reason. */
  draft: string
}

export interface Introspection {
  tables: string[]
  columns: Column[]
  foreignKeys: ForeignKey[]
  uniques: { table: string; column: string }[]
  candidates: Candidate[]
}

export async function introspect(connectionString: string): Promise<Introspection> {
  const c = new Client({ connectionString })
  await c.connect()
  try {
    const cols = await c.query(`
      SELECT table_name, column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name NOT LIKE '\\_%'
       ORDER BY table_name, ordinal_position`)
    const fks = await c.query(`
      SELECT tc.table_name AS child, kcu.column_name AS child_column, ccu.table_name AS parent
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`)
    const uniq = await c.query(`
      SELECT tc.table_name AS table, kcu.column_name AS column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
       WHERE tc.constraint_type = 'UNIQUE' AND tc.table_schema = 'public'`)

    const columns: Column[] = cols.rows.map((r: any) => ({
      table: r.table_name,
      name: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable === 'YES',
    }))
    const foreignKeys: ForeignKey[] = fks.rows.map((r: any) => ({
      child: r.child,
      childColumn: r.child_column,
      parent: r.parent,
    }))
    const uniques = uniq.rows.map((r: any) => ({ table: r.table, column: r.column }))
    const tables = [...new Set(columns.map((c) => c.table))]

    return { tables, columns, foreignKeys, uniques, candidates: propose(columns, foreignKeys, uniques) }
  } finally {
    await c.end()
  }
}

const NUMERIC = /^(numeric|integer|bigint|double precision|real|smallint|decimal)$/
const q = (n: string) => (/[A-Z]/.test(n) ? `"${n}"` : n)

function propose(columns: Column[], fks: ForeignKey[], uniques: { table: string; column: string }[]): Candidate[] {
  const out: Candidate[] = []
  const byTable = new Map<string, Column[]>()
  for (const c of columns) byTable.set(c.table, [...(byTable.get(c.table) ?? []), c])

  for (const [table, cols] of byTable) {
    const names = new Set(cols.map((c) => c.name))
    const children = fks.filter((f) => f.parent === table)

    // A cached figure beside the rows it is a cache of. Written by hand three
    // times across three systems under three names before it was worth
    // detecting, and in all three the check found real money missing.
    for (const col of cols) {
      if (!NUMERIC.test(col.type)) continue
      if (!/^(paid|used|total|amount|balance|count|qty|quantity|stock)/i.test(col.name)) continue
      if (/^(total|amount)$/i.test(col.name) && names.has('subtotal')) continue // that is arithmetic, below
      // Strip the cache-y prefix: `totalOrders` is asking about orders.
      const stem = col.name.replace(/^(total|used|paid|amount|count|num)/i, '').toLowerCase()
      const ranked = children
        .map((child) => {
          const c = child.child.toLowerCase()
          let score = 0
          if (stem && c === stem) score += 3
          if (stem && c.includes(stem.replace(/s$/, ''))) score += 2
          if (c.startsWith(table.replace(/s$/, '').toLowerCase())) score += 1
          return { child, score }
        })
        .sort((a, b) => b.score - a.score)
      const best = ranked[0]?.score ?? 0
      // Everything when nothing stands out, the top few when something does.
      const keep = best > 0 ? ranked.filter((r) => r.score > 0).slice(0, 3) : ranked.slice(0, 3)

      for (const { child, score } of keep) {
        out.push({
          kind: 'cached-aggregate',
          table,
          confidence: score >= 2 ? 'likely' : 'possible',
          detail: `${table}.${col.name} may cache ${child.child} via ${child.child}.${child.childColumn}`,
          draft: `cachedAggregateMatchesRows({
  //   title: '',
  //   because: '',   // ← from the business. Leave blank and this will not run.
  //   parent: '${table}', cached: '${col.name}',
  //   child: '${child.child}', foreignKey: '${child.childColumn}',
  //   sum: '<the child column that adds up, or omit to count rows>',
  // })`,
        })
      }
    }

    // A parent carrying a subtotal, a tax, a discount and a total is proposing
    // its own equation.
    if (names.has('subtotal') && (names.has('total') || names.has('totalAmount'))) {
      const total = names.has('total') ? 'total' : 'totalAmount'
      const parts = ['subtotal', ...['taxAmount', 'tax', 'shippingFee', 'shipping'].filter((n) => names.has(n))]
      const minus = ['discountAmount', 'discount'].filter((n) => names.has(n))
      out.push({
        kind: 'arithmetic',
        table,
        confidence: 'likely',
        detail: `${table}.${total} looks like ${parts.join(' + ')}${minus.length ? ` - ${minus.join(' - ')}` : ''}`,
        draft: `{
  //   id: '${table}-total-arithmetic', title: '', because: '',
  //   sql: \`SELECT id, ${q(total)} FROM ${table}
  //          WHERE ABS(${q(total)} - (${parts.map(q).join(' + ')}${minus.map((m) => ` - COALESCE(${q(m)}, 0)`).join('')})) > 0.005\`,
  // }`,
      })
    }

    for (const col of cols) {
      if (!NUMERIC.test(col.type)) continue
      if (!/^(stock|quantity|qty|balance|available|remaining)$/i.test(col.name)) continue
      out.push({
        kind: 'non-negative',
        table,
        confidence: 'likely',
        detail: `${table}.${col.name} counts physical things and probably cannot go below zero`,
        draft: `{
  //   id: '${table}-${col.name}-not-negative', title: '', because: '',
  //   sql: \`SELECT id, ${q(col.name)} FROM ${table} WHERE ${q(col.name)} < 0\`,
  // }`,
      })
    }
  }

  // A unique human-facing string is a number somebody generates, and generating
  // one by reading the maximum is the commonest way a checkout falls over under
  // load. Nothing here can tell which way it was done — only that it is worth
  // pointing several actors at.
  for (const u of uniques) {
    const col = columns.find((c) => c.table === u.table && c.name === u.column)
    if (!col || !/character|text/.test(col.type)) continue
    if (!/(number|code|reference|ref|no)$/i.test(u.column)) continue
    out.push({
      kind: 'unique-under-load',
      table: u.table,
      confidence: 'likely',
      detail: `${u.table}.${u.column} is unique and human-facing — worth a collision wave on whatever creates it`,
      draft: `// mark the action that creates a ${u.table} as \`collidable: true\``,
    })
  }

  // Likely first, so the reader meets the ones worth reading.
  return out.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'likely' ? -1 : 1))
}
