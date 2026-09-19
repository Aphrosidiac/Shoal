import type { Ctx } from '../ctx.js'
import type { Session } from '../browser/session.js'
import type { Snapshot } from '../browser/snapshot.js'
import { DESTRUCTIVE } from '../browser/snapshot.js'
import { normaliseName } from '../map/fingerprint.js'
import * as map from '../store/repo/map.js'
import * as coverage from '../store/repo/coverage.js'
import * as recordings from '../store/repo/recordings.js'
import { JevDown, BudgetExhausted, asNoul, asChoice } from '../jev/client.js'
import type { StepState } from '../jev/bank.js'
import { ask, type Decision } from './choose.js'
import { judge } from './judge.js'
import { marker, pruned, isEditable } from './screen.js'
import { valueForKind } from './typist.js'
import type { Persona } from './personas.js'
import type { ValueClass } from '../map/values.js'
import { live } from '../ui/live.js'
import { logStep } from './steps.js'

export type LoopOpts = {
  /** explore: code picks where to go and Jev judges every screen. mission: Jev drives toward a goal, and judges. */
  mode: 'explore' | 'mission'
  goal: string
  success?: string
  persona?: Persona
  worker: string
  maxTurns: number
  /** Screens seen across the whole run, so exploration survives restarts. */
  memory: RunMemory
}

export type LoopResult = {
  turns: number
  modelCalls: number
  actions: number
  fastActions: number
  suspicions: number
  reason: 'done' | 'turns' | 'stuck' | 'model-down' | 'error'
  result: string
  notes: string[]
}

/**
 * Which controls on a known screen have been tried. Exploration is
 * depth-first over untried links, in code, for free; Jev is not asked where
 * to go on a screen it has already judged and code already knows.
 */
export class RunMemory {
  private tried = new Map<string, Set<string>>()
  private visitedPaths = new Set<string>()
  private notes = new Set<string>()
  private judged = new Set<string>()

  key(role: string, name: string): string {
    return `${role}:${normaliseName(name)}`
  }

  untried(s: Snapshot): string[] {
    const done = this.tried.get(s.fp) ?? new Set<string>()
    return s.controls
      .filter((c) => !c.disabled && (c.role === 'link' || c.role === 'button'))
      .filter((c) => !DESTRUCTIVE.test(c.name))
      .filter((c) => !done.has(this.key(c.role, c.name)))
      // Depth first. A link back to the site root is always a way out and
      // never a way in, and taking it lands the explorer on the marketing
      // pages, which is where it will happily stay.
      .sort((a, b) => outwardness(a.href, s.path) - outwardness(b.href, s.path))
      .map((c) => c.ref)
  }

  markTried(s: Snapshot, ref: string): void {
    const c = s.controls.find((x) => x.ref === ref)
    if (!c) return
    let set = this.tried.get(s.fp)
    if (!set) this.tried.set(s.fp, (set = new Set()))
    set.add(this.key(c.role, c.name))
  }

  seen(fp: string): boolean {
    return this.tried.has(fp)
  }
  noted(fp: string): boolean {
    return this.notes.has(fp)
  }
  markNoted(fp: string): void {
    this.notes.add(fp)
  }
  touch(fp: string): void {
    if (!this.tried.has(fp)) this.tried.set(fp, new Set())
  }
  visit(path: string): void {
    this.visitedPaths.add(path)
  }
  /** The same action on the same screen leading to the same screen: judged once per run. */
  judgedBefore(key: string): boolean {
    if (this.judged.has(key)) return true
    this.judged.add(key)
    return false
  }
  hasVisited(path: string): boolean {
    return this.visitedPaths.has(path)
  }
}

/** How far a link takes you back toward the front door. Lower is deeper. */
function outwardness(href: string, from: string): number {
  if (!href) return 1
  let path: string
  try {
    path = new URL(href, 'http://x' + from).pathname
  } catch {
    return 1
  }
  if (path === '/' || path === '') return 3
  if (from.startsWith(path) && path.length < from.length) return 2
  return 0
}

type Pending = {
  action: StepState['action']
  before: Snapshot
  watermark: number
  described: string
}

/**
 * look -> ask -> judge -> act, until done, stuck, or out of turns.
 *
 * One Jev request per turn carries both halves: the judgment of the last
 * action (what changed, is anything on this screen wrong) and, in mission
 * mode, the choice of the next one. Code owns the loop; Jev never sees a
 * ref it was not offered and never writes a string that gets typed.
 */
