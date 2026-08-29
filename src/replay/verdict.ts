import type { Ctx } from '../ctx.js'
import * as findings from '../store/repo/findings.js'
import type { Kind } from '../store/repo/findings.js'
import * as coverage from '../store/repo/coverage.js'

export type ReproStep = { method: string; path: string; status: number | string; as?: string; note?: string }

export type Attempt = {
  /** Inconclusive attempts do not count either way. */
  verdict: 'reproduced' | 'clean' | 'inconclusive'
  steps: ReproStep[]
  recordingIds: number[]
  detail?: string
  why?: string
}

export type Case = {
  check: string
  kind: Kind
  title: string
  detail: string
  endpointId: number | null
  attempts?: number
  fingerprint: string
  attempt: (n: number) => Promise<Attempt>
}

/**
 * Nothing reaches the report without coming through here.
 *
 *   attempts   5
 *   reproduced 3   ->  finding
 *   reproduced 0   ->  dismissed, silently, never mentioned
 *   reproduced 1   ->  finding, marked intermittent
 *
 * Because the target is genuinely non-deterministic, one reproduction is a
 * yes. A race that fires one time in five is still a race, and pretending
 * otherwise would throw away real bugs.
 */
export async function decide(ctx: Ctx, c: Case): Promise<findings.Finding | null> {
  const want = c.attempts ?? 5
  let reproduced = 0
  let ran = 0
  let best: Attempt | null = null
  const recordingIds: number[] = []
  let lastWhy = ''

  for (let n = 0; n < want + 2 && ran < want; n++) {
    if (ctx.stopping()) break
    let a: Attempt
    try {
      a = await c.attempt(n)
    } catch (e) {
      lastWhy = (e as Error).message.split('\n')[0]!
      continue
    }
    if (a.verdict === 'inconclusive') {
      lastWhy = a.why ?? 'inconclusive'
      continue
    }
    ran++
    recordingIds.push(...a.recordingIds)
    if (a.verdict === 'reproduced') {
      reproduced++
      if (!best) best = a
    }
  }

  coverage.bump(ctx.db, 'confirmed_attempts')
  if (!ran) {
    ctx.log('confirm', `could not test ${c.check} on ${c.title}: ${lastWhy || 'no usable attempt'}`)
    return null
  }
  if (!reproduced || !best) return null

  const detail =
    (best.detail ? best.detail + '\n\n' : '') +
    c.detail +
    (reproduced < ran ? `\n\nIntermittent: ${reproduced} of ${ran} attempts.` : '')

  const f = findings.record(ctx.db, {
    fingerprint: c.fingerprint,
    kind: c.kind,
    title: c.title,
    reach: best.steps.length,
    endpoint_id: c.endpointId,
    app_version_id: ctx.app.versionId || 1,
    repro: { check: c.check, steps: best.steps, shrunkFrom: best.steps.length, detail },
    attempts: ran,
    reproduced,
    recording_ids: [...new Set(recordingIds)].slice(0, 8),
  })
  ctx.log('finding', `${f.kind.toUpperCase()} ${f.title}  (${reproduced}/${ran})`)
  coverage.set(ctx.db, 'findings', findings.openCount(ctx.db))
  return f
}
