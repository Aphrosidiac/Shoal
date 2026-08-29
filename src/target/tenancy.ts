import type { Ctx } from '../ctx.js'
import type { Replayer } from '../replay/request.js'
import * as accounts from '../store/repo/accounts.js'
import { setTenancy } from '../store/repo/run.js'
import { firstObject, idOf } from '../watch/types.js'
import type { Recording } from '../store/repo/recordings.js'

export type Tenancy = 'unknown' | 'isolated' | 'shared'

let cached: Tenancy | null = null

/**
 * The single-tenant trap: on an app that is deliberately one shared workspace,
 * "account B can read account A's object" is not a leak, it is the product.
 * So it is decided once, from evidence, and stored on the run.
 *
 * Isolated means at least one thing A can see is refused to B. Shared means
 * essentially everything is readable by everyone.
 */
export async function tenancyOf(ctx: Ctx, rp: Replayer): Promise<Tenancy> {
  if (cached) return cached
  const stored = ctx.db.prepare('SELECT tenancy FROM runs WHERE id = ?').get(ctx.runId) as { tenancy: string | null } | undefined
  if (stored?.tenancy && stored.tenancy !== 'unknown') return (cached = stored.tenancy as Tenancy)

  const usable = accounts.usable(ctx.db)
  if (usable.length < 2) return 'unknown'

  // one object-shaped GET per endpoint, from as many endpoints as we have
  const samples = ctx.db
    .prepare(
      `SELECT r.* FROM recordings r
       JOIN (SELECT endpoint_id, MAX(id) id FROM recordings
             WHERE method = 'GET' AND status = 200 AND account_id IS NOT NULL
             GROUP BY endpoint_id) last ON last.id = r.id
       WHERE r.url LIKE '%/%'
       ORDER BY r.id DESC LIMIT 12`
    )
    .all() as Recording[]

  const tried: Array<{ endpoint: number; readable: boolean }> = []
  const seenEndpoints = new Set<number>()
  for (const rec of samples) {
    if (!rec.account_id || !rec.endpoint_id) continue
    if (seenEndpoints.has(rec.endpoint_id)) continue
    const other = usable.find((a) => a.id !== rec.account_id)
    if (!other) continue
    const owner = await rp.fire({ method: 'GET', url: rec.url, accountId: rec.account_id })
    if (owner.status !== 200) continue
    const ownId = idOf(firstObject(owner.json) ?? {})
    if (!ownId) continue
    seenEndpoints.add(rec.endpoint_id)
    const theirs = await rp.fire({ method: 'GET', url: rec.url, accountId: other.id })
    const readable = theirs.status === 200 && idOf(firstObject(theirs.json) ?? {}) === ownId
    tried.push({ endpoint: rec.endpoint_id, readable })
    if (tried.length >= 6) break
  }

  /**
   * The asymmetry here is deliberate, because the two mistakes do not cost the
   * same. A wrong "isolated" means leaks get reported and each one still has
   * to reproduce before it reaches anybody. A wrong "shared" silently switches
   * off the single most valuable check in the tool, and nothing downstream
   * ever says so.
   *
   * So: one object properly refused to a stranger is decisive. An app that
   * refuses anything is not one shared workspace. "Shared" needs everything
   * readable, across enough different endpoints to mean it — an early run
   * where the only two samples happen to be a global config list and the leaky
   * endpoint itself is not evidence of anything, and reading it as such is
   * what lost a real tenant leak.
   */
  const refused = tried.filter((t) => !t.readable).length
  if (refused > 0) {
    setTenancy(ctx.db, ctx.runId, 'isolated')
    ctx.log('tenancy', `accounts are separated — ${refused} of ${tried.length} objects were refused to a stranger`)
    return (cached = 'isolated')
  }
  if (tried.length < 3) return 'unknown' // not cached: ask again once the map has more in it
  setTenancy(ctx.db, ctx.runId, 'shared')
  ctx.log('tenancy', `every account can read the same data (${tried.length} endpoints checked), so cross-account reads are not leaks here`)
  return (cached = 'shared')
}

export const resetTenancy = (): void => {
  cached = null
}
