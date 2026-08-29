import type { Ctx } from '../ctx.js'
import * as spend from '../store/repo/spend.js'

/**
 * "How much will twenty-four hours cost me" is the first question anyone asks,
 * and the answer should be "whatever you tell it". As spend approaches the
 * ceiling the scheduler stops issuing the kinds of work that cost money and
 * keeps issuing the ones that do not. It slows down rather than stopping, and
 * it says so.
 */
export class Meter {
  private saidSo = 0

  constructor(private ctx: Ctx) {}

  /** Dollars in the last hour, or planner calls in claude-code mode. */
  spentThisHour(): number {
    return spend.sinceMs(this.ctx.db, 3600_000).usd
  }

  /** False when work that costs a model call should stop being issued. */
  canAfford(): boolean {
    const ceiling = this.ctx.cfg.budgetPerHour
    if (ceiling === null) return true
    const spent = this.spentThisHour()
    if (spent < ceiling) return true
    if (Date.now() - this.saidSo > 10 * 60_000) {
      this.saidSo = Date.now()
      this.ctx.log(
        'budget',
        `$${spent.toFixed(2)} spent in the last hour against a $${ceiling.toFixed(2)} ceiling — ` +
          `pausing the work that costs money. Hammering and confirming carry on, and they are free.`
      )
    }
    return false
  }

  /** In claude-code mode a subscription meters calls, not dollars. */
  plannerCallsLeft(): number {
    return this.ctx.models.plannerBudgetLeft()
  }

  summary(): { usd: number; calls: number; perAction: number; cachedShare: number } {
    const t = spend.total(this.ctx.db)
    const actions = (this.ctx.db.prepare("SELECT value FROM coverage WHERE key = 'actions'").get() as { value: number } | undefined)?.value ?? 0
    return {
      usd: t.usd,
      calls: t.calls,
      perAction: actions ? t.calls / actions : 0,
      cachedShare: t.in_tokens ? t.cached_in / t.in_tokens : 0,
    }
  }
}
