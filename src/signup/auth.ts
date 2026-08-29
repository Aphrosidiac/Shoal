import type { Recording } from '../store/repo/recordings.js'
import type { DB } from '../store/db.js'
import { cookiesFrom } from '../replay/request.js'

/**
 * Where the replayer gets a live session from.
 *
 * The browser is for learning and HTTP is for repeating, and that has to
 * include being logged in. A browser context holds a real, current cookie jar
 * for its account; every look() hands it here, and the hammerers and
 * confirmers speak as that account without ever driving a browser.
 *
 * Rebuilding a session from a recorded login is the fallback, not the plan:
 * plenty of apps only ever issue one, at signup, and re-firing that request
 * with the same credentials answers 409 rather than a fresh cookie.
 */
export class AuthStore {
  private live = new Map<number, { cookie: string; at: number }>()

  put(accountId: number, cookie: string): void {
    if (!cookie) return
    const held = this.live.get(accountId)
    if (held?.cookie === cookie) return
    this.live.set(accountId, { cookie, at: Date.now() })
  }

  get(accountId: number): string | null {
    return this.live.get(accountId)?.cookie ?? null
  }

  forget(accountId: number): void {
    this.live.delete(accountId)
  }

  /** Whatever the app handed this account the first time, still on disk. */
  fromRecording(db: DB, accountId: number): string | null {
    const rec = db
      .prepare(
        `SELECT * FROM recordings
         WHERE account_id = ? AND res_headers LIKE '%set-cookie%' AND status < 400
         ORDER BY id ASC LIMIT 1`
      )
      .get(accountId) as Recording | undefined
    if (!rec?.res_headers) return null
    try {
      return cookiesFrom(JSON.parse(rec.res_headers) as Record<string, string>)
    } catch {
      return null
    }
  }
}
