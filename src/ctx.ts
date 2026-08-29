import type { Config } from './config.js'
import type { DB } from './store/db.js'
import type { AppWatch } from './target/watch.js'
import type { Patterns } from './map/normalise.js'
import type { Models } from './model/index.js'
import type { Throttle } from './budget/throttle.js'
import type { MailCatcher } from './signup/mail.js'
import type { AuthStore } from './signup/auth.js'
import type { Meter } from './budget/meter.js'

/**
 * The handful of things every worker needs. Passed explicitly rather than
 * imported as globals, because a 24-hour run has to be debuggable and a
 * module-level singleton is invisible in a stack trace.
 */
export type Ctx = {
  cfg: Config
  db: DB
  runId: number
  base: string
  patterns: Patterns
  app: AppWatch
  models: Models
  throttle: Throttle
  mail: MailCatcher | null
  auth: AuthStore
  meter: Meter
  log: (kind: string, message: string) => void
  stopping: () => boolean
  /** Off only in the M1 bench, where we want to measure the model itself. */
  driverPreferFast?: boolean
}
