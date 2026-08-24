/**
 * Taking a sounding, whichever kind it is.
 *
 * One entry point so the voyage and the CLI cannot disagree about what a
 * violation is, and so adding a third kind later touches one file.
 */
import type { ProbeContext, Sounding, Violation } from './types.js'

export async function takeSounding(s: Sounding, ctx: ProbeContext, atWave: number): Promise<Violation | null> {
  let rows: any[]
  try {
    rows = s.kind === 'probe' ? await s.take(ctx) : await ctx.sql(s.sql)
  } catch (e: any) {
    // A sounding that cannot run is a broken instrument, not a clean target.
    // Reporting it as a pass is the failure this whole tool exists to avoid.
    return {
      sounding: s.id,
      title: `${s.title} — SOUNDING FAILED TO RUN`,
      rows: [{ error: String(e?.message ?? e).slice(0, 300) }],
      atWave,
    }
  }
  return rows.length ? { sounding: s.id, title: s.title, rows: rows.slice(0, 5), atWave } : null
}

export async function sweepAll(soundings: Sounding[], ctx: ProbeContext, atWave: number): Promise<Violation[]> {
  const out: Violation[] = []
  for (const s of soundings) {
    const v = await takeSounding(s, ctx, atWave)
    if (v) out.push(v)
  }
  return out
}
