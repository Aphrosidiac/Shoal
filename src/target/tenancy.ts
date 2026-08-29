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

  const tried: Array<{ readable: boolean }> = []
  for (const rec of samples) {
    if (!rec.account_id) continue
    const other = usable.find((a) => a.id !== rec.account_id)
    if (!other) continue
    const owner = await rp.fire({ method: 'GET', url: rec.url, accountId: rec.account_id })
    if (owner.status !== 200) continue
    const ownId = idOf(firstObject(owner.json) ?? {})
    if (!ownId) continue
    const theirs = await rp.fire({ method: 'GET', url: rec.url, accountId: other.id })
    const readable = theirs.status === 200 && idOf(firstObject(theirs.json) ?? {}) === ownId
    tried.push({ readable })
    if (tried.length >= 6) break
  }

  if (tried.length < 2) return 'unknown'
  const share = tried.filter((t) => t.readable).length / tried.length
  const verdict: Tenancy = share >= 0.8 ? 'shared' : 'isolated'
  setTenancy(ctx.db, ctx.runId, verdict)
  ctx.log(
    'tenancy',
    verdict === 'shared'
      ? `every account can read the same data (${tried.length} objects checked), so cross-account reads are not leaks here`
      : `accounts are separated (${tried.filter((t) => t.readable).length} of ${tried.length} objects readable by a stranger)`
  )
  cached = verdict
  return verdict
}

export const resetTenancy = (): void => {
  cached = null
}
