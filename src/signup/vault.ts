import type { Ctx } from '../ctx.js'
import type { Session } from '../browser/session.js'
import type { Account } from '../store/repo/accounts.js'
import * as accounts from '../store/repo/accounts.js'
import { logIn, signUp } from './signup.js'

/**
 * Accounts are reusable, and signup is the reset: a fresh account is a fresh
 * world, so a mission can always start from a known state without cloning a
 * database.
 */
export class Vault {
  private busy = new Set<number>()
  private signupPath: string | null | undefined

  constructor(private ctx: Ctx) {}

  setSignupPath(p: string | null): void {
    this.signupPath = p
  }

  private saidNoSignup = false

  /**
   * A brand new account, for a mission that wants an empty world. On an app
   * with no sign-up there is no such thing: the account the user handed over
   * is used instead, said once, and a "fresh" world is that account as it is.
   */
  async fresh(s: Session): Promise<Account | null> {
    const handed = accounts.givenOnes(this.ctx.db)
    if (handed.length && this.signupPath === null) return this.given(s, handed)
    const r = await signUp(this.ctx, s, { path: this.signupPath ?? null })
    if ('error' in r) {
      if (handed.length) {
        if (!this.saidNoSignup) {
          this.saidNoSignup = true
          this.ctx.log('signup', `no sign-up here (${r.error.split('.')[0]}); using the account you gave. Missions and rewalks share it, so a rewalk is the same account walked again.`)
        }
        return this.given(s, handed)
      }
      this.ctx.log('signup', r.error)
      return null
    }
    this.busy.add(r.account.id)
    this.ctx.log('signup', `made ${r.account.email}${r.verified ? ' (verified by mail)' : ''}`)
    return r.account
  }

  /** An account that has been used before, for the cluttered-world case. */
  async reuse(s: Session): Promise<Account | null> {
    const free = accounts.usable(this.ctx.db).filter((a) => !this.busy.has(a.id))
    for (const a of free) {
      s.use(a)
      if (await logIn(this.ctx, s, a)) {
        this.busy.add(a.id)
        return a
      }
      accounts.markBroken(this.ctx.db, a.id, 'could not log back in')
    }
    return null
  }

  /**
   * A handed-over account is shared, not leased: three explorers can be the
   * same person in three browsers. The least-used one first, so two given
   * accounts still spread across the swarm and the cross-account check has
   * two different people to compare.
   */
  private async given(s: Session, handed: Account[]): Promise<Account | null> {
    const ordered = [...handed].sort((a, b) => (this.uses.get(a.id) ?? 0) - (this.uses.get(b.id) ?? 0))
    for (const a of ordered) {
      s.use(a)
      if (await logIn(this.ctx, s, a)) {
        this.uses.set(a.id, (this.uses.get(a.id) ?? 0) + 1)
        return a
      }
      this.ctx.log('signup', `could not sign in as ${a.email} — check the password, and that the login form takes an email and a password`)
    }
    s.use(null)
    return null
  }
  private uses = new Map<number, number>()

  /** Reuse if there is one, otherwise make one. */
  async any(s: Session): Promise<Account | null> {
    const handed = accounts.givenOnes(this.ctx.db)
    if (handed.length && this.signupPath === null) return this.given(s, handed)
    return (await this.reuse(s)) ?? (await this.fresh(s))
  }

  release(a: Account | null): void {
    if (a) this.busy.delete(a.id)
  }
}
