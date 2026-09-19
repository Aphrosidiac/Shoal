import type { BrowserContext, Page } from 'playwright'
import type { Ctx } from '../ctx.js'
import type { Account } from '../store/repo/accounts.js'
import * as accounts from '../store/repo/accounts.js'
import * as map from '../store/repo/map.js'
import { noteLinks } from '../map/links.js'
import { Recorder } from './record.js'
import { formName } from '../map/normalise.js'
import { render, snapshot, type Snapshot } from './snapshot.js'
import * as act from './act.js'
import type { BrowserPool } from './pool.js'
import type { Step } from '../agent/trail.js'

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
  /** Every step this account has taken, in rewalkable form. Starts over with a new account. */
  trail: Step[] = []

  constructor(private ctx: Ctx, private pool: BrowserPool, readonly worker: string) {}

  /** A document request is in flight for the main frame: the page is about to be replaced. */
  private navPending = false

  async start(): Promise<void> {
    this.context = await this.pool.context()
    this.recorder = new Recorder(this.ctx, this.worker)
    this.recorder.attach(this.context)
    this.page = await this.context.newPage()
    act.watch(this.page)
    // A dev server compiles a route on its first hit and answers seconds
    // later; a snapshot taken in between is the old page, and the click that
    // caused it is then "a control that does nothing". So a look() waits for
    // a navigation that has started to finish, within reason.
    const main = () => this.page.mainFrame()
    this.page.on('request', (r) => {
      if (r.isNavigationRequest() && r.frame() === main()) this.navPending = true
    })
    const done = (r: { isNavigationRequest: () => boolean; frame: () => unknown }) => {
      if (r.isNavigationRequest() && r.frame() === main()) this.navPending = false
    }
    this.page.on('requestfinished', done)
    this.page.on('requestfailed', done)
    this.page.on('load', () => (this.navPending = false))
  }

  async stop(): Promise<void> {
    await this.pool.release(this.context)
  }

  /** The app under test, for helpers that only have a session. */
  get ctxBase(): string {
    return this.ctx.base
  }

  use(account: Account | null): void {
    if (account?.id !== this.account?.id) this.trail = []
    this.account = account
    this.recorder.accountId = account?.id ?? null
    if (account) this.recorder.claim(account.id)
  }

  /** Look. Also the only place the map learns a screen exists. */
  async look(): Promise<Snapshot> {
    await this.ctx.throttle.take()
    for (let i = 0; i < 150 && this.navPending; i++) await new Promise((r) => setTimeout(r, 100))
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
    // A single-page app keeps its session in localStorage, not a cookie, so
    // "is the browser carrying a session" has to look there too — or every
    // screen behind the door is filed as public, no mission is ever written
    // and the explorers are steered away from the whole app.
    const stored = cookies.length
      ? true
      : await this.page.evaluate("(() => { try { return Object.keys(localStorage).length + Object.keys(sessionStorage).length > 0 } catch (e) { return false } })()").catch(() => false)
    const page = map.upsertPage(this.ctx.db, {
      url_pattern: s.urlPattern,
      title: s.title,
      screen_fp: s.fp,
      requires_auth: cookies.length > 0 || Boolean(stored) || Boolean(this.account),
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
      // A form's action carries an id — data-action="/api/invoices/22/status".
      // Keyed on that, the same form is a new form for every invoice in the
      // app: one run ended with sixty forms where there are ten, its
      // field-tried state split twenty-five ways, and every copy scoring as
      // never-tried. So the identity of a form is its pattern, not its
      // address.
      const name = formName(f.name, f.action, (p) => this.ctx.patterns.pattern(p))
      const form = map.upsertForm(this.ctx.db, { page_id: pageId, name, submit: f.submit || null, in_dialog: Boolean(s.modal) })
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

  /** A control's position among the controls that share its role and name: the third "Open" link. */
  private nth(ref: string): { role: string; name: string; nth: number } {
    const c = this.last!.controls.find((x) => x.ref === ref)
    if (!c) return { role: '?', name: ref, nth: 0 }
    const same = this.last!.controls.filter((x) => x.role === c.role && x.name === c.name)
    return { role: c.role, name: c.name, nth: Math.max(0, same.indexOf(c)) }
  }

  private step(s: Step): void {
    this.trail.push(s)
    if (this.trail.length > 400) this.trail.shift()
  }

  click(ref: string): Promise<act.ActResult> {
    this.step({ op: 'click', url: this.last!.path, ...this.nth(ref) })
    return this.withEdge(() => act.click(this.page, this.last!, ref))
  }
  type(ref: string, text: string): Promise<act.ActResult> {
    this.step({ op: 'type', url: this.last!.path, ...this.nth(ref), text })
    return act.type(this.page, this.last!, ref, text)
  }
  select(ref: string, value: string): Promise<act.ActResult> {
    this.step({ op: 'select', url: this.last!.path, ...this.nth(ref), value })
    return this.withEdge(() => act.select(this.page, this.last!, ref, value))
  }
  press(key: string): Promise<act.ActResult> {
    this.step({ op: 'press', url: this.last?.path ?? '/', key })
    return this.withEdge(() => act.press(this.page, key))
  }
  goto(path: string): Promise<act.ActResult> {
    this.step({ op: 'goto', url: this.last?.path ?? '/', path })
    return this.withEdge(() => act.goto(this.page, this.ctx.base, path))
  }
  back(): Promise<act.ActResult> {
    this.step({ op: 'back', url: this.last?.path ?? '/' })
    return this.withEdge(() => act.back(this.page))
  }
  /** The refresher persona. Not a step a rewalk repeats: reloading is idempotent by definition. */
  async reload(): Promise<act.ActResult> {
    try {
      await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 8000 })
    } catch (e) {
      return { ok: false, note: `could not reload: ${(e as Error).message.split('\n')[0]}` }
    }
    await this.look()
    return { ok: true, note: 'reloaded the page' }
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
