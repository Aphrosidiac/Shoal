/**
 * One seed decides every choice Shoal makes about WHAT to do.
 *
 * It does not decide the order the target's event loop serves those requests
 * in, which is the whole point of the exercise — see `replay` in the README.
 */
import type { Rng } from './types.js'

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const pick = <T>(rng: Rng, xs: readonly T[]): T | null =>
  xs.length === 0 ? null : (xs[Math.floor(rng() * xs.length)] as T)

export const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1))

export function weighted<T>(rng: Rng, xs: readonly T[], weight: (x: T) => number): T | null {
  const total = xs.reduce((n, x) => n + Math.max(0, weight(x)), 0)
  if (total <= 0) return null
  let r = rng() * total
  for (const x of xs) {
    r -= Math.max(0, weight(x))
    if (r <= 0) return x
  }
  return xs[xs.length - 1] as T
}
