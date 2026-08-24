/**
 * The soundings for BBF.
 *
 * Every one of these is written from what is true of the FURNITURE BUSINESS,
 * not from what the code does. That distinction is the whole reliability of
 * the instrument. An invariant extracted from the implementation inherits the
 * implementation's misunderstandings and then agrees with them for ever — the
 * payroll formula in a neighbouring system was wrong for four months under a
 * test that
 * asserted `> 0 && < 130`, which the wrong answer satisfied.
 *
 * A row returned is a violation. An empty result is a pass.
 */
import type { Sounding, SqlSounding } from '../../core/types.js'
import { probes } from './probes.js'

const state: SqlSounding[] = [
  {
    id: 'paid-matches-payments',
    title: 'paid_amt equals the sum of the payment rows',
    because:
      'The payments table is the record of money actually received. paid_amt is a cache of it. ' +
      'When they disagree, either a customer is being chased for money they have paid, or the ' +
      'books show money nobody sent.',
    sql: `
      SELECT d.id, d.doc_no, d.paid_amt, COALESCE(SUM(p.amount), 0) AS payments_total
        FROM sales_docs d
        LEFT JOIN payments p ON p.doc_id = d.id
       GROUP BY d.id, d.doc_no, d.paid_amt
      HAVING ABS(d.paid_amt - COALESCE(SUM(p.amount), 0)) > 0.005`,
  },
  {
    id: 'no-overpayment',
    title: 'no invoice is paid beyond its total',
    because:
      'A customer cannot owe less than nothing. The payment route refuses anything above the ' +
      'outstanding balance, so a document that exceeds it means two payments each passed that ' +
      'check against the same reading.',
    sql: `
      SELECT id, doc_no, total, paid_amt
        FROM sales_docs
       WHERE type = 'INVOICE' AND status <> 'VOID' AND paid_amt > total + 0.01`,
  },
  {
    id: 'payment-only-on-invoice',
    title: 'money is only ever recorded against an invoice',
    because: 'A quotation is an offer. Nothing has been asked for yet, so nothing can have been received.',
    sql: `
      SELECT p.id, p.amount, d.doc_no, d.type
        FROM payments p JOIN sales_docs d ON d.id = p.doc_id
       WHERE d.type <> 'INVOICE'`,
  },
  {
    id: 'status-follows-money',
    title: 'an invoice says what it has been paid',
    because:
      'Payment status is derived, never typed. Part-paid is PARTIAL, settled is PAID, untouched is ' +
      'neither. A wrong one puts a settled invoice on the chase list or takes a live debt off it.',
    sql: `
      SELECT id, doc_no, status, total, paid_amt
        FROM sales_docs
       WHERE type = 'INVOICE' AND status <> 'VOID' AND total > 0 AND (
             (paid_amt > 0 AND paid_amt < total - 0.01 AND status <> 'PARTIAL')
          OR (paid_amt >= total - 0.01 AND paid_amt > 0 AND status <> 'PAID')
          OR (paid_amt <= 0 AND status IN ('PARTIAL', 'PAID')))`,
  },
  {
    id: 'total-equals-lines',
    title: 'the document total equals the lines printed above it',
    because:
      'The customer adds the column up. A total that is not the sum of its lines is the version ' +
      'they notice, and it is the figure the accounts are built on.',
    sql: `
      SELECT d.id, d.doc_no, d.total, COALESCE(SUM(i.line_total), 0) AS lines_total
        FROM sales_docs d
        LEFT JOIN sales_doc_items i ON i.doc_id = d.id
       GROUP BY d.id, d.doc_no, d.total
      HAVING ABS(d.total - COALESCE(SUM(i.line_total), 0)) > 0.005`,
  },
  {
    id: 'converted-quotation-is-closed',
    title: 'a quotation that became an invoice is closed',
    because:
      'Once a quotation is an invoice, editing the quotation underneath it changes what was agreed ' +
      'without changing what is being charged.',
    sql: `
      SELECT q.id, q.doc_no, q.status, inv.doc_no AS invoice_no
        FROM sales_docs inv JOIN sales_docs q ON q.id = inv.converted_from_id
       WHERE q.status <> 'CONVERTED'`,
  },
  {
    id: 'sequence-covers-issued-numbers',
    title: 'the number sequence is at least as far along as the documents issued',
    because:
      'Numbering is the one thing two salespeople do at the same moment. A counter behind the ' +
      'documents it issued means a number was handed out twice.',
    sql: `
      SELECT s.prefix, s.last_seq, COUNT(d.id) AS issued
        FROM doc_sequences s
        JOIN sales_docs d ON d.doc_no LIKE s.prefix || '%'
       GROUP BY s.prefix, s.last_seq
      HAVING COUNT(d.id) > s.last_seq`,
  },
  {
    id: 'slot-capacity',
    title: 'no delivery window holds more jobs than it has capacity for',
    because:
      'Capacity is how many jobs the lorry can do in that window. Exceeding it is a promise to a ' +
      'customer that physically cannot be kept.',
    sql: `
      SELECT d.scheduled_date, s.label, s.capacity, COUNT(*) AS booked
        FROM deliveries d JOIN delivery_slots s ON s.id = d.slot_id
       WHERE d.status IN ('SCHEDULED', 'DISPATCHED', 'DELIVERED')
       GROUP BY d.scheduled_date, d.slot_id, s.label, s.capacity
      HAVING COUNT(*) > s.capacity`,
  },
  {
    id: 'no-delivery-on-blackout',
    title: 'nothing is scheduled on a blackout date',
    because: 'A blackout is a day the warehouse is shut. A job booked onto it will not go out.',
    sql: `
      SELECT d.id, d.delivery_no, d.scheduled_date, b.reason
        FROM deliveries d JOIN delivery_blackouts b ON b.date = d.scheduled_date
       WHERE d.status IN ('SCHEDULED', 'DISPATCHED', 'DELIVERED')`,
  },
  {
    id: 'scheduled-implies-window',
    title: 'a job on the run sheet has a date and a time',
    because:
      'The run sheet prints a time. A scheduled job without one is a job the driver cannot be given ' +
      'and the customer cannot be told about.',
    sql: `
      SELECT id, delivery_no, status, scheduled_date, slot_id, start_minutes, end_minutes
        FROM deliveries
       WHERE status IN ('SCHEDULED', 'DISPATCHED', 'DELIVERED')
         AND (scheduled_date IS NULL OR slot_id IS NULL OR start_minutes IS NULL OR end_minutes IS NULL)`,
  },
  {
    id: 'planning-implies-no-window',
    title: 'a job pulled back to planning has released its window',
    because:
      'A job that is no longer scheduled must stop occupying a slot, or the window is full of jobs ' +
      'nobody is going to do.',
    sql: `
      SELECT id, delivery_no, scheduled_date, slot_id
        FROM deliveries
       WHERE status = 'PLANNING' AND (scheduled_date IS NOT NULL OR slot_id IS NOT NULL)`,
  },
  {
    id: 'no-delivering-more-than-sold',
    title: 'no more of a line is loaded onto lorries than was sold',
    because:
      'The delivery items come off an order line. Sending out more than the customer bought is ' +
      'stock leaving the warehouse against nothing.',
    sql: `
      SELECT i.id, i.description, i.qty AS sold, SUM(di.qty) AS scheduled
        FROM sales_doc_items i
        JOIN delivery_items di ON di.sales_doc_item_id = i.id
        JOIN deliveries d ON d.id = di.delivery_id
       WHERE d.status <> 'CANCELLED'
       GROUP BY i.id, i.description, i.qty
      HAVING SUM(di.qty) > i.qty + 0.005`,
  },
  {
    id: 'autocount-state-is-coherent',
    title: 'what a document says about accounting is true of it',
    because:
      'AutoCount is the book of record. A document marked SYNCED with no number in it cannot be ' +
      'found there, and one marked NOT_SYNCED that carries a number has been pushed and forgotten ' +
      '— either way somebody reconciles by hand and the answer they get is wrong.',
    sql: `
      SELECT id, doc_no, autocount_sync_status, autocount_doc_no, autocount_error
        FROM sales_docs
       WHERE (autocount_sync_status = 'SYNCED' AND autocount_doc_no IS NULL)
          OR (autocount_sync_status = 'NOT_SYNCED' AND autocount_doc_no IS NOT NULL)
          OR (autocount_sync_status = 'FAILED' AND autocount_error IS NULL)`,
  },
  {
    id: 'one-live-conversation-per-contact',
    title: 'a customer has one live thread, not several',
    because:
      'A conversation is the thread with one person. Two live ones for the same number show the ' +
      'customer twice in the inbox and send the reply down whichever the operator happened to ' +
      'open, so the other goes unanswered. Two messages arriving together from someone new is ' +
      'the ordinary way that happens.',
    sql: `
      SELECT c.wa_id, COUNT(*) AS live_threads
        FROM wa_conversations v JOIN wa_contacts c ON c.id = v.contact_id
       WHERE v.status IN ('BOT', 'HUMAN')
       GROUP BY c.wa_id
      HAVING COUNT(*) > 1`,
  },
]

/** State first, then the probes: SQL is cheap and probes cost round trips. */
export const soundings: Sounding[] = [...state, ...probes]
