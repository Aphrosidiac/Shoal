/**
 * Measure the judge before trusting it. Walks the calibration fixture through
 * every planted screen bug and every planted non-bug with a scripted browser,
 * asks Jev the screen contract at each step, and prints what fired.
 *
 *   npx tsx src/bench/judge.ts [http://localhost:4100]
 *
 * No queue, no store, no swarm: the fixture, one browser, the question bank.
 * Spends about a cent.
 */
import { chromium, type Page, type Response } from 'playwright'
import { loadDotEnv } from '../config.js'
import { Jev, asNoul, asChoice, JEV_USD_PER_MTOK } from '../jev/client.js'
import { SUSPECT, type StepState } from '../jev/bank.js'
import { snapshot, type Snapshot } from '../browser/snapshot.js'
import { settle } from '../browser/act.js'
import { Patterns } from '../map/normalise.js'
import { ask } from '../agent/choose.js'
import { judge } from '../agent/judge.js'
import { marker, pruned } from '../agent/screen.js'
import type { Ctx } from '../ctx.js'
import type { Recording } from '../store/repo/recordings.js'

loadDotEnv()
const BASE = process.argv[2] ?? 'http://localhost:4100'
const key = process.env.TYPESAFE_API_KEY
if (!key) throw new Error('TYPESAFE_API_KEY is not set')
const jev = new Jev({ apiKey: key, model: process.env.SHOAL_JEV_MODEL ?? 'jev-latest', baseUrl: 'https://api.typesafe.ai', maxUsd: 0.2, timeoutMs: 20000 }, null)
const ctx = { jev } as unknown as Ctx
const patterns = new Patterns()

type Scenario = { name: string; expect: string[]; run: (p: Page, w: Walker) => Promise<void> }

class Walker {
  responses: Recording[] = []
  entered: Record<string, string> = {}
  before: Snapshot | null = null
  action: StepState['action'] = { op: 'goto', url_before: '/' }
  recent: string[] = []
  constructor(readonly page: Page) {
    page.on('response', (r: Response) => {
      const req = r.request()
      this.responses.push({
        id: this.responses.length + 1, run_id: 0, app_version_id: 0, account_id: null, page_id: null, endpoint_id: null, worker: 'probe',
        method: req.method(), url: r.url(), req_headers: null, req_body: null, status: r.status(),
        res_headers: JSON.stringify(r.headers()), res_body: null, started_at: Date.now(), ms: 0, action_fp: '', wave_id: null,
      })
    })
  }
  async look(): Promise<Snapshot> {
    await this.page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => undefined)
    return snapshot(this.page, (p) => patterns.observe(p))
  }
  private mark(): void {
    this.responses = []
  }
  async goto(path: string): Promise<void> {
    this.before = await this.look().catch(() => null)
    this.mark()
    this.action = { op: 'goto', url_before: this.before?.path ?? '/' }
    this.entered = {}
    await this.page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
    this.recent.push(`open ${path}`)
  }
  async type(label: string, text: string): Promise<void> {
    const s = await this.look()
    const c = s.controls.find((x) => x.name === label || x.placeholder === label) ?? s.controls.find((x) => x.name.startsWith(label))
    if (!c) throw new Error(`no field "${label}" on ${s.path}`)
    this.before = s
    this.mark()
    await this.page.locator(c.selector).first().fill(text)
    this.entered[label] = text
    this.action = { op: 'type', target: { role: c.role, name: c.name }, text, url_before: s.path }
    this.recent.push(`type "${text}" into "${label}"`)
  }
  async select(label: string, value: string): Promise<void> {
    const s = await this.look()
    const c = s.controls.find((x) => x.name === label) ?? s.controls.find((x) => x.name.startsWith(label))
    if (!c) throw new Error(`no select "${label}" on ${s.path}`)
    this.before = s
    this.mark()
    await this.page.locator(c.selector).first().selectOption(value)
    this.entered[label] = value
    this.action = { op: 'select', target: { role: c.role, name: c.name }, text: value, url_before: s.path }
    this.recent.push(`choose "${value}" in "${label}"`)
  }
  async click(name: string, nth = 0): Promise<void> {
    const s = await this.look()
    const same = name === '@row' ? s.controls.filter((x) => x.role === 'link' && /> td/.test(x.selector)) : s.controls.filter((x) => x.name === name)
    const c = same[nth] ?? same[0]
    if (!c) throw new Error(`no control "${name}" on ${s.path}`)
    this.before = s
    this.mark()
    await this.page.locator(c.selector).first().click({ timeout: 5000 })
    await settle(this.page)
    this.action = { op: 'click', target: { role: c.role, name: c.name }, url_before: s.path }
    this.recent.push(`click ${c.role} "${name}"`)
  }
}

