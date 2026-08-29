import type { Ctx } from '../ctx.js'
import * as suspicions from '../store/repo/suspicions.js'
import * as recordings from '../store/repo/recordings.js'

/**
 * The one class of problem only an agent can notice, because it needs to
 * remember what it did three steps ago and care that the screen now
 * contradicts it.
 *
 * Writing this does nothing else. It does not go in the report, it is not
 * counted, and it is not a bug. A confirmer picks it up, replays the recorded
 * requests with no model involved, and only then can it become a finding.
 * Agents are allowed to be wrong; that is the point of the gate.
 */
export function fileSurprise(
  ctx: Ctx,
  worker: string,
  expected: string,
  observed: string,
  note?: string
): number {
  const last = recordings.recent(ctx.db, 1)[0]
  const id = suspicions.file(ctx.db, {
    source: 'agent',
    worker,
    recording_id: last?.id ?? null,
    expected,
    observed,
    note: note ?? null,
  })
  ctx.log('surprise', `${worker}: expected ${trim(expected)} / saw ${trim(observed)}`)
  return id
}

const trim = (s: string): string => (s.length > 70 ? s.slice(0, 67) + '…' : s)
