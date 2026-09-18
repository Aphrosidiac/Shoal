# Planted bugs

Eleven, one per class of check. Shoal is never told about this file — it exists
so `shoal bench` can be scored against something known. See
[../../docs/calibration.md](../../docs/calibration.md).

| # | Bug | Where | Should be caught by |
|---|---|---|---|
| 1 | `paid_amt` updated read-then-write with no lock | `routes/payments.ts` | race + read-back |
| 2 | no outstanding-balance guard — an invoice accepts more than it is owed | `routes/payments.ts` | money |
| 3 | `GET /api/orders/:id` never scopes by account | `routes/orders.ts` | leak |
| 4 | orders paged by `created_at` with OFFSET; the offset skips a row at every page boundary | `routes/orders.ts` | paging |
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

Two notes from building it:

**#4.** A non-unique `ORDER BY` is the root cause in the real world, but SQLite
breaks ties on rowid and does it the same way every time, so `ORDER BY
created_at` alone paginates perfectly and the bug never fires. The route keeps
the non-unique sort and adds the defect it normally produces — the offset skips
one row at every page boundary after the first — so a list walk misses rows
deterministically. The check under test is unchanged: walk every page, every
row should appear exactly once.

**#10.** Verified by hand: 35 orders 0ms, 355 orders 577ms, 655 orders 2105ms.
The slow threshold is 1500ms, so it takes roughly five hundred accumulated
orders before this is visible at all.

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

## Planted screen bugs

Ten more, visible only through the browser — no request replay can see any
of them, which is the point. Numbered on from the eleven above so
`EXPECT.json` stays one list.

| # | Bug | Where | Should be caught by |
|---|---|---|---|
| 12 (U1) | "Save settings" is a button wired to nothing | `/app/settings` | screen.dead_control |
| 13 (U2) | "Mark all as read" shows "Done." before the answer, and the answer is 404 | `/app/notifications` | screen.false_success |
| 14 (U3) | quick-add says "Saved." and never refetches the list under it | `/app/customers` | screen.stale_after_write |
| 15 (U4) | the status line reads the stored status; the balance is derived — after "Set status PAID" the screen says PAID and Outstanding RM 1,300 at once | `/app/invoices/:id` | screen.contradiction |
| 16 (U5) | a refused order form is wiped | `/app/orders/new` | screen.lost_input |
| 17 (U6) | "View all invoices" opens the orders list | `/app` | screen.wrong_destination |
| 18 (U7) | `{{open_orders}} orders open this week` — a template that never rendered | `/app` | screen.dev_text |
| 19 (U8) | a quantity below 1 is refused as "Customer is required" | `/app/orders/new` | screen.wrong_validation |
| 20 (U9) | the aging report's request never answers; the screen stays on "Loading…" | `/app/reports/aging` | screen.loading_stuck |
| 21 (U10) | "Download CSV" clears the session and lands on the login page | `/app/reports` | screen.logged_out |

## Deliberately NOT screen bugs

| Behaviour | Where |
|---|---|
| a green "Saved." message after a successful write | every form |
| a hint under a field — "Enter the amount in RM, for example 100.00" | `/app/invoices/:id/pay` |
| an empty state that says what to do — "Nothing here yet. Add your first customer above." | `/app/customers` |
| a fully paid invoice with a disabled "Take a payment" and "This invoice is fully paid." | `/app/invoices/:id` |
| reference codes (`REF-7F3A`, `INV-2081`) and email addresses on screen | lists |
| no "Previous page" link on page one | `/app/orders` |

## Found, not planted

| # | Bug | Where | Caught by |
|---|---|---|---|
| 22 | `renderTable` and `loadOne` write user input into `innerHTML` unescaped — a `<tag>` typed into any field is interpreted as markup | `html.ts` | screen.html_injection |

Found by the screen judge on 2026-09-19, the first run after the rebuild: a
persona typed `<tag>` into a name field, the app said Saved., and the name
came back without its tag. It was in the fixture from the first commit and
no HTTP check could see it, because the response body carries the text
exactly as stored. It stays in.
