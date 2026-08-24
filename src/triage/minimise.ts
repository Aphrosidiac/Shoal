/**
 * Delta debugging over waves.
 *
 * A voyage that trips a sounding hands back four hundred actions, of which
 * three matter. The shrinker removes contiguous blocks and keeps every removal
 * the failure survives, halving the block size when a pass achieves nothing —
 * ddmin, with a wave as the unit because a wave is what the concurrency is
 * made of.
 *
 * A wave cannot be split. Removing one actor from a collision wave usually
 * removes the collision, so the shrinker would report the bug as unreproducible
 * and put the wave back; leaving the wave whole keeps the answer honest and
 * costs a little size.
 */
import type { LogEntry } from '../core/types.js'

export type Reproduce = (log: LogEntry[]) => Promise<boolean>

export async function minimise(
  log: LogEntry[],
  reproduce: Reproduce,
  onStep?: (kept: number, total: number, trials: number) => void,
): Promise<LogEntry[]> {
  let waves = [...new Set(log.map((e) => e.wave))].sort((a, b) => a - b)
  const total = waves.length
  const slice = (keep: number[]) => log.filter((e) => keep.includes(e.wave))
  let trials = 0

  let granularity = Math.max(1, Math.floor(waves.length / 2))
  while (granularity >= 1 && waves.length > 1) {
    let removedSomething = false
    for (let start = 0; start < waves.length; start += granularity) {
      const candidate = [...waves.slice(0, start), ...waves.slice(start + granularity)]
      if (candidate.length === 0 || candidate.length === waves.length) continue
      trials++
      if (await reproduce(slice(candidate))) {
        waves = candidate
        removedSomething = true
        onStep?.(waves.length, total, trials)
        start -= granularity
      }
    }
    if (!removedSomething) granularity = Math.floor(granularity / 2)
  }

  onStep?.(waves.length, total, trials)
  return slice(waves)
}
