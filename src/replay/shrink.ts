import type { Ctx } from '../ctx.js'
import type { Attempt, ReproStep } from './verdict.js'

export type Shrunk = { steps: ReproStep[]; from: number; attempt: Attempt }

/**
 * A confirmed finding arrives with everything that happened before it, which
 * is useless as a bug report. Drop a request, replay, does it still fail?
 * Keep cutting until nothing more can go.
 *
 * Because the target is genuinely non-deterministic, each candidate is given
 * N attempts and one reproduction counts as a yes. A race that fires one time
 * in five is still a race, and treating a single clean run as proof would
 * throw away real bugs and produce a repro that does not work.
 */
export async function shrink(
  ctx: Ctx,
  full: number[],
  tryWithout: (keep: number[]) => Promise<Attempt>,
  opts: { attempts?: number; budgetMs?: number } = {}
): Promise<{ keep: number[]; from: number }> {
  const attempts = opts.attempts ?? 3
  const deadline = Date.now() + (opts.budgetMs ?? 60_000)
  let keep = [...full]

  const stillFails = async (candidate: number[]): Promise<boolean> => {
    for (let i = 0; i < attempts; i++) {
      if (ctx.stopping() || Date.now() > deadline) return false
      const a = await tryWithout(candidate)
      if (a.verdict === 'reproduced') return true
    }
    return false
  }

  // Take the biggest bite that still works: halves first, then single steps.
  for (let size = Math.floor(keep.length / 2); size >= 1 && keep.length > 1; size = Math.floor(size / 2)) {
    let i = 0
    while (i + size <= keep.length && keep.length > 1) {
      if (Date.now() > deadline) return { keep, from: full.length }
      const candidate = [...keep.slice(0, i), ...keep.slice(i + size)]
      if (candidate.length && (await stillFails(candidate))) keep = candidate
      else i += size
    }
  }
  return { keep, from: full.length }
}

/**
 * The other thing worth cutting down: a race confirmed with eight concurrent
 * writes is a better bug report if it also happens with two. "Five people
 * paying one invoice" is a story a developer can act on; "eight machines
 * hammering an endpoint" invites the answer that nobody would do that.
 */
export async function smallestWave(
  ctx: Ctx,
  from: number,
  fires: (n: number) => Promise<Attempt>,
  opts: { attempts?: number; budgetMs?: number } = {}
): Promise<{ width: number; attempt: Attempt | null }> {
  const attempts = opts.attempts ?? 2
  const deadline = Date.now() + (opts.budgetMs ?? 45_000)
  for (let n = 2; n < from; n *= 2) {
    if (ctx.stopping() || Date.now() > deadline) break
    for (let i = 0; i < attempts; i++) {
      const a = await fires(n)
      // The smaller wave's own account of what happened, not the bigger one's
      // with a number swapped in. Patching "8 were fired" to "2 were fired"
      // leaves the rest of the sentence describing the run that was thrown
      // away, and a repro that contradicts itself is worse than a long one.
      if (a.verdict === 'reproduced') return { width: n, attempt: a }
    }
  }
  return { width: from, attempt: null }
}
