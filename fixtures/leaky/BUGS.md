# Planted bugs

Eleven, one per class of check. Shoal is never told about this file — it exists
so `shoal bench` can be scored against something known. See
[../../docs/calibration.md](../../docs/calibration.md).

| # | Bug | Where | Should be caught by |
|---|---|---|---|
| 1 | `paid_amt` updated read-then-write with no lock | `routes/payments.ts` | race + read-back |
| 2 | no outstanding-balance guard — an invoice accepts more than it is owed | `routes/payments.ts` | money |
| 3 | `GET /api/orders/:id` never scopes by account | `routes/orders.ts` | leak |
| 4 | orders paged by `created_at` with OFFSET, non-unique | `routes/orders.ts` | paging |
| 5 | `PATCH /api/customers/:id` silently drops `phone` | `routes/customers.ts` | read-back |
| 6 | a malformed date returns 500, not 400 | `routes/reports.ts` | fault |
| 7 | status written directly by one route, derived by another | `routes/invoices.ts` | wrong |
| 8 | double submit creates two orders, no idempotency | `routes/orders.ts` | idempotency |
| 9 | `/api/admin/export` reachable by a normal user | `routes/admin.ts` | auth |
| 10 | unbounded query, slow past ~500 rows | `routes/orders.ts` | slow — **needs seasoning** |
| 11 | a 500 body carrying the raw stack trace | `error-handler.ts` | fault |

#1 needs genuine concurrency. #10 is fast on an empty database, so a run that
never accumulates data will never see it. Those two are the ones that prove the
harder half of the design works.

## Deliberately NOT bugs

If Shoal reports any of these, it is a false positive. Recall on its own is a
vanity metric.

| Behaviour | Where |
|---|---|
| correctly 403s the wrong role | `routes/admin.ts` — `/api/admin/settings` |
| a correctly locked, correctly serialising write | `routes/deliveries.ts` |
| correctly returns 400 for bad input | `routes/customers.ts` |
| a list correctly paged with a stable key | `routes/invoices.ts` |
| two accounts that correctly cannot see each other | `routes/invoices.ts` |
