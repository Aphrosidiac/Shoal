import { request } from 'undici'
import type { DB } from '../store/db.js'
import { appVersion, event, noteRestart } from '../store/repo/run.js'
import { fingerprintOf } from './version.js'

/**
 * You will be editing code while this runs. It will hot-reload, and it will
 * crash. Shoal notices, waits, and carries on — and stamps every finding with
 * which build of the app it was seen against.
 */
export class AppWatch {
  private timer: NodeJS.Timeout | null = null
  versionId = 0
  fingerprint = 'unknown'
  down = false

  constructor(private db: DB, private base: string, private everyMs = 10_000) {}

  async start(): Promise<void> {
    await this.check()
    this.timer = setInterval(() => void this.check(), this.everyMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async check(): Promise<void> {
    try {
      const res = await request(this.base, { method: 'GET' })
      const html = await res.body.text()
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : String(v ?? '')
      const fp = fingerprintOf({ html, headers })
      if (this.down) {
        this.down = false
        event(this.db, 'restart', `app came back at ${new Date().toLocaleTimeString()}`)
      }
      if (fp !== this.fingerprint) {
        const wasKnown = this.fingerprint !== 'unknown'
        const v = appVersion(this.db, fp)
        if (wasKnown) {
          noteRestart(this.db, v.id)
          event(this.db, 'restart', `app changed: build ${this.fingerprint} -> ${fp}`)
        }
        this.fingerprint = fp
        this.versionId = v.id
      }
    } catch {
      if (!this.down) {
        this.down = true
        event(this.db, 'restart', 'app stopped answering')
      }
    }
  }
}