export async function runLoop(ctx: Ctx, s: Session, opts: LoopOpts): Promise<LoopResult> {
  const out: LoopResult = { turns: 0, modelCalls: 0, actions: 0, fastActions: 0, suspicions: 0, reason: 'turns', result: '', notes: [] }
  const recent: string[] = []
  const goal = opts.success ? `${opts.goal} You will know it worked when: ${opts.success}` : opts.goal
  const hooks = opts.persona?.hooks ?? {}
  const classes: ValueClass[] = opts.persona?.classes ?? ['normal']
  let classIdx = 0
  let entered: Record<string, string> = {}
  const usedClasses: string[] = []
  let pending: Pending | null = null
  let unchangedRuns = 0
  let waits = 0
  let blocked = 0
  let blind = 0
  let skippedRequired: string | null = null
  let wentBack = false

  const remember = (line: string) => {
    recent.push(line)
    if (recent.length > 10) recent.shift()
  }

  for (let turn = 0; turn < opts.maxTurns && !ctx.stopping(); turn++) {
    out.turns++
    let snap: Snapshot
    try {
      snap = await s.look()
    } catch (e) {
      const why = (e as Error).message.split('\n')[0]!
      ctx.log('browser', `${opts.worker} could not read the page: ${why}`)
      if (++blind >= 3) {
        out.reason = 'error'
        out.result = why
        return out
      }
      await sleep(700)
      continue
    }
    blind = 0
    opts.memory.visit(snap.path)
    opts.memory.touch(snap.fp)

    // Signed in and standing on the sign-in screen, or on a marketing page:
    // that is somewhere to leave, not somewhere to explore.
    if (s.account && (isDoorway(snap) || (isPublic(ctx, snap) && opts.memory.seen(snap.fp))) && !pending) {
      const home = knownHome(ctx, opts.memory)
      if (home && home !== snap.path) {
        const r = await s.goto(home)
        out.actions++
        out.fastActions++
        remember(r.note)
        continue
      }
    }

    live.worker(opts.worker, opts.mode === 'mission' ? 'crew' : 'explorer', {
      state: 'thinking',
      account: s.account?.email ?? null,
      where: `${snap.path} — ${snap.controls.length} elements${opts.memory.seen(snap.fp) ? '' : ', new screen'}`,
      goal: opts.goal.slice(0, 80),
    })

    // ---- one request: judge the last action, choose the next ----
    const changed = pending ? marker(pending.before) !== marker(snap) : true
    const step: StepState = {
      goal,
      action: pending?.action ?? { op: 'goto', url_before: snap.path },
      before: pruned(pending?.before ?? snap),
      after: pruned(snap),
      entered,
      // Exploration has no story to tell the judge, and leaving it out makes
      // the same screen the same request — which Jev's cache answers for free.
      recent: opts.mode === 'mission' ? recent : [],
    }
    // Exploring re-lands on the same screens all day. The judgment of
    // "clicked Customers on the dashboard and got the customer list" does not
    // change between visits, so it is made once per run.
    if (opts.mode === 'explore') {
      const key = `${pending?.before.fp ?? ''}|${pending?.action.target?.name ?? pending?.action.op ?? ''}|${snap.fp}|${snap.messages.join('/')}`
      if (opts.memory.judgedBefore(key)) {
        const r = await exploreStep(ctx, s, snap, opts, out, unchangedRuns >= 3)
        if (!r) {
          out.reason = 'done'
          out.result = 'nothing left untried from here'
          return out
        }
        pending = r.pending
        remember(r.did)
        continue
      }
    }
    let answers: Awaited<ReturnType<typeof ask>>
    try {
      answers = await ask(ctx, opts.worker, { drive: opts.mode === 'mission', step, after: snap })
      out.modelCalls++
    } catch (e) {
      if (e instanceof BudgetExhausted || e instanceof JevDown) {
        ctx.log('jev', e.message)
        out.reason = 'model-down'
        out.result = e.message
        return out
      }
      ctx.log('jev', `${opts.worker}: ${(e as Error).message.split('\n')[0]}`)
      out.reason = 'error'
      out.result = (e as Error).message
      return out
    }

    const judged = judge(ctx, opts.worker, {
      step,
      before: pending?.before ?? snap,
      after: snap,
      changed,
      answers: answers.answers,
      requests: pending ? recordings.sinceFor(ctx.db, opts.worker, pending.watermark) : [],
      valueClasses: usedClasses,
      trail: s.trail,
      signedIn: Boolean(s.account) && Boolean(pending) && !isDoorway(pending!.before) && !isPublic(ctx, pending!.before),
    })
    out.suspicions += judged.filed.length
    await logStep(ctx, s, { phase: opts.mode, step, after: snap, asked: answers, judged, changed })
    if (pending && pending.action.op !== 'type') entered = {}
    if (!opts.memory.noted(snap.fp)) {
      const kind = asChoice(answers.answers['screen.kind'])
      if (kind && kind.confidence >= 0.6 && s.pageId) {
        map.markExplored(ctx.db, s.pageId)
        out.notes.push(`${snap.path}: ${kind.choice}`)
      }
      opts.memory.markNoted(snap.fp)
    }

    if (pending && pending.action.op !== 'goto') {
      if (!changed && pending.action.op !== 'type') unchangedRuns++
      else unchangedRuns = 0
    }
    if (opts.mode === 'mission' && asNoul(answers.answers['goal.done']) >= 0.9) {
      out.reason = 'done'
      out.result = 'the screen shows the goal achieved'
      return out
    }

    // ---- choose ----
    let did: string
    if (opts.mode === 'explore') {
      const r = await exploreStep(ctx, s, snap, opts, out, unchangedRuns >= 3)
      if (!r) {
        out.reason = 'done'
        out.result = 'nothing left untried from here'
        return out
      }
      pending = r.pending
      did = r.did
    } else {
      const d = answers.decision!
      if (d.operation === 'DONE' && d.confidence >= 0.6) {
        out.reason = 'done'
        out.result = 'chose DONE'
        return out
      }
      if (d.operation === 'BLOCKED' || (d.operation === 'DONE' && d.confidence < 0.6)) {
        if (++blocked >= 2 || unchangedRuns >= 3) {
          out.reason = 'stuck'
          out.result = `blocked on ${snap.path}`
          return out
        }
        await sleep(500)
        remember('nothing usable; looked again')
        pending = null
        continue
      }
      blocked = 0
      if (d.operation === 'WAIT' || !d.target) {
        if (++waits >= 3 || unchangedRuns >= 3) {
          out.reason = 'stuck'
          out.result = `waiting on ${snap.path} went nowhere`
          return out
        }
        await sleep(800)
        remember('waited')
        pending = null
        continue
      }
      waits = 0
      if (unchangedRuns >= 3) {
        out.reason = 'stuck'
        out.result = `nothing changes on ${snap.path}`
        return out
      }
      const watermark = recordings.lastId(ctx.db)
      const r = await missionAct(s, snap, d, {
        classes, classIdx, hooks, skippedRequired, wentBack, entered, usedClasses,
      })
      classIdx = r.classIdx
      skippedRequired = r.skippedRequired
      wentBack = r.wentBack
      did = r.note
      out.actions++
      coverage.bump(ctx.db, 'actions')
      pending = { action: r.action, before: snap, watermark, described: did }
    }
    remember(did)
    live.worker(opts.worker, opts.mode === 'mission' ? 'crew' : 'explorer', { state: 'acting', did })
  }
  out.result ||= 'ran out of turns'
  return out
}

