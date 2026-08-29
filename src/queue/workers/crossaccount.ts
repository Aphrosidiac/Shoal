import type { Ctx } from '../../ctx.js'
import type { Item } from '../../store/repo/queue.js'
import type { Replayer } from '../../replay/request.js'
import * as recordings from '../../store/repo/recordings.js'
import * as accounts from '../../store/repo/accounts.js'
import * as findings from '../../store/repo/findings.js'
import { file, endpointLabel } from '../../watch/index.js'
import { firstObject, idOf } from '../../watch/types.js'
import { findingFp } from '../../map/fingerprint.js'
import { tenancyOf } from '../../target/tenancy.js'

/**
 * The strongest check there is for a SaaS, and it costs nothing.
 *
 * Agent A creates something. Agent B, on a completely different account it
 * signed up for itself, asks for that thing by id. If B gets it, that is a
 * tenant leak — unless this app is deliberately one shared workspace, which is
 * why tenancy is probed once first.
 */
export async function runCrossAccount(ctx: Ctx, rp: Replayer, item: Item): Promise<string> {
  const p = JSON.parse(item.payload_json) as { recordingId: number; accountId: number }
  const rec = recordings.byId(ctx.db, p.recordingId)
  if (!rec || !rec.account_id) return 'nothing to try'
  if (rec.account_id === p.accountId) return 'same account'

  const tenancy = await tenancyOf(ctx, rp)
  if (tenancy === 'shared') return 'this app is one shared workspace, so reading it is not a leak'
  if (tenancy === 'unknown') return 'not enough accounts yet to know whether that would be a leak'

  const label = endpointLabel(ctx, rec.endpoint_id)
  const fp = findingFp(label, 'leak.crossaccount', 'other-account')
  if (findings.byFingerprint(ctx.db, fp)) return 'already known'

  const owner = await rp.fire({ method: rec.method, url: rec.url, accountId: rec.account_id })
  if (owner.status !== 200) return `the owner cannot read it either (${owner.status})`
  const ownId = idOf(firstObject(owner.json) ?? {})

  if (!ownId) return 'this address does not name one object, so a 200 from a stranger proves nothing'

  const other = await rp.fire({ method: rec.method, url: rec.url, accountId: p.accountId })
  if (other.status !== 200) return `correctly refused with ${other.status}`
  const theirObj = firstObject(other.json)
  if (!theirObj) return 'answered 200 with nothing in it'
  if (idOf(theirObj) !== ownId) return 'answered 200 with a different object'
  const ownObj = firstObject(owner.json) ?? {}
  const agreeing = Object.keys(ownObj).filter(
    (k) => !/^(id|_id|uuid|pk)$/i.test(k) && typeof ownObj[k] !== 'object' && k in theirObj && String(ownObj[k]) === String(theirObj[k])
  )
  if (!agreeing.length) return 'answered 200 with an object that only shares an id'

  const asLabel = accounts.byId(ctx.db, p.accountId)?.email ?? `account ${p.accountId}`
  const ownerLabel = accounts.byId(ctx.db, rec.account_id)?.email ?? 'another account'
  file(ctx, {
    check: 'leak.crossaccount',
    kind: 'leak',
    title: `${label} returns another account's object`,
    detail:
      'Another account reading a tenant object by id is the worst thing on the list and the most certain, ' +
      'because there is no reading of the product in which it is intended.',
    expected: `${label} to answer 403 or 404 to an account that does not own the object`,
    observed: `200 with the same id and the same ${agreeing.slice(0, 4).join(', ')}`,
    endpointId: rec.endpoint_id,
    recordingId: rec.id,
    data: { asAccount: p.accountId, shape: 'other-account' },
  })
  return 'filed a possible leak'
}
