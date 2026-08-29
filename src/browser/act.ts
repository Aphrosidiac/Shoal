import type { Page } from 'playwright'
import type { Control, Snapshot } from './snapshot.js'

export type ActResult = { ok: boolean; note: string }

const SETTLE = 1200

/** Waits for the app to stop talking, but never for very long. */
async function settle(page: Page): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: SETTLE })
  } catch {
    /* a page that never idles is normal; carry on */
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
  try {
    await page.locator(c.selector).first().click({ timeout: 5000 })
  } catch (e) {
    return { ok: false, note: `could not click ${ref} "${c.name}": ${short(e)}` }
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
