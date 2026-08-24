/**
 * The vocabulary. A voyage takes soundings, writes a log, and produces a chart.
 */

export type Rng = () => number

/** One authenticated actor in the water. */
export interface Session {
  /** Stable across a voyage, so the log names the same actor every time. */
  id: string
  persona: string
  role: string
  email: string
  token: string
  /** Base URL of the target under test. */
  base: string
}

/** A document Shoal has seen, with enough of it to act on. */
export interface DocRef {
  id: string
  docNo: string
  total: number
}

/**
 * What Shoal knows exists right now. Actions read it to choose targets.
 *
 * Deliberately a cache, not a query. If every action re-read the world it
 * would only ever aim at rows that are currently valid, and the interesting
 * requests are the ones aimed at a row another actor has just changed
 * underneath it.
 */
export interface World {
  customers: string[]
  products: string[]
  slots: string[]
  dates: string[]
  quotations: DocRef[]
  invoices: DocRef[]
  deliveries: string[]
}

export interface Outcome {
  status: number
  body: any
  ms: number
}

/**
 * One thing an actor can do.
 *
 * `pick` returns null when the action does not apply to the world as it stands
 * — no invoice to pay, no slot to book. A null is not a failure, it is a turn
 * the actor spends doing something else.
 */
export interface Action<A = any> {
  name: string
  /** Roles permitted to attempt it. An actor outside the list never picks it. */
  roles: string[]
  weight: number
  /** True when several actors hitting this at once is worth forcing. */
  collidable?: boolean
  pick(w: World, rng: Rng): A | null
  run(s: Session, args: A, w: World): Promise<Outcome>
}

export interface Persona {
  name: string
  email: string
  role: string
  /** Multiplies an action's base weight. 0 removes it from this persona. */
  bias: Record<string, number>
}

/**
 * A check that must hold no matter what the actors did.
 *
 * The SQL returns the rows that VIOLATE it — an empty result is a pass. Write
 * it from the domain, never from the implementation: an invariant extracted
 * from the code encodes the code's bugs and then agrees with them for ever.
 */
export interface Sounding {
  id: string
  title: string
  /** Why this is true of the business, not of the code. */
  because: string
  sql: string
}

export interface Violation {
  sounding: string
  title: string
  rows: any[]
  atWave: number
}

/** One dispatched action, in order. The log is what the shrinker chews on. */
export interface LogEntry {
  wave: number
  session: string
  persona: string
  action: string
  args: any
  status: number
  ms: number
  error?: string
  /**
   * The id this action brought into existence, if any.
   *
   * Replay needs it. A voyage's own ids are fresh uuids every run, so a log
   * replayed literally aims at rows that do not exist. Recording what each
   * action produced lets replay rewrite the arguments of every later action
   * through an original-to-replay map, which is what makes a recorded failure
   * re-runnable at all.
   */
  produced?: string
}

export interface Target {
  name: string
  /** Where the target repo lives. */
  root: string
  /** Postgres database the app normally uses; the template is cloned from it. */
  sourceDb: string
  workDb: string
  templateDb: string
  port: number
  personas: Persona[]
  actions: Action[]
  soundings: Sounding[]
  /** Fresh world, read back off the API after a reset. */
  survey(s: Session): Promise<World>
}
