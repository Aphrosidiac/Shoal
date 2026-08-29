import type { Ctx } from '../ctx.js'
import type { Session } from '../browser/session.js'
import type { Account } from '../store/repo/accounts.js'
import * as accounts from '../store/repo/accounts.js'
import { identity, type Identity } from './identity.js'
import type { Control, Snapshot } from '../browser/snapshot.js'

const SIGNUP_LINK = /sign ?up|register|create (an )?account|get started|join|try (it )?free/i
const LOGIN_LINK = /log ?in|sign ?in/i
const SUBMIT = /sign ?up|register|create|continue|next|submit|get started|join/i

/**
 * Drives a signup form with no model at all. Field types and names are enough
 * to fill an ordinary signup, and this runs many times per run, so paying a
 * model for it would be paying for the same answer over and over.
 *
 * The scout falls back to the driver when this cannot find a way in.
 */
export async function signUp(
  ctx: Ctx,
  s: Session,
  opts: { path?: string | null } = {}
): Promise<{ account: Account; verified: boolean } | { error: string }> {
  const who = identity()

  const start = opts.path ?? (await findSignupPath(ctx, s))
  if (start) await s.goto(start)
  else {
    await s.goto('/')
    const link = s.last!.controls.find((c) => c.role === 'link' && SIGNUP_LINK.test(c.name))
    if (link) await s.click(link.ref)
  }

  let snap = s.last!
  if (!hasSignupShape(snap)) {
    const link = snap.controls.find((c) => c.role === 'link' && SIGNUP_LINK.test(c.name))
    if (link) {
      await s.click(link.ref)
      snap = s.last!
    }
  }
  if (!hasSignupShape(snap)) {
    return { error: `no signup form found. Looked at ${snap.path}. If this app is invite-only or OAuth-only, Shoal cannot get in on its own.` }
  }

  const filled = await fillIdentity(s, snap, who)
  if (!filled) return { error: `found a form at ${snap.path} but no email or password field in it` }

  const before = s.page.url()
  const submit =
    s.last!.controls.find((c) => c.role === 'button' && SUBMIT.test(c.name)) ??
    s.last!.controls.find((c) => c.role === 'button' && !/cancel|back|log ?in/i.test(c.name))
  if (!submit) return { error: 'the signup form has no submit button I could find' }
  await s.click(submit.ref)

  // Some apps show a second step. Fill anything obviously required and go on.
  for (let step = 0; step < 2; step++) {
    if (await signedIn(s)) break
    const more = s.last!
    if (!more.controls.some((c) => c.role === 'textbox' && !c.value)) break
    await fillIdentity(s, more, who)
    const next = more.controls.find((c) => c.role === 'button' && SUBMIT.test(c.name))
    if (!next) break
    await s.click(next.ref)
  }

  const account = accounts.create(ctx.db, {
    email: who.email,
    password: who.password,
    display: who.name,
    role: 'user',
  })
  s.use(account)

  let verified = false
  if (ctx.mail?.listening) {
    verified = await followVerification(ctx, s, who)
    if (verified) accounts.markVerified(ctx.db, account.id)
  }

  if (!(await signedIn(s))) {
    // registered but not logged in: some apps make you log in afterwards
    const ok = await logIn(ctx, s, account)
    if (!ok) {
      accounts.markBroken(ctx.db, account.id, 'registered but could not get a session')
      return { error: `registered ${who.email} but never ended up signed in (still at ${s.page.url()}, was ${before})` }
    }
  }
  return { account, verified }
}

function hasSignupShape(s: Snapshot): boolean {
  const hasPassword = s.controls.some((c) => c.type === 'password')
  const hasEmail = s.controls.some((c) => c.type === 'email' || /e-?mail/i.test(c.name))
  return hasPassword && (hasEmail || s.controls.filter((c) => c.role === 'textbox').length >= 2)
}

async function fillIdentity(s: Session, snap: Snapshot, who: Identity): Promise<boolean> {
  let touchedEmail = false
  let touchedPassword = false
  for (const c of snap.controls) {
    if (c.disabled) continue
    const v = valueFor(c, who)
    if (v === null) continue
    if (c.role === 'combobox') {
      if (c.options.length) await s.select(c.ref, c.options.find((o) => o && !/^(choose|select|--)/i.test(o)) ?? c.options[0]!)
      continue
    }
    if (c.role === 'checkbox') {
      if (/terms|agree|accept|privacy/i.test(c.name)) await s.click(c.ref)
      continue
    }
    if (c.role !== 'textbox') continue
    await s.type(c.ref, v)
    if (c.type === 'email' || /e-?mail/i.test(c.name)) touchedEmail = true
    if (c.type === 'password') touchedPassword = true
  }
  await s.look()
  return touchedEmail && touchedPassword
}

