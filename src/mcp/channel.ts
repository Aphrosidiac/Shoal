import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { openReadOnly, shoalDir } from '../store/db.js'
import * as findingsRepo from '../store/repo/findings.js'

export type Push = (level: 'info' | 'warning', text: string) => void

/**
 * Confirmed findings arrive in the session without being asked for.
 *
 * A dashboard you have to remember to open is a dashboard you do not read, and
 * the whole point of running this next to Claude Code is that a bug lands
 * while you are still in the file that caused it.
 *
 * Shoal writes to its own SQLite file from another process, so this watches
 * that file rather than holding a callback: WAL means a reader sees the
 * writer's rows without either side coordinating.
 */
export class Channel {
  private timer: NodeJS.Timeout | null = null
  private lastSeen = 0

  constructor(private dir: string, private push: Push, private everyMs = 5000) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), this.everyMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private tick(): void {
    if (!existsSync(join(shoalDir(this.dir), 'run.db'))) return
    let fresh: findingsRepo.Finding[]
    try {
      const db = openReadOnly(this.dir)
      fresh = findingsRepo.ranked(db).filter((f) => f.id > this.lastSeen && f.state === 'open')
      db.close()
    } catch {
      return // mid-write; try again in five seconds
    }
    for (const f of fresh) {
      this.lastSeen = Math.max(this.lastSeen, f.id)
      this.push(
        f.kind === 'leak' || f.kind === 'data-loss' || f.kind === 'money' ? 'warning' : 'info',
        `Shoal confirmed #${f.id} ${f.kind.toUpperCase()}: ${f.title}  (reproduced ${f.reproduced}/${f.attempts}). ` +
          `Ask for shoal_finding with id ${f.id} to see the repro.`
      )
    }
  }

  /** Anything already on disk when a session attaches is old news. */
  catchUp(): void {
    try {
      const db = openReadOnly(this.dir)
      const rows = findingsRepo.all(db)
      this.lastSeen = rows.reduce((a, f) => Math.max(a, f.id), 0)
      db.close()
    } catch {
      this.lastSeen = 0
    }
  }
}
