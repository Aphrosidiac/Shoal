import type { Report, Starved } from './build.js'
import type { Finding } from '../store/repo/findings.js'
import { CSS } from '../ui/page.js'

const RULE = '─'.repeat(66)

const pad = (s: string, n: number): string => s.padEnd(n)
const pct = (a: number, b: number): string => (b ? `${Math.round((a / b) * 100)}%` : '—')
const clock = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const dur = (ms: number): string => {
  const m = Math.floor(ms / 60_000)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/**
 * No prose written by a model anywhere in here. Descriptions are assembled
 * from the recording by template, because the one thing this report must be is
 * literally true.
 */
export function text(r: Report): string {
  const out: string[] = []
  out.push(`SHOAL  ${r.appUrl}`)
  out.push(`${dur(r.generatedAt - r.startedAt)} of running, report generated ${clock(r.generatedAt)}`)
  out.push('')

  // Section 4 sits above the verdict, deliberately.
  if (r.starved.length) out.push(...starvedBlock(r.starved), '')
  const noisy = r.events.filter((e) => e.kind === 'restart' || e.kind === 'budget' || e.kind === 'model')
  if (noisy.length) {
    out.push('EVENTS')
    for (const e of noisy.slice(0, 8)) out.push(`  ${clock(e.at)}  ${pad(e.kind, 8)} ${e.message}`)
    out.push('')
  }

  const open = r.findings.filter((f) => f.state === 'open')
  const fixed = r.findings.filter((f) => f.state === 'fixed')
  out.push(RULE)
  out.push(
    open.length
      ? `${open.length} confirmed finding${open.length === 1 ? '' : 's'}${fixed.length ? `, ${fixed.length} since fixed` : ''}`
      : 'No confirmed findings.'
  )
  out.push(RULE)
  out.push('')

  let n = 0
  for (const f of r.findings) {
    out.push(...findingBlock(++n, f, r), '')
  }

  if (r.unconfirmed.length) {
    out.push(RULE)
    out.push(`NOT CONFIRMED  ${r.unconfirmed.length} suspicion${r.unconfirmed.length === 1 ? '' : 's'} that never reproduced`)
    for (const s of r.unconfirmed.slice(0, 12)) {
      out.push(`  #${s.id}  expected ${trim(s.expected, 40)} · saw ${trim(s.observed, 40)}`)
    }
    out.push('')
  }

  const c = r.coverage
  out.push(RULE)
  out.push('COVERAGE')
  out.push(`  pages          ${c.pages}   explored ${c.pagesExplored} (${pct(c.pagesExplored, c.pages)})`)
  out.push(`  endpoints      ${c.endpoints}   hammered ${c.endpointsHammered} of ${c.writeEndpoints} writes`)
  out.push(`  forms          ${c.forms}   fields poked ${c.fieldsPoked} of ${c.fields}`)
  out.push(`  accounts       ${c.accounts}${r.tenancy ? `   tenancy ${r.tenancy}` : ''}`)
  out.push(`  requests seen  ${c.recordings}   actions taken ${c.actions}`)
  if (c.untouchedPages.length) out.push(`  never looked at  ${c.untouchedPages.slice(0, 8).join(' ')}`)
  if (c.untouchedEndpoints.length) out.push(`  never hammered   ${c.untouchedEndpoints.slice(0, 6).join('  ')}`)
  out.push('')
  out.push(
    `  model calls    ${r.spend.calls}  (${r.spend.perAction.toFixed(2)} per action)` +
      `   cached ${pct(r.spend.cached_in, r.spend.in_tokens)}   spend $${r.spend.usd.toFixed(2)}`
  )
  return out.join('\n')
}

function starvedBlock(s: Starved[]): string[] {
  const out = ['STARVED — these were tried and always refused, so a clean result below means less than it looks']
  const w = Math.min(52, Math.max(...s.map((x) => x.action.length)))
  for (const x of s) out.push(`  ${pad(x.action.slice(0, 52), w)}  ${x.ok}/${x.tries}   always ${x.statuses}`)
  return out
}

function findingBlock(n: number, f: Finding, r: Report): string[] {
  const ratio = `${f.reproduced}/${f.attempts}`
  const state = f.state === 'open' ? `confirmed ${ratio}` : f.state === 'fixed' ? `FIXED (was ${ratio})` : `stale`
  const out: string[] = []
  out.push(RULE)
  out.push(`#${n}   ${pad(f.kind.toUpperCase(), 12)} ${pad(state, 20)} ${f.reach} step${f.reach === 1 ? '' : 's'} from signup`)
  out.push(`     ${f.title}`)
  out.push('')
  const repro = r.repro[f.id] as { steps?: Array<Record<string, unknown>>; shrunkFrom?: number; detail?: string } | undefined
  if (repro?.detail) {
    for (const line of wrap(repro.detail, 62)) out.push(`     ${line}`)
    out.push('')
  }
  if (repro?.steps?.length) {
    const from = repro.shrunkFrom && repro.shrunkFrom > repro.steps.length ? `, shrunk from ${repro.shrunkFrom}` : ''
    out.push(`     Repro — ${repro.steps.length} request${repro.steps.length === 1 ? '' : 's'}${from}`)
    repro.steps.forEach((s, i) => {
      const as = s.as ? `  as ${String(s.as)}` : ''
      const note = s.note ? `  <- ${String(s.note)}` : ''
      out.push(
        `       ${i + 1}  ${pad(String(s.method ?? 'GET'), 6)} ${pad(String(s.path ?? ''), 30)}${pad(as, 12)} ${String(s.status ?? '')}${note}`
      )
    })
    out.push('')
  }
  out.push(`     Seen           ${f.occurrences} time${f.occurrences === 1 ? '' : 's'}`)
  out.push(`     First          ${clock(f.first_seen_at)}, app build ${f.app_version_id}`)
  out.push(`     Last           ${clock(f.last_seen_at)}, app build ${f.app_version_id}`)
  const ids = r.recordingIds[f.id] ?? []
  if (ids.length) out.push(`     Recordings     ${ids.slice(0, 4).map((i) => '#' + i).join(' ')}${ids.length > 4 ? `  (+${ids.length - 4})` : ''}`)
  return out
}

export function markdown(r: Report): string {
  const out: string[] = [`# Shoal — ${r.appUrl}`, '', `Generated ${new Date(r.generatedAt).toISOString()} after ${dur(r.generatedAt - r.startedAt)}.`, '']
  if (r.starved.length) {
    out.push('> **Starved.** These actions were tried and always refused, so anything clean below means less than it looks.', '')
    for (const s of r.starved) out.push(`> - \`${s.action}\` ${s.ok}/${s.tries}, always ${s.statuses}`)
    out.push('')
  }
  out.push(`## Findings (${r.findings.filter((f) => f.state === 'open').length} confirmed)`, '')
  if (!r.findings.length) out.push('_Nothing confirmed yet._', '')
  for (const f of r.findings) {
    out.push(`### ${f.kind.toUpperCase()} — ${f.title}`)
    out.push('')
    out.push(`\`${f.reproduced}/${f.attempts}\` reproduced · ${f.reach} steps from signup · seen ${f.occurrences} times · state \`${f.state}\``)
    const repro = r.repro[f.id] as { steps?: Array<Record<string, unknown>>; detail?: string } | undefined
    if (repro?.detail) out.push('', repro.detail)
    if (repro?.steps?.length) {
      out.push('', '```')
      repro.steps.forEach((s, i) =>
        out.push(`${i + 1}  ${String(s.method ?? '')} ${String(s.path ?? '')}${s.as ? '  as ' + String(s.as) : ''}  ${String(s.status ?? '')}`)
      )
      out.push('```')
    }
    out.push('')
  }
  const c = r.coverage
  out.push('## Coverage', '')
  out.push(`| | |`, `|---|---|`)
  out.push(`| pages | ${c.pages} (${c.pagesExplored} explored) |`)
  out.push(`| endpoints | ${c.endpoints} (${c.endpointsHammered} of ${c.writeEndpoints} writes hammered) |`)
  out.push(`| forms | ${c.forms}, ${c.fieldsPoked} of ${c.fields} fields poked |`)
  out.push(`| accounts | ${c.accounts} |`)
  out.push(`| requests | ${c.recordings} |`)
  out.push(`| model calls | ${r.spend.calls} (${r.spend.perAction.toFixed(2)} per action), $${r.spend.usd.toFixed(2)} |`)
  return out.join('\n')
}

const trim = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s)