function valueFor(c: Control, who: Identity): string | null {
  const label = `${c.name} ${c.placeholder}`.toLowerCase()
  if (c.type === 'password') return who.password
  if (c.type === 'email' || /e-?mail/.test(label)) return who.email
  if (c.role === 'combobox' || c.role === 'checkbox') return ''
  if (c.role !== 'textbox') return null
  if (/first|given/.test(label)) return who.first
  if (/last|surname|family/.test(label)) return who.last
  if (/full ?name|^name|your name|display/.test(label)) return who.name
  if (/user ?name|handle|nickname/.test(label)) return who.handle
  if (/company|organisation|organization|business|workspace|team/.test(label)) return who.company
  if (/phone|mobile|tel/.test(label) || c.type === 'tel') return who.phone
  if (c.type === 'number') return '1'
  if (c.type === 'url') return 'https://example.test'
  if (c.required) return who.name
  return null
}

/** Signed in means the app says so, not that the URL looks different. */
export async function signedIn(s: Session): Promise<boolean> {
  const snap = await s.look()
  const url = s.page.url()
  if (/\/(login|signin|sign-in|register|signup|sign-up)\b/.test(new URL(url).pathname)) {
    // still on the door
    if (snap.controls.some((c) => c.type === 'password')) return false
  }
  const hasLogout = snap.controls.some((c) => /log ?out|sign ?out/i.test(c.name))
  if (hasLogout) return true
  const hasLoginForm = snap.controls.some((c) => c.type === 'password')
  return !hasLoginForm
}

export async function logIn(ctx: Ctx, s: Session, a: Account): Promise<boolean> {
  const path = (await findLoginPath(ctx, s)) ?? '/login'
  await s.goto(path)
  let snap = s.last!
  if (!snap.controls.some((c) => c.type === 'password')) {
    const link = snap.controls.find((c) => c.role === 'link' && LOGIN_LINK.test(c.name))
    if (!link) return false
    await s.click(link.ref)
    snap = s.last!
  }
  const email = snap.controls.find((c) => c.type === 'email' || /e-?mail|user/i.test(c.name))
  const pass = snap.controls.find((c) => c.type === 'password')
  if (!email || !pass) return false
  await s.type(email.ref, a.email)
  await s.type(pass.ref, a.password)
  await s.look()
  const button = s.last!.controls.find((c) => c.role === 'button' && LOGIN_LINK.test(c.name)) ??
    s.last!.controls.find((c) => c.role === 'button')
  if (!button) return false
  await s.click(button.ref)
  return signedIn(s)
}

async function followVerification(ctx: Ctx, s: Session, who: Identity): Promise<boolean> {
  const mail = await ctx.mail!.waitFor(who.email, 8000)
  if (!mail) return false
  const link = mail.links.find((l) => l.startsWith(ctx.base)) ?? mail.links[0]
  if (!link) return false
  ctx.log('signup', `read a verification mail for ${who.email}`)
  const r = await s.goto(new URL(link).pathname + new URL(link).search)
  return r.ok
}

const SIGNUP_GUESSES = ['/register', '/signup', '/sign-up', '/auth/register', '/users/sign_up', '/join', '/create-account']
const LOGIN_GUESSES = ['/login', '/signin', '/sign-in', '/auth/login', '/users/sign_in']

async function findSignupPath(ctx: Ctx, s: Session): Promise<string | null> {
  return probePaths(ctx, s, SIGNUP_GUESSES, (snap) => hasSignupShape(snap))
}
async function findLoginPath(ctx: Ctx, s: Session): Promise<string | null> {
  return probePaths(ctx, s, LOGIN_GUESSES, (snap) => snap.controls.some((c) => c.type === 'password'))
}

async function probePaths(ctx: Ctx, s: Session, guesses: string[], ok: (s: Snapshot) => boolean): Promise<string | null> {
  for (const p of guesses) {
    const r = await s.goto(p)
    if (!r.ok) continue
    if (ok(s.last!)) return p
  }
  void ctx
  return null
}
