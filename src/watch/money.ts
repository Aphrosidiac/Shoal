import type { Ctx } from '../ctx.js'
import type { Observed } from '../browser/record.js'
import { firstObject, parse, type Signal } from './types.js'

/**
 * A stored figure disagreeing with the rows it is made of. No knowledge of the
 * domain: it keys off the names an app gives its own money columns, which is
 * the same thing a person reading the response would do.
 */
const PAID = /^(paid|paid_amt|paid_amount|amount_paid|amountPaid|received|settled|collected)$/i
const TOTAL = /^(total|amount|grand_total|grandTotal|total_amount|totalAmount|amount_due|amountDue|subtotal)$/i
const BALANCE = /^(balance|outstanding|remaining|due|amount_outstanding|balance_due)$/i

const WRITE = new Set(['POST', 'PUT', 'PATCH'])
const AMOUNT = /^(amount|amt|value|sum|price|total|paid|payment|qty|quantity)$/i

function carriesAnAmount(body: string | null): boolean {
  const v = parse(body)
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  return Object.entries(v as Record<string, unknown>).some(([k, val]) => AMOUNT.test(k) && Number.isFinite(Number(val)))
}

export function money(ctx: Ctx, o: Observed): Signal[] {
  void ctx
  if (o.status < 200 || o.status >= 300) return []
  // Only on something we just changed. Reading a pre-existing odd row out of a
  // seed database is not a defect we caused or can reproduce.
  if (!WRITE.has(o.method)) return []
  // And only when THIS write was the one carrying the money. Plenty of routes
  // return the whole object, so a status change on an invoice that was
  // overpaid an hour ago would otherwise be reported as accepting the
  // overpayment itself — true state, wrong endpoint, and a repro that does
  // not reproduce.
  if (!carriesAnAmount(o.reqBody)) return []
  const object = firstObject(parse(o.resBody))
  if (!object) return []

  const paidKey = Object.keys(object).find((k) => PAID.test(k))
  const totalKey = Object.keys(object).find((k) => TOTAL.test(k))
  const balanceKey = Object.keys(object).find((k) => BALANCE.test(k))
  if (!paidKey || !totalKey) return []

  const paid = Number(object[paidKey])
  const total = Number(object[totalKey])
  if (!Number.isFinite(paid) || !Number.isFinite(total) || total <= 0) return []
  if (paid <= total + 1e-9) return []

  const balance = balanceKey ? Number(object[balanceKey]) : total - paid
  return [
    {
      check: 'money.overpaid',
      kind: 'money',
      title: `${o.method} ${o.pattern} accepts more than is owed`,
      detail:
        `The object came back with ${totalKey}=${total} and ${paidKey}=${paid}` +
        (balanceKey ? `, leaving ${balanceKey}=${balance}` : '') +
        `. Nothing rejected the amount, so the stored figure now disagrees with what it is supposed to be made of.`,
      expected: `${paidKey} never to exceed ${totalKey} (${total})`,
      observed: `${paidKey} is ${paid}${balanceKey ? `, ${balanceKey} is ${balance}` : ''}`,
      endpointId: o.endpointId,
      recordingId: o.id,
      data: { paidKey, totalKey, balanceKey: balanceKey ?? null, paid, total },
    },
  ]
}
