import type { Ctx } from '../../ctx.js'
import type { Item } from '../../store/repo/queue.js'
import { Replayer } from '../../replay/request.js'
import { decide, type Attempt } from '../../replay/verdict.js'
import * as probes from '../../replay/probes.js'
import * as suspicions from '../../store/repo/suspicions.js'
import * as recordings from '../../store/repo/recordings.js'
import * as map from '../../store/repo/map.js'
import * as accounts from '../../store/repo/accounts.js'
import { endpointLabel } from '../../watch/index.js'
import { findingFp } from '../../map/fingerprint.js'
import { firstObject } from '../../watch/types.js'
import type { Signal } from '../../watch/types.js'
import type { Kind } from '../../store/repo/findings.js'

/**
 * Replay a suspicion and decide. No model is involved anywhere in here, which
 * is the whole defence against a report full of confident nonsense: agents are
 * allowed to be wrong, and this is the gate they have to get through.
 */
export async function runConfirm(ctx: Ctx, rp: Replayer, item: Item): Promise<string> {
  const p = JSON.parse(item.payload_json) as Record<string, unknown>
  if (typeof p.suspicionId === 'number') return confirmSuspicion(ctx, rp, p.suspicionId)
  if (typeof p.probe === 'string') return runProbe(ctx, rp, p)
  return 'nothing to confirm'
}

async function confirmSuspicion(ctx: Ctx, rp: Replayer, id: number): Promise<string> {
  const s = suspicions.byId(ctx.db, id)
  if (!s || s.state !== 'open') return 'already dealt with'
  const note = safeNote(s.note)
  const rec = s.recording_id ? recordings.byId(ctx.db, s.recording_id) : undefined

  if (!rec) {
    // An agent's surprise with nothing behind it cannot be replayed, and a
    // claim we cannot check does not go in the report.
    suspicions.setState(ctx.db, id, 'unreproduced')
    return 'no recording behind it'
  }

  const check = (note.check as string) ?? 'agent'
  const kind = ((note.kind as Kind) ?? 'wrong') as Kind
  const label = endpointLabel(ctx, rec.endpoint_id)

  let attempt: (n: number) => Promise<Attempt>
  let title = (note.title as string) ?? `${label} did not do what the screen said`
  // The fallback is templated too. Every branch below replaces this, but a
  // default that quotes the model is a default that will reach the report the
  // first time somebody adds a check and forgets to set one.
  let detail = (note.detail as string) ?? `${label} did not behave as the recording says it should.`
  let shape = ''

  switch (check) {
    case 'fault.5xx':
    case 'fault.stack':
    case 'fault.error-in-200':
    case 'slow':
      shape = String((note.data as Record<string, unknown> | undefined)?.status ?? '')
      attempt = () => probes.faultAttempt(ctx, rp, rec, check)
      break
    case 'wrong.readback': {
      const field = String((note.data as Record<string, unknown> | undefined)?.field ?? '')
      shape = field
      attempt = () => probes.readbackAttempt(ctx, rp, rec, field)
      break
    }
    case 'money.overpaid':
      shape = 'overpaid'
      attempt = () => moneyAttempt(ctx, rp, rec, note.data as Record<string, unknown>)
      break
    case 'leak.crossaccount': {
      const asId = Number((note.data as Record<string, unknown>).asAccount)
      const asLabel = accounts.byId(ctx.db, asId)?.email ?? `account ${asId}`
      const owner = rec.account_id ? accounts.byId(ctx.db, rec.account_id)?.email ?? 'the owner' : 'the owner'
      shape = 'other-account'
      attempt = () => probes.crossAccountAttempt(ctx, rp, rec, asId, asLabel, owner)
      break
    }
    default: {
      // An agent's surprise. There is no deterministic shape to it, so the
      // only honest check is whether the request behind it still misbehaves.
      //
      // Note what is NOT here: the agent's own sentence. It is what made us
      // look, and it is kept on the suspicion and shown under "not confirmed"
      // where it is labelled as an agent's words — but a finding's title and
      // description are assembled from the recording, always. A model-written
      // summary drifts from what actually happened, and the one thing this
      // report has to be is literally true.
      shape = 'agent'
      attempt = () => probes.faultAttempt(ctx, rp, rec, 'fault.5xx')
      title = `${label} answers ${rec.status} on a request an agent took exception to`
      detail =
        `An agent acted here and then said the screen disagreed with what it had just done. That is not evidence, so it ` +
        `was thrown away and the request behind it was fired again on its own: ${rec.method} ${probes.pathOf(rec.url)} ` +
        `still answers ${rec.status}.`
    }
  }

  const f = await decide(ctx, {
    check,
    kind,
    title,
    detail,
    endpointId: rec.endpoint_id,
    fingerprint: (note.fp as string) ?? findingFp(label, check, shape),
    attempt,
  })
  suspicions.setState(ctx.db, id, f ? 'confirmed' : 'unreproduced')
  return f ? `confirmed ${check}` : `${check} did not reproduce`
}

