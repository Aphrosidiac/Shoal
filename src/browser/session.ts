import type { BrowserContext, Page } from 'playwright'
import type { Ctx } from '../ctx.js'
import type { Account } from '../store/repo/accounts.js'
import * as accounts from '../store/repo/accounts.js'
import * as map from '../store/repo/map.js'
import { noteLinks } from '../map/links.js'
import { Recorder } from './record.js'
import { render, snapshot, type Snapshot } from './snapshot.js'
import * as act from './act.js'
import type { BrowserPool } from './pool.js'

/**
 * A context, an account and a recorder. An agent's hands, and the only way
 * anything in `agent/` touches the app.
 */
export class Session {
  page!: Page
  context!: BrowserContext
  recorder!: Recorder
  account: Account | null = null
  last: Snapshot | null = null
  pageId: number | null = null

  constructor(private ctx: Ctx, private pool: BrowserPool, readonly worker: string) {}

  async start(): Promise<void> {
    this.context = await this.pool.context()
    this.recorder = new Recorder(this.ctx, this.worker)
    this.recorder.attach(this.context)
    this.page = await this.context.newPage()
  }

  async stop(): Promise<void> {
    await this.pool.release(this.context)
  }

  use(account: Account | null): void {
    this.account = account
    this.recorder.accountId = account?.id ?? null
  }

  /** Look. Also the only place the map learns a screen exists. */
  async look(): Promise<Snapshot> {
    await this.ctx.throttle.take()
    // Wait for the app to finish drawing itself. A client-rendered list arrives
    // after the document does, so looking too early gives a screen with no
    // table in it — and then a screen with one — and the two fingerprint
    // differently. The same page then looks new every time anybody visits it.
    await this.page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => undefined)
    const s = await snapshot(this.page, (p) => this.ctx.patterns.observe(p))
    this.last = s
    // Whether the browser is carrying a session, not whether we have got
    // round to recording the account yet. The first version asked the latter,
    // so the screen you land on straight after signing up — the single most
    // important screen in the app — was filed as a public page and every
    // explorer was then steered away from it.
    const cookies = await this.context.cookies(this.ctx.base).catch(() => [])
    const page = map.upsertPage(this.ctx.db, {
      url_pattern: s.urlPattern,
      title: s.title,
      screen_fp: s.fp,
      requires_auth: cookies.length > 0,
      example_url: s.url,
    })
    this.pageId = page.id
    this.recorder.pageId = page.id
    this.learnShape(page.id, s)
    noteLinks(this.ctx, s)
    // Hand the replayer a current session for this account. Free, because we
    // already have it.
    if (this.account && cookies.length) {
      this.ctx.auth.put(this.account.id, cookies.map((c) => `${c.name}=${c.value}`).join('; '))
    }
    return s
  }

  private learnShape(pageId: number, s: Snapshot): void {
    for (const c of s.controls.slice(0, 60)) {
      map.addElement(this.ctx.db, {
        page_id: pageId,
        role: c.role,
        name: c.name || null,
        selector: c.selector,
        kind: c.type || null,
      })
    }
    for (const f of s.forms) {
      const form = map.upsertForm(this.ctx.db, { page_id: pageId, name: f.name || f.action || null })
      for (const fd of f.fields) {
        map.upsertField(this.ctx.db, { form_id: form.id, name: fd.name, type: fd.type, required: fd.required })
      }
    }
  }

  text(s?: Snapshot): string {
    return render(s ?? this.last!)
  }

  private async withEdge(fn: () => Promise<act.ActResult>): Promise<act.ActResult> {
    const from = this.pageId
    const r = await fn()
    if (r.ok) {
      const after = await this.look()
      if (from && this.pageId && this.pageId !== from) {
        map.addEdge(this.ctx.db, from, this.pageId, null)
      }
      void after
    }
    return r
  }

  click(ref: string): Promise<act.ActResult> {
    return this.withEdge(() => act.click(this.page, this.last!, ref))
  }
  type(ref: string, text: string): Promise<act.ActResult> {
    return act.type(this.page, this.last!, ref, text)
  }
  select(ref: string, value: string): Promise<act.ActResult> {
    return this.withEdge(() => act.select(this.page, this.last!, ref, value))
  }
  press(key: string): Promise<act.ActResult> {
    return this.withEdge(() => act.press(this.page, key))
  }
  goto(path: string): Promise<act.ActResult> {
    return this.withEdge(() => act.goto(this.page, this.ctx.base, path))
  }
  back(): Promise<act.ActResult> {
    return this.withEdge(() => act.back(this.page))
  }

  /** The cookies replay needs to speak as this account. */
  async authHeaders(): Promise<Record<string, string>> {
    const cookies = await this.context.cookies(this.ctx.base)
    if (!cookies.length) return {}
    return { cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') }
  }

  /** On a 401 mid-run: re-login once, then give up on the account. */
  async recoverAuth(login: (s: Session, a: Account) => Promise<boolean>): Promise<boolean> {
    if (!this.account) return false
    const ok = await login(this, this.account)
    if (ok) return true
    accounts.markBroken(this.ctx.db, this.account.id, '401 and could not log back in')
    this.ctx.log('account', `${this.account.email} stopped working; making a new one`)
    this.use(null)
    return false
  }
}
