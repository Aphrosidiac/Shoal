import type { Page } from 'playwright'
import type { Control, Snapshot } from './snapshot.js'

export type ActResult = { ok: boolean; note: string }

const SETTLE = 1200

/**
 * Waits for the app to stop talking, but never for very long.
 *
 * The short sleep first is load-bearing. A click handler that does
 * `await fetch()` has not started its request by the time the click
 * returns, so "network idle" is true at that instant and a snapshot taken
 * then is the screen from before the click. The judge then reports every
 * form submit in the app as a control that does nothing.
 */
const inflight = new WeakMap<Page, number>()

/**
 * Count what the page has in flight. `networkidle` gives up after 1.2s, and
 * a dev server compiling a route, or a client-side navigation fetching its
 * data, takes longer than that — so a snapshot taken then is the old page,
 * and the click that caused it is filed as "a control that does nothing".
 * A page with a request in flight is not settled, for up to eight seconds.
 */
export function watch(page: Page): void {
  inflight.set(page, 0)
  page.on('request', (r) => { if (!/^(websocket|eventsource)$/.test(r.resourceType())) inflight.set(page, (inflight.get(page) ?? 0) + 1) })
  const done = () => inflight.set(page, Math.max(0, (inflight.get(page) ?? 1) - 1))
  page.on('requestfinished', done)
  page.on('requestfailed', done)
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) inflight.set(page, 0) })
}

export async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(150)
  for (let i = 0; i < 80 && (inflight.get(page) ?? 0) > 0; i++) await page.waitForTimeout(100)
  try {
    await page.waitForLoadState('networkidle', { timeout: SETTLE })
  } catch {
    /* a page that never idles is normal; carry on */
  }
  // A client-rendered app answers a click after the network is quiet: the
  // route changes, then the data lands, then the view draws. Wait for the
  // screen to hold still for a moment, but never for long.
  try {
    let last = ''
    let still = 0
    for (let i = 0; i < 10 && still < 2; i++) {
      const now = (await page.evaluate("location.href + '|' + (document.body ? document.body.innerText.length : 0) + '|' + document.querySelectorAll('input,button,a,select').length")) as string
      still = now === last ? still + 1 : 0
      last = now
      if (still < 2) await page.waitForTimeout(150)
    }
  } catch {
    /* mid-navigation; the next look() waits for the document */
  }
}

function find(snap: Snapshot, ref: string): Control | null {
  return snap.controls.find((c) => c.ref === ref) ?? null
}

/**
 * Every element ref is validated against the snapshot before it is used. A
 * weak driver invents refs, and an invented ref must be a refusal rather than
 * a click on whatever happens to be there.
 */
export async function click(page: Page, snap: Snapshot, ref: string): Promise<ActResult> {
  const c = find(snap, ref)
  if (!c) return { ok: false, note: `there is no ${ref} on this page` }
  if (c.disabled) return { ok: false, note: `${ref} "${c.name}" is disabled` }
  const before = page.url()
  try {
    await page.locator(c.selector).first().click({ timeout: 5000 })
  } catch (e) {
    // Something is over it — a command palette, a modal, a toast. What a
    // user does is press Escape and try again; so does this, once.
    if (/intercepts pointer events|outside of the viewport/i.test(String((e as Error).message))) {
      try {
        await page.keyboard.press('Escape')
        await page.waitForTimeout(250)
        await page.locator(c.selector).first().click({ timeout: 4000 })
        await settle(page)
        return { ok: true, note: `dismissed what was over it, then clicked ${c.role} "${c.name}"` }
      } catch (e2) {
        return { ok: false, note: `could not click ${ref} "${c.name}": ${short(e2)}` }
      }
    }
    return { ok: false, note: `could not click ${ref} "${c.name}": ${short(e)}` }
  }
  // A link to somewhere else: give the app up to eight seconds to get there
  // before deciding it did not.
  if (c.role === 'link' && c.href && !c.href.startsWith('#') && !/^(mailto|tel|javascript):/.test(c.href)) {
    let target: string | null = null
    try {
      target = new URL(c.href, before).pathname
    } catch {
      target = null
    }
    if (target && target !== new URL(before).pathname) {
      await page.waitForURL((u) => u.href !== before, { timeout: 8000 }).catch(() => undefined)
    }
  }
  await settle(page)
  return { ok: true, note: `clicked ${c.role} "${c.name}"` }
}

export async function type(page: Page, snap: Snapshot, ref: string, text: string): Promise<ActResult> {
  const c = find(snap, ref)
  if (!c) return { ok: false, note: `there is no ${ref} on this page` }
  try {
    const loc = page.locator(c.selector).first()
    await loc.fill('', { timeout: 4000 })
    await loc.fill(text, { timeout: 4000 })
  } catch (e) {
    return { ok: false, note: `could not type into ${ref} "${c.name}": ${short(e)}` }
  }
  return { ok: true, note: `typed ${JSON.stringify(text.slice(0, 40))} into "${c.name}"` }
}

export async function select(page: Page, snap: Snapshot, ref: string, value: string): Promise<ActResult> {
  const c = find(snap, ref)
  if (!c) return { ok: false, note: `there is no ${ref} on this page` }
  try {
    await page.locator(c.selector).first().selectOption(value, { timeout: 4000 })
  } catch {
    try {
      await page.locator(c.selector).first().selectOption({ label: value }, { timeout: 4000 })
    } catch (e) {
      return { ok: false, note: `could not select "${value}" in "${c.name}": ${short(e)}` }
    }
  }
  await settle(page)
  return { ok: true, note: `selected "${value}" in "${c.name}"` }
}

const KEYS = new Set(['Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp', 'Backspace'])

export async function press(page: Page, key: string): Promise<ActResult> {
  const k = KEYS.has(key) ? key : 'Enter'
  try {
    await page.keyboard.press(k)
  } catch (e) {
    return { ok: false, note: `could not press ${k}: ${short(e)}` }
  }
  await settle(page)
  return { ok: true, note: `pressed ${k}` }
}

export async function goto(page: Page, base: string, path: string): Promise<ActResult> {
  let target: URL
  try {
    target = new URL(path, base)
  } catch {
    return { ok: false, note: `"${path}" is not a path I can open` }
  }
  if (target.origin !== new URL(base).origin) {
    return { ok: false, note: 'that is off this site, and Shoal stays on the app under test' }
  }
  try {
    await page.goto(target.toString(), { timeout: 15_000, waitUntil: 'domcontentloaded' })
  } catch (e) {
    return { ok: false, note: `could not open ${target.pathname}: ${short(e)}` }
  }
  await settle(page)
  return { ok: true, note: `opened ${target.pathname}` }
}

export async function back(page: Page): Promise<ActResult> {
  try {
    const r = await page.goBack({ timeout: 8000, waitUntil: 'domcontentloaded' })
    if (!r) return { ok: false, note: 'there is nothing to go back to' }
  } catch (e) {
    return { ok: false, note: `could not go back: ${short(e)}` }
  }
  await settle(page)
  return { ok: true, note: 'went back' }
}

function short(e: unknown): string {
  return String((e as Error)?.message ?? e).split('\n')[0]!.slice(0, 120)
}