async function runProbe(ctx: Ctx, rp: Replayer, p: Record<string, unknown>): Promise<string> {
  const probe = String(p.probe)
  const recId = Number(p.recordingId)
  const rec = recordings.byId(ctx.db, recId)
  if (!rec) return 'the recording behind this probe is gone'
  const label = endpointLabel(ctx, rec.endpoint_id)

  switch (probe) {
    case 'paging.walk': {
      const fullest = fullestRecording(ctx, rec) ?? rec
      const f = await decide(ctx, {
        check: 'paging.walk',
        kind: 'data-loss',
        title: `${label} loses rows when you page through it`,
        detail:
          'A list that cannot be walked end to end is a list where some rows are invisible to anyone using the interface, ' +
          'and to anything that exports or reconciles against it.',
        endpointId: rec.endpoint_id,
        attempts: 3,
        fingerprint: findingFp(label, 'paging.walk', 'walk'),
        attempt: () => probes.pagingAttempt(ctx, rp, fullest),
      })
      return f ? 'confirmed a paging hole' : 'the list pages cleanly'
    }
    case 'idempotency.double': {
      const header = String(p.header ?? 'idempotency-key')
      const f = await decide(ctx, {
        check: 'idempotency.double',
        kind: 'data-loss',
        title: `${label} ignores ${header}`,
        detail:
          `The app's own front end sends ${header} on this request, which means it expects the server to make the ` +
          'call happen once. It does not, so a double click, a retry or a dropped connection creates two of the thing.',
        endpointId: rec.endpoint_id,
        attempts: 3,
        fingerprint: findingFp(label, 'idempotency.double', header),
        attempt: () => probes.idempotencyAttempt(ctx, rp, rec, header),
      })
      return f ? 'confirmed a missing idempotency guard' : `${header} is honoured`
    }
    case 'wrong.consistency': {
      const other = recordings.forEndpoint(ctx.db, Number(p.otherEndpointId), 1)[0]
      if (!other) return 'nothing to compare against'
      const objectId = String(p.objectId)
      const otherLabel = endpointLabel(ctx, other.endpoint_id)
      void objectId
      const f = await decide(ctx, {
        check: 'wrong.consistency',
        kind: 'wrong',
        title: `${label} and ${otherLabel} disagree about the same object`,
        detail:
          'One of these is stored and one is computed, and nothing keeps them in step. Whichever screen a user happens ' +
          'to be looking at decides what they believe.',
        endpointId: rec.endpoint_id,
        attempts: 3,
        fingerprint: findingFp([label, otherLabel].sort().join(' vs '), 'wrong.consistency', ''),
        attempt: () => probes.consistencyAttempt(ctx, rp, rec, other),
      })
      return f ? 'confirmed two reads disagreeing' : 'both reads agree'
    }
    case 'auth.role': {
      const locked = recordings.byId(ctx.db, Number(p.lockedRecordingId))
      if (!locked) return 'the locked neighbour is gone'
      const asId = Number(p.asAccount)
      const asLabel = accounts.byId(ctx.db, asId)?.email ?? `account ${asId}`
      const f = await decide(ctx, {
        check: 'auth.role',
        kind: 'auth',
        title: `${label} has no role check, and its neighbours do`,
        detail:
          'A role that can reach something it was not granted is as broken as a role locked out of its own job, and this ' +
          'one is reachable by an account that signed itself up thirty seconds ago.',
        endpointId: rec.endpoint_id,
        attempts: 3,
        fingerprint: findingFp(label, 'auth.role', 'open-neighbour'),
        attempt: () => probes.roleGapAttempt(ctx, rp, rec, locked, asId, asLabel),
      })
      return f ? 'confirmed a role gap' : 'the role check holds'
    }
    default:
      return `no probe called ${probe}`
  }
}

async function moneyAttempt(ctx: Ctx, rp: Replayer, rec: import('../../store/repo/recordings.js').Recording, data: Record<string, unknown>): Promise<Attempt> {
  void ctx
  const res = await rp.replay(rec)
  if (res.status < 200 || res.status >= 300) {
    return { verdict: 'inconclusive', steps: [], recordingIds: [], why: `answered ${res.status}` }
  }
  const o = firstObject(res.json)
  if (!o) return { verdict: 'inconclusive', steps: [], recordingIds: [], why: 'no object came back' }
  const paidKey = String(data.paidKey)
  const totalKey = String(data.totalKey)
  const paid = Number(o[paidKey])
  const total = Number(o[totalKey])
  if (!Number.isFinite(paid) || !Number.isFinite(total)) {
    return { verdict: 'inconclusive', steps: [], recordingIds: [], why: 'the figures are not in the answer any more' }
  }
  const over = paid > total + 1e-9
  return {
    verdict: over ? 'reproduced' : 'clean',
    steps: [{ method: rec.method, path: probes.pathOf(rec.url), status: `${res.status}  ${totalKey}=${total} ${paidKey}=${paid}` }],
    recordingIds: res.recordingId ? [res.recordingId] : [],
    ...(over ? { detail: `Accepted again: ${totalKey} is ${total} and ${paidKey} is now ${paid}.` } : {}),
  }
}

/**
 * Every account sees its own list, and only one of them has enough rows in it
 * to page at all. Walk that one — otherwise the check spends the whole run
 * answering "the list fits on one page".
 */
function fullestRecording(ctx: Ctx, rec: import('../../store/repo/recordings.js').Recording): import('../../store/repo/recordings.js').Recording | null {
  if (!rec.endpoint_id) return null
  const rows = recordings.forEndpoint(ctx.db, rec.endpoint_id, 60)
  let best: typeof rec | null = null
  let bestTotal = -1
  for (const r of rows) {
    if (r.status !== 200 || !r.account_id) continue
    let total = -1
    try {
      total = Number((JSON.parse(r.res_body ?? '{}') as Record<string, unknown>).total ?? -1)
    } catch {
      continue
    }
    if (total > bestTotal) {
      bestTotal = total
      best = r
    }
  }
  return best
}

function safeNote(note: string | null): Record<string, unknown> {
  if (!note) return {}
  try {
    return JSON.parse(note) as Record<string, unknown>
  } catch {
    return {}
  }
}

export type { Signal }
