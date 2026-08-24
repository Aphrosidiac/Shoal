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

/**
 * What Shoal knows exists right now. Actions read it to choose targets.
 *
 * A bag of named collections, and deliberately nothing more. This used to name
 * quotations, invoices and delivery windows — one target's nouns welded into
 * the engine's own type, so a second system could not be described without
 * editing core. What a collection holds is the target's business.
 *
 * Deliberately a cache, not a query. If every action re-read the world it would
 * only ever aim at rows that are currently valid, and the interesting requests
 * are the ones aimed at a row another actor has just changed underneath it.
 */
export interface World {
  [collection: string]: any[]
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
export interface Action<A = any, W extends World = World> {
  name: string
  /** Roles permitted to attempt it. An actor outside the list never picks it. */
  roles: string[]
  weight: number
  /** True when several actors hitting this at once is worth forcing. */
  collidable?: boolean
  /**
   * How a collision wave should aim, when identical arguments are the wrong
   * shape of contention.
   *
   * There are two kinds and only one is the default. SAME-ROW contention is
   * five people paying the same invoice, and giving every actor identical
   * arguments reproduces it exactly. SHARED-RESOURCE contention is five
   * different jobs competing for the last place in one delivery window —
   * identical arguments there book one job five times, which is not a race at
   * all. That is why the first validation run missed the overbooking bug: the
   * instrument was aiming the wrong way, and BBF looked clean.
   *
   * Return one argument set per actor, sharing the contended resource and
   * differing in the row each actor acts on.
   */
  collideVariants?(w: W, rng: Rng, actors: number): A[] | null
  pick(w: W, rng: Rng): A | null
  run(s: Session, args: A, w: W): Promise<Outcome>
}

export interface Persona {
  name: string
  email: string
  role: string
  /**
   * How many simultaneous sessions this login runs.
   *
   * Contention is bounded by how many actors can legally reach an action, and
   * roles are page-gated: only LOGISTICS and MANAGER can book a delivery, so a
   * collision wave had two actors against a window with a capacity of four and
   * could never overbook it. Two tabs open on one account is an ordinary way
   * for a person to work, and it is the honest way to raise the pressure.
   */
  instances?: number
  /**
   * Acts without logging in.
   *
   * Whole categories of system are driven mostly by people who have no
   * account: a storefront checkout, a public booking form, a webhook. Shoal
   * required every persona to authenticate, which made those unreachable —
   * and they are exactly where the contention is, because a checkout is the
   * one page thousands of strangers press at once.
   */
  anonymous?: boolean
  /** Multiplies an action's base weight. 0 removes it from this persona. */
  bias: Record<string, number>
}

/**
 * A check that must hold no matter what the actors did.
 *
 * Write it from the domain, never from the implementation: an invariant
 * extracted from the code encodes the code's bugs and then agrees with them
 * for ever.
 *
 * Two kinds, because two kinds of truth are checkable. A SQL sounding reads
 * the state the system ended in. A PROBE sounding asks the system questions
 * and checks the answers against each other — which is the only way to reach
 * anything the database is right about and the API is wrong about: a list that
 * silently returns nothing, a document that will not print, a role that can
 * read a page it was never granted. A 200 with an empty body is not an error
 * and leaves no trace in any table.
 */
interface SoundingBase {
  id: string
  title: string
  /** Why this is true of the business, not of the code. */
  because: string
}

export interface SqlSounding extends SoundingBase {
  kind?: 'sql'
  /** Returns the rows that VIOLATE the rule. Empty is a pass. */
  sql: string
}

export interface ProbeSounding extends SoundingBase {
  kind: 'probe'
  /** Returns violating observations. Empty is a pass. */
  take(ctx: ProbeContext): Promise<any[]>
}

export type Sounding = SqlSounding | ProbeSounding

export interface ProbeContext {
  /** Every actor, by session id, so a probe can ask as a specific role. */
  sessions: Map<string, Session>
  /** The ungated actor, for probes that need to see everything. */
  surveyor: Session
  /** Straight to Postgres, for probes that compare an answer against the truth. */
  sql(text: string): Promise<any[]>
  /**
   * Survives every sweep of one voyage.
   *
   * Some rules are about CHANGE, not about state — a sent document's customer
   * details must never be rewritten — and no single query can see that. A
   * probe remembers what it saw and compares.
   */
  memory: Map<string, unknown>
  world: World
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
   * What the target said when it refused.
   *
   * Without it a log of 400s is unreadable, and a swarm whose every request is
   * being turned away looks identical to a swarm finding nothing. That is
   * exactly how the first two slot-overbooking runs were misread.
   */
  note?: string
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
  /** True for a wave spent building up state rather than looking for anything. */
  season?: true
}

/**
 * A contention worth forcing between DIFFERENT actions.
 *
 * Every collision wave so far is one action many times over. Some races are
 * two different operations reaching for the same thing — closing a delivery
 * date while somebody books onto it — and no amount of repeating one action
 * generates that.
 */
export interface CollisionGroup<W extends World = World> {
  name: string
  /** One item per actor wanted; each names an action and its arguments. */
  build(w: W, rng: Rng, actors: number): { action: string; args: any }[] | null
}

/**
 * A system under test.
 *
 * Generic over its own world so a target can declare what its collections
 * hold and get that back with types, while the engine keeps working against
 * any shape. `Target` on its own means "some target", which is what the CLI
 * and the voyage want.
 */
export interface Target<W extends World = World> {
  name: string
  /** Where the target repo lives. */
  root: string
  /** Postgres database the app normally uses; the template is cloned from it. */
  sourceDb: string
  workDb: string
  templateDb: string
  port: number
  /** Path to the server entry point, relative to `root`. Default `src/server.ts`. */
  entry?: string
  /** Answers 200 once the target is up. Default `/api/health`. */
  healthPath?: string
  /**
   * How this system logs in.
   *
   * Not every API answers the same shape. The first target replied `{ token }`
   * and the second `{ success, data: { token } }`, which is the sort of thing
   * an abstraction with one implementation never finds out.
   */
  auth?: {
    /** Default `/api/auth/login`. */
    path?: string
    /** Pulls the bearer token out of the response. Default `body.token`. */
    token?(body: any): string | undefined
    /** Builds the request body. Default `{ email, password }`. */
    body?(email: string, password: string): unknown
  }
  /**
   * Extra environment for the booted process.
   *
   * Anything the target needs pointed somewhere harmless: a cache the voyage
   * should not share with the developer's own, a scheduler that should stay
   * quiet, an outbound channel that must never reach a real customer.
   */
  env?: Record<string, string>
  /** The frontend, when the target has one worth driving. */
  web?: { root: string; port: number }
  /**
   * Password the personas log in with. Comes from the target's own config file,
   * never from its source.
   */
  password: string
  /**
   * Which persona the survey runs as, by name. Defaults to the first.
   *
   * It has to be one that can see the whole system. This used to look for a
   * persona whose role was literally `MANAGER` — one target's role name, in
   * the engine — so the second target could not survey at all. Whatever it is
   * called, a 403 during setup looks exactly like an empty system.
   */
  surveyAs?: string
  /**
   * Collections the survey must come back with something in.
   *
   * A voyage over an empty world reports clear water on everything, so a target
   * says which parts of the world it cannot meaningfully sail without. Without
   * this the check was three collection names hardcoded in the CLI — one
   * target's nouns deciding whether any other target was ready.
   */
  requiresWorld?: string[]
  personas: Persona[]
  actions: Action<any, W>[]
  soundings: Sounding[]
  collisionGroups?: CollisionGroup<W>[]
  /**
   * Action weights during seasoning.
   *
   * A voyage that starts on the seed and runs eighty waves only ever sees a
   * system with a few dozen rows in it, and the third blind spot an audit has
   * is precisely that real defects live in accumulated data. Seasoning waves
   * run first, with no collisions and no sweeps, weighted to build depth
   * rather than to look for anything.
   */
  seasonBias?: Record<string, number>
  /** Built on demand, so the browser is only launched when asked for. */
  uiProbe?(opts: { url: string }): ProbeSounding
  /** Fresh world, read back off the API after a reset. */
  survey(s: Session): Promise<W>
}