/** Code picks: an untried link on this screen, else a screen nobody has opened, else stop. */
async function exploreStep(
  ctx: Ctx,
  s: Session,
  snap: Snapshot,
  opts: LoopOpts,
  out: LoopResult,
  escape: boolean
): Promise<{ pending: Pending; did: string } | null> {
  const watermark = recordings.lastId(ctx.db)
  const untried = escape ? [] : opts.memory.untried(snap)
  if (untried.length) {
    const ref = untried[0]!
    const c = snap.controls.find((x) => x.ref === ref)!
    opts.memory.markTried(snap, ref)
    const r = await s.click(ref)
    out.actions++
    out.fastActions++
    coverage.bump(ctx.db, 'actions')
    return {
      pending: { action: { op: 'click', target: { role: c.role, name: c.name, ...(c.href ? { href: c.href } : {}) }, url_before: snap.path, ...(r.ok ? {} : { failed: true }) }, before: snap, watermark, described: r.note },
      did: r.note,
    }
  }
  const next = unexploredPath(ctx, opts.memory) ?? (escape ? knownHome(ctx, opts.memory) : null)
  if (!next) return null
  const r = await s.goto(next)
  out.actions++
  out.fastActions++
  coverage.bump(ctx.db, 'actions')
  return { pending: { action: { op: 'goto', url_before: snap.path }, before: snap, watermark, described: r.note }, did: r.note }
}

type ActState = {
  classes: ValueClass[]
  classIdx: number
  hooks: NonNullable<Persona['hooks']>
  skippedRequired: string | null
  wentBack: boolean
  entered: Record<string, string>
  usedClasses: string[]
}

