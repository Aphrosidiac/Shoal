import type { Flags } from './bench-types.js'
export async function bench(flags: Flags): Promise<number> {
  const { runBench } = await import('./bench/run.js')
  return runBench(flags)
}
