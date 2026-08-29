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

  /** A brand new account, for a mission that wants an empty world. */
  async fresh(s: Session): Promise<Account | null> {
    const r = await signUp(this.ctx, s, { path: this.signupPath ?? null })
    if ('error' in r) {
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

  /** Reuse if there is one, otherwise make one. */
  async any(s: Session): Promise<Account | null> {
    return (await this.reuse(s)) ?? (await this.fresh(s))
  }

  release(a: Account | null): void {
    if (a) this.busy.delete(a.id)
  }
}
