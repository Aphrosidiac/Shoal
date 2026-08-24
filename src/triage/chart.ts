/** A chart is what a voyage leaves behind: the hazard, and how to sail onto it again. */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LogEntry, Sounding, Violation } from '../core/types.js'

export interface Chart {
  target: string
  seed: number
  waves: number
  actors: number
  violations: Violation[]
  serverFaults: LogEntry[]
  starved?: { action: string; attempts: number }[]
  throttled?: number
  log: LogEntry[]
  minimised?: LogEntry[]
  reproductionRate?: string
}

export function writeChart(dir: string, chart: Chart, soundings: Sounding[]) {
  const stamp = `${chart.target}-${chart.seed}`
  writeFileSync(join(dir, `${stamp}.json`), JSON.stringify(chart, null, 2))

  const byId = new Map(soundings.map((s) => [s.id, s]))
  const lines: string[] = [
    `# Shoal chart — ${chart.target}, seed ${chart.seed}`,
    '',
    `${chart.waves} waves · ${chart.actors} actors · ${chart.log.length} actions`,
    '',
  ]

  if (chart.starved?.length) {
    lines.push(
      '## Not exercised',
      '',
      'Every attempt at these was refused. Whatever else this chart says, it says nothing',
      'about them — a swarm turned away at the door looks exactly like a swarm finding nothing.',
      '',
      ...chart.starved.map((s) => `- \`${s.action}\` — ${s.attempts} attempts, 0 succeeded`),
      '',
    )
  }

  if (!chart.violations.length && !chart.serverFaults.length) {
    lines.push(
      chart.starved?.length
        ? 'Nothing tripped, but read the section above before treating that as clear water.'
        : 'No soundings tripped and no server faults. Clear water on this seed.',
      '',
    )
  }

  for (const v of chart.violations) {
    const s = byId.get(v.sounding)
    lines.push(`## ${v.title}`, '', `**Sounding** \`${v.sounding}\` · first seen after wave ${v.atWave}`, '')
    if (s) lines.push(`**Why this must hold.** ${s.because}`, '')
    lines.push('```json', JSON.stringify(v.rows, null, 2), '```', '')
  }

  if (chart.serverFaults.length) {
    const grouped = new Map<string, number>()
    for (const f of chart.serverFaults) {
      const key = `${f.action} → ${f.status || f.error || 'no response'}`
      grouped.set(key, (grouped.get(key) ?? 0) + 1)
    }
    lines.push('## Server faults', '', 'A wrong request is a 4xx. A 5xx is the server admitting fault.', '')
    for (const [k, n] of grouped) lines.push(`- ${k} — ${n}×`)
    lines.push('')
  }

  if (chart.minimised) {
    lines.push(
      '## Minimal reproduction',
      '',
      `Shrunk from ${chart.log.length} actions to ${chart.minimised.length}` +
        (chart.reproductionRate ? ` · reproduces ${chart.reproductionRate}` : ''),
      '',
      '```',
      ...chart.minimised.map(
        (e) => `wave ${String(e.wave).padStart(3)}  ${e.persona.padEnd(10)} ${e.action.padEnd(24)} → ${e.status}`,
      ),
      '```',
      '',
      'Replay it:',
      '',
      '```bash',
      `npm run shoal -- replay charts/${stamp}.json --minimised --attempts 5`,
      '```',
      '',
    )
  }

  const path = join(dir, `${stamp}.md`)
  writeFileSync(path, lines.join('\n'))
  return path
}