const S: Scenario[] = [
  { name: 'U7 dashboard template', expect: ['screen.dev_text'], run: async (_p, w) => { await w.goto('/app') } },
  { name: 'U6 View all invoices -> orders', expect: ['screen.wrong_destination'], run: async (_p, w) => { await w.goto('/app'); await w.click('View all invoices') } },
  { name: 'U1 Save settings does nothing', expect: ['screen.dead_control'], run: async (_p, w) => { await w.goto('/app/settings'); await w.type('Business name', 'Acme'); await w.click('Save settings') } },
  { name: 'U2 Done. on a 404', expect: ['screen.false_success'], run: async (_p, w) => { await w.goto('/app/notifications'); await w.click('Mark all as read') } },
  { name: 'U3 quick add, list not refetched (empty)', expect: ['screen.stale_after_write', 'screen.contradiction', 'screen.dropped_value'], run: async (_p, w) => { await w.goto('/app/customers'); await w.type('Name', 'Grace Hopper'); await w.click('Quick add') } },
  { name: 'U8+U5 qty 0 refused wrongly, form wiped', expect: ['screen.wrong_validation', 'screen.lost_input'], run: async (_p, w) => { await w.goto('/app/orders/new'); await w.type('Reference', 'REF-1'); await w.type('Quantity', '0'); await w.type('Notes', 'probe'); await w.click('Create order') } },
  { name: 'N create an order properly', expect: [], run: async (_p, w) => { await w.goto('/app/orders/new'); await w.type('Reference', 'REF-2'); await w.type('Quantity', '2'); await w.type('Unit price', '100'); await w.click('Create order') } },
  { name: 'N create a customer properly', expect: [], run: async (_p, w) => { await w.goto('/app/customers/new'); await w.type('Name', 'Ada Lovelace'); await w.type('Phone', '0123456789'); await w.click('Save customer') } },
  { name: 'N customers list (rows) arrival', expect: [], run: async (_p, w) => { await w.goto('/app/customers') } },
  { name: 'N orders list, page one, no Previous', expect: [], run: async (_p, w) => { await w.goto('/app/orders') } },
  { name: 'N pay page with a hint', expect: [], run: async (_p, w) => { await w.goto('/app/invoices'); await w.click('@row') } },
  { name: 'N record a payment', expect: [], run: async (_p, w) => { await w.click('Take a payment'); await w.type('Amount', '100'); await w.click('Record payment') } },
  { name: '#7 paid in full; stored status still UNPAID', expect: ['screen.contradiction'], run: async (_p, w) => { await w.type('Amount', '100'); await w.click('Record payment'); await w.click('Back to the invoice') } },
  { name: 'N set status PAID when fully paid: disabled control with reason', expect: [], run: async (_p, w) => { await w.select('Status', 'PAID'); await w.click('Set status') } },
  { name: 'U4 set status PAID on an unpaid invoice', expect: ['screen.contradiction'], run: async (p, w) => { await w.goto('/app/orders/new'); await w.type('Quantity', '3'); await w.type('Unit price', '100'); await w.click('Create order'); const id = p.url().split('/').pop(); await w.goto(`/app/invoices/${id}`); await w.select('Status', 'PAID'); await w.click('Set status') } },
  { name: 'U9 aging report never loads', expect: ['screen.loading_stuck'], run: async (_p, w) => { await w.goto('/app/reports'); await w.click('Aging report') } },
  { name: 'U10 Download CSV logs out', expect: ['screen.logged_out'], run: async (_p, w) => { await w.goto('/app/reports'); await w.click('Download CSV') } },
]

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  const w = new Walker(page)
  // sign up
  await page.goto(BASE + '/register')
  const email = `probe.${Math.random().toString(36).slice(2, 8)}@shoal.test`
  await page.fill('input[name=email]', email)
  await page.fill('input[name=password]', 'Shoal-Passw0rd!7')
  await page.fill('input[name=name]', 'Probe')
  await page.click('button[type=submit]')
  await page.waitForURL('**/app', { timeout: 8000 }).catch(() => undefined)

  let hits = 0, misses = 0, falsePos = 0, tokens = 0
  const rows: string[] = []
  for (const sc of S) {
    try {
      await sc.run(page, w)
    } catch (e) {
      rows.push(`  ${sc.name.padEnd(52)} could not run: ${(e as Error).message.split('\n')[0]}`)
      continue
    }
    const after = await w.look()
    const before = w.before ?? after
    const step: StepState = { goal: 'use the app', action: w.action, before: pruned(before), after: pruned(after), entered: w.entered, recent: w.recent.slice(-8) }
    const asked = await ask(ctx, 'probe', { drive: false, step, after })
    tokens += asked.usage.input_tokens
    const { verdicts } = judge(ctx, 'probe', { step, before, after, changed: marker(before) !== marker(after), answers: asked.answers, requests: w.responses, valueClasses: [], trail: [], signedIn: before.path.startsWith('/app') }, { dry: true })
    const fired = verdicts.map((v) => `${v.check}${v.p < 1 ? ` ${(v.p * 100).toFixed(0)}%` : ''}`)
    const a = asked.answers
    const top = Object.entries(a)
      .filter(([k, v]) => v.type === 'noul' && k !== 'goal.done')
      .map(([k, v]) => [k, asNoul(v)] as const)
      .filter(([, p]) => p >= 0.4)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 4)
      .map(([k, p]) => `${k.replace('screen.', '')}=${(p * 100).toFixed(0)}`)
    const kind = asChoice(a['screen.kind'])?.choice ?? '?'
    const got = new Set(verdicts.map((v) => v.check))
    const expectedHit = sc.expect.filter((c) => got.has(c))
    const unexpected = [...got].filter((c) => !sc.expect.includes(c))
    if (sc.expect.length) {
      if (expectedHit.length) hits++
      else misses++
    }
    falsePos += unexpected.length
    const mark = sc.expect.length ? (expectedHit.length ? '✓' : '✗') : unexpected.length ? '✗' : '✓'
    rows.push(`${mark} ${sc.name.padEnd(52)} ${kind.padEnd(9)} fired: ${fired.join(', ') || '—'}${unexpected.length ? '   UNEXPECTED: ' + unexpected.join(', ') : ''}\n    ${top.join('  ')}   (${asked.usage.input_tokens} tok, ${asked.ms}ms)` +
      (process.env.PROBE_DEBUG ? `\n    ${before.path} -> ${after.path}  changed=${marker(before) !== marker(after)}  msgs=${JSON.stringify(after.messages)}  reqs=${w.responses.map((r) => r.method + ' ' + r.url.replace(BASE, '') + ' ' + r.status).join(', ')}` : ''))
  }
  await browser.close()
  process.stdout.write(rows.join('\n') + '\n')
  const usd = (tokens * JEV_USD_PER_MTOK) / 1e6
  process.stdout.write(`\nplanted caught ${hits}/${hits + misses}, unexpected verdicts ${falsePos}, ${tokens} tokens, $${usd.toFixed(4)}, threshold ${SUSPECT}\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