/** Perform Jev's choice, with the persona's bad habits around it. */
async function missionAct(
  s: Session,
  snap: Snapshot,
  d: Decision,
  st: ActState
): Promise<{ action: StepState['action']; note: string; classIdx: number; skippedRequired: string | null; wentBack: boolean }> {
  const c = d.target!
  const target = { role: c.role, name: c.name, ...(c.href ? { href: c.href } : {}) }
  let classIdx = st.classIdx
  let skippedRequired = st.skippedRequired
  let wentBack = st.wentBack

  if (d.operation === 'TYPE_TEXT') {
    const kind = d.fieldKinds[c.ref] ?? 'other'
    if (st.hooks.skipOneRequired && c.required && skippedRequired === null) {
      // The incomplete one: the first required field it meets stays empty. It
      // is still recorded as a step, so a rewalk skips the same field.
      skippedRequired = c.name
      return { action: { op: 'type', target, text: '', url_before: snap.path }, note: `left "${c.name}" empty on purpose`, classIdx, skippedRequired, wentBack }
    }
    const numeric = kind === 'money' || kind === 'quantity'
    const wantsClass = st.classes.length > 1 || st.classes[0] !== 'normal'
    let cls: ValueClass = 'normal'
    if (wantsClass && (numeric || kind === 'person_name' || kind === 'company_name' || kind === 'free_text')) {
      cls = st.classes[classIdx % st.classes.length]!
      if (!numeric && (cls === 'zero' || cls === 'negative' || cls === 'huge' || cls === 'fraction')) cls = 'normal'
      classIdx++
    }
    const text = valueForKind(kind, cls, c.name)
    st.usedClasses.push(cls)
    const r = await s.type(c.ref, text)
    st.entered[c.name || c.placeholder || c.ref] = text
    return { action: { op: 'type', target, text, url_before: snap.path }, note: `${r.note} (${kind}, ${cls})`, classIdx, skippedRequired, wentBack }
  }

  if (d.operation === 'SELECT') {
    const r = await s.select(c.ref, d.option ?? '')
    st.entered[c.name || c.ref] = d.option ?? ''
    return { action: { op: 'select', target, text: d.option ?? '', url_before: snap.path }, note: r.note, classIdx, skippedRequired, wentBack }
  }

  // CLICK
  const submitLike = c.role === 'button' && /save|create|submit|send|add|record|book|pay|confirm|raise|place|update|apply/i.test(c.name)
  if (submitLike && st.hooks.dawdleMs) await sleep(st.hooks.dawdleMs)
  if (submitLike && st.hooks.backAndForward && !wentBack && Object.keys(st.entered).length) {
    wentBack = true
    await s.back()
    await s.goto(snap.path)
    // The form is fresh again; whatever was typed is gone, so type it again.
    const again = s.last!
    for (const [name, text] of Object.entries(st.entered)) {
      const f = again.controls.find((x) => isEditable(x) && (x.name === name || x.placeholder === name))
      if (f) await s.type(f.ref, text)
    }
    const submit = s.last!.controls.find((x) => x.role === c.role && x.name === c.name)
    if (!submit) return { action: { op: 'click', target, url_before: snap.path }, note: 'went back and forward, and the button was gone', classIdx, skippedRequired, wentBack }
    const r = await s.click(submit.ref)
    return { action: { op: 'click', target, url_before: snap.path }, note: `went back, came forward, ${r.note}`, classIdx, skippedRequired, wentBack }
  }
  const r = await s.click(c.ref)
  let note = r.note
  if (!r.ok) return { action: { op: 'click', target, url_before: snap.path, failed: true }, note, classIdx, skippedRequired, wentBack }
  if (r.ok && submitLike && st.hooks.doubleSubmit) {
    // The impatient one. The second click goes to the same control if it is
    // still there; if the app already navigated, there is nothing to double.
    const again = s.last?.controls.find((x) => x.role === c.role && x.name === c.name && s.last!.path === snap.path)
    if (again) {
      await s.click(again.ref)
      note += ', twice'
    }
  }
  if (r.ok && submitLike && st.hooks.refreshAfterSubmit) {
    await s.reload()
    note += ', then reloaded'
  }
  return { action: { op: 'click', target, url_before: snap.path }, note, classIdx, skippedRequired, wentBack }
}

const DOORWAY_PATH = /\/(login|signin|sign-in|register|signup|sign-up)\b/i

function isPublic(ctx: Ctx, snap: Snapshot): boolean {
  const page = map.pageByFp(ctx.db, snap.fp)
  return page ? page.requires_auth === 0 : false
}

function isDoorway(snap: Snapshot): boolean {
  if (snap.controls.some((c) => c.type === 'password')) return true
  return DOORWAY_PATH.test(snap.path)
}

/** Somewhere behind the door that we know exists. */
function knownHome(ctx: Ctx, memory: RunMemory): string | null {
  const pages = map
    .pages(ctx.db)
    .filter((p) => p.requires_auth && p.example_url && !DOORWAY_PATH.test(p.example_url) && p.example_url !== '/')
  const unseen = pages.find((p) => !memory.hasVisited(p.url_pattern))
  return (unseen ?? pages[0])?.example_url ?? null
}

function unexploredPath(ctx: Ctx, memory: RunMemory): string | null {
  for (const p of map.pages(ctx.db)) {
    if (p.explored) continue
    const where = p.example_url ?? p.url_pattern
    if (where.includes(':id')) continue
    if (DOORWAY_PATH.test(where)) continue
    if (memory.hasVisited(p.url_pattern)) continue
    return where
  }
  return null
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