function wrap(s: string, width: number): string[] {
  const words = s.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) {
      lines.push(line.trim())
      line = w
    } else line += ' ' + w
  }
  if (line.trim()) lines.push(line.trim())
  return lines
}

/**
 * The file, regenerated every minute, openable at any moment and true when you
 * open it. Self-contained: no network, no fonts to fetch, nothing that stops
 * working when you send it to somebody.
 */
export function html(r: Report): string {
  const e = (v: unknown): string =>
    String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
  const CAT: Record<string, string> = {
    leak: 'leak', 'data-loss': 'loss', money: 'money', race: 'race',
    auth: 'auth', fault: 'fault', wrong: 'wrong', slow: 'wrong', noise: 'wrong',
  }
  const open = r.findings.filter((f) => f.state === 'open')
  const c = r.coverage

  const block = (f: Finding, n: number): string => {
    const repro = (r.repro[f.id] ?? {}) as { steps?: Array<Record<string, unknown>>; detail?: string; shrunkFrom?: number }
    const steps = repro.steps ?? []
    return `<details class="f" ${n === 1 ? 'open' : ''}>
<summary><span class="id">#${n}</span><span class="cat ${CAT[f.kind] ?? 'wrong'}">${e(f.kind)}</span>
<span class="ttl">${e(f.title)}</span>
<span class="conf${f.reproduced < f.attempts ? ' part' : ''}"><b>${f.reproduced}/${f.attempts}</b> reproduced</span>
<span class="reach">${f.reach} steps</span></summary>
<div class="body"><p>${e(repro.detail ?? '')}</p>
${steps.length ? `<div class="repro">${steps.map((s, i) => `<div class="rl"><span class="n">${i + 1}</span><span class="m ${e(s.method)}">${e(s.method)}</span><span class="p">${e(s.path)}</span><span class="as">${e(s.as ?? '')}</span><span class="s">${e(s.status)}</span></div>${s.note ? `<div class="note">${e(s.note)}</div>` : ''}`).join('')}</div>` : ''}
<div class="meta">
<div><div class="k">State</div><div class="v">${e(f.state)}</div></div>
<div><div class="k">Seen</div><div class="v">${f.occurrences} times</div></div>
<div><div class="k">First</div><div class="v">${clock(f.first_seen_at)}, build ${f.app_version_id}</div></div>
<div><div class="k">Last</div><div class="v">${clock(f.last_seen_at)}</div></div>
<div><div class="k">Recordings</div><div class="v">${(r.recordingIds[f.id] ?? []).map((i) => '#' + i).join(' ') || '—'}</div></div>
</div></div></details>`
  }

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shoal — ${e(r.appUrl)}</title><style>${CSS}
body{display:block;overflow:auto}
main{max-width:900px;margin:0 auto;padding:24px 20px 60px}
/* The dashboard can assume a wide pane; a file somebody opens cannot. */
.f>summary{grid-template-columns:28px 92px minmax(0,1fr);row-gap:4px}
.f>summary .conf,.f>summary .reach{grid-column:3;justify-self:start}
.f .ttl{white-space:normal;overflow:visible}
.repro .rl{grid-template-columns:16px 54px minmax(0,1fr) auto;row-gap:2px}
.repro .as{grid-column:3;color:var(--dimmer)}
.repro .p{white-space:normal;word-break:break-all}
@media (min-width:760px){
  .f>summary{grid-template-columns:28px 92px minmax(0,1fr) auto auto;row-gap:0}
  .f>summary .conf,.f>summary .reach{grid-column:auto;justify-self:end}
}
</style></head><body><main>
<h2>Shoal <span class="sub">${e(r.appUrl)} · ${dur(r.generatedAt - r.startedAt)} · generated ${clock(r.generatedAt)}</span></h2>
${r.starved.length ? `<div class="pinned"><div class="h">Starved — tried and always refused</div>${r.starved.map((s) => `<div class="s"><span>${e(s.action)}</span><span>${s.ok}/${s.tries}</span><span>always ${e(s.statuses)}</span></div>`).join('')}<div class="note">A swarm being refused looks exactly like a swarm finding nothing. Anything clean below means less than it looks.</div></div>` : ''}
<h2>Findings <span class="sub">${open.length} confirmed${r.findings.length - open.length ? `, ${r.findings.length - open.length} since fixed or stale` : ''}</span></h2>
${r.findings.length ? r.findings.map((f, i) => block(f, i + 1)).join('') : '<p class="note">Nothing has reproduced. Agents file suspicions; only replay turns one into a finding.</p>'}
${r.unconfirmed.length ? `<div class="unconf"><h2>Not confirmed <span class="sub">never reproduced, kept because one that keeps coming back is itself interesting</span></h2>${r.unconfirmed.map((u) => `<div class="u"><span>${e(u.expected)}</span><span>saw</span><span>${e(u.observed)}</span></div>`).join('')}</div>` : ''}
<h2>Coverage</h2>
<div class="counters">
<div class="counter"><div class="k">Pages</div><div class="v">${c.pages} <small>${c.pagesExplored} explored</small></div></div>
<div class="counter"><div class="k">Endpoints</div><div class="v">${c.endpoints} <small>${c.endpointsHammered}/${c.writeEndpoints} hammered</small></div></div>
<div class="counter"><div class="k">Fields poked</div><div class="v">${c.fieldsPoked} <small>/ ${c.fields}</small></div></div>
<div class="counter"><div class="k">Accounts</div><div class="v">${c.accounts} <small>${e(r.tenancy ?? '')}</small></div></div>
<div class="counter"><div class="k">Requests</div><div class="v">${c.recordings}</div></div>
<div class="counter"><div class="k">Calls / action</div><div class="v">${r.spend.perAction.toFixed(2)}</div></div>
<div class="counter"><div class="k">Spend</div><div class="v">$${r.spend.usd.toFixed(2)}</div></div>
</div>
${c.untouchedPages.length ? `<p class="note">Never looked at: ${c.untouchedPages.slice(0, 14).map(e).join(' · ')}</p>` : ''}
${c.untouchedEndpoints.length ? `<p class="note">Never hammered: ${c.untouchedEndpoints.slice(0, 10).map(e).join(' · ')}</p>` : ''}
<h2>Events</h2>
<div class="panel log">${r.events.slice(0, 40).map((v) => `<div class="l"><span class="t">${clock(v.at)}</span><span class="kind k-${e(v.kind)}">${e(v.kind)}</span><span>${e(v.message)}</span></div>`).join('') || '<div class="empty">nothing to report</div>'}</div>
</main></body></html>`
}
