import type { Ctx } from '../ctx.js'
import type { Session } from '../browser/session.js'
import type { Snapshot } from '../browser/snapshot.js'
import { DESTRUCTIVE, render } from '../browser/snapshot.js'
import { TOOLS } from './tools.js'
import { fileSurprise } from './surprise.js'
import { normaliseName } from '../map/fingerprint.js'
import * as map from '../store/repo/map.js'
import * as coverage from '../store/repo/coverage.js'
import { ModelDown } from '../model/index.js'
import { live } from '../ui/live.js'

export type LoopOpts = {
  system: string
  goal: string
  worker: string
  maxTurns: number
  /** Screens seen across the whole run, so the fast path survives restarts. */
  memory: RunMemory
}

export type LoopResult = {
  turns: number
  modelCalls: number
  actions: number
  fastActions: number
  reason: 'done' | 'turns' | 'stuck' | 'model-down' | 'error'
  result: string
  notes: string[]
}

/**
 * The map is a cache. Once we know that on screen X the button named
 * "New invoice" leads to screen Y, an agent that wants Y just clicks it — no
 * snapshot sent, no model call, no tokens.
 *
 * The number to watch is model calls per action. It starts near 1.0 and has to
 * fall toward 0.1 as the map fills. If it does not fall, the map is not
 * working and a long run is unaffordable.
 */
export class RunMemory {
  private tried = new Map<string, Set<string>>()
  private visitedPaths = new Set<string>()
  private notes = new Set<string>()

  key(fp: string, role: string, name: string): string {
    void fp
    return `${role}:${normaliseName(name)}`
  }

  untried(s: Snapshot): string[] {
    const done = this.tried.get(s.fp) ?? new Set<string>()
    return s.controls
      .filter((c) => !c.disabled && (c.role === 'link' || c.role === 'button'))
      .filter((c) => !DESTRUCTIVE.test(c.name))
      .filter((c) => !done.has(this.key(s.fp, c.role, c.name)))
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
    set.add(this.key(s.fp, c.role, c.name))
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

/** look -> decide -> act -> record, until done, stuck, or out of turns. */
export async function runLoop(ctx: Ctx, s: Session, opts: LoopOpts): Promise<LoopResult> {
  const out: LoopResult = {
    turns: 0, modelCalls: 0, actions: 0, fastActions: 0,
    reason: 'turns', result: '', notes: [],
  }
  // A rolling one-line-per-step summary, never a transcript. Unbounded history
  // is what kills long-running agents.
  const summary: string[] = []
  let sameScreen = 0
  let lastFp = ''
  let blind = 0
  let typedLastTurn = false
  let refunds = 0

  for (let turn = 0; turn < opts.maxTurns && !ctx.stopping(); turn++) {
    out.turns++
    let snap: Snapshot
    try {
      snap = await s.look()
    } catch (e) {
      // A browser that is mid-navigation, or a page that just crashed, is a
      // turn lost — not a run lost.
      const why = (e as Error).message.split('\n')[0]!
      ctx.log('browser', `${opts.worker} could not read the page: ${why}`)
      if (++blind >= 3) {
        out.reason = 'error'
        out.result = why
        return out
      }
      await new Promise((r) => setTimeout(r, 700))
      continue
    }
    blind = 0
    opts.memory.visit(snap.path)

    // Filling in a four-field form is four turns on one screen fingerprint,
    // because the fingerprint is structural and typing does not change the
    // structure. Counting those as being stuck aborts every form in the app.
    if (snap.fp === lastFp && !typedLastTurn) sameScreen++
    else sameScreen = 0
    typedLastTurn = false
    lastFp = snap.fp
    // Three turns on one screen means whatever is being chosen is not moving
    // us. Asking the same model the same question a fourth time is not going
    // to help, so go somewhere we know we have not been.
    if (sameScreen === 4) {
      const escape = unexploredPath(ctx, opts.memory) ?? knownHome(ctx, opts.memory)
      if (escape) {
        const r = await s.goto(escape)
        out.actions++
        out.fastActions++
        coverage.bump(ctx.db, 'actions')
        summary.push(`nothing was moving on that screen; ${r.note}`)
        if (summary.length > 6) summary.shift()
        continue
      }
    }
    if (sameScreen >= 6) {
      live.worker(opts.worker, 'explorer', { state: 'stuck' })
      ctx.log('stuck', `${opts.worker} has been on the same screen for six turns; moving on`)
      out.reason = 'stuck'
      out.result = `stuck on ${snap.path}`
      return out
    }

    // Already signed in and standing on the login or signup screen: that is
    // not somewhere to explore, it is somewhere to leave. Acting here either
    // does nothing or swaps the account out from under the run.
    // Signed in and standing on a public page. The app under test is the part
    // behind the door; the marketing pages are three links and no behaviour,
    // and a driver left on them will happily describe them all day.
    if (s.account && (isDoorway(snap) || (isPublic(ctx, snap) && opts.memory.seen(snap.fp)))) {
      const home = knownHome(ctx, opts.memory)
      if (home) {
        const r = await s.goto(home)
        out.actions++
        out.fastActions++
        coverage.bump(ctx.db, 'actions')
        summary.push(`left the sign-in screen; ${r.note}`)
        if (summary.length > 6) summary.shift()
        continue
      }
    }

    live.worker(opts.worker, 'explorer', {
      state: 'acting',
      account: s.account?.email ?? null,
      where: `${snap.path} — ${snap.controls.length} elements${opts.memory.seen(snap.fp) ? '' : ', new screen'}`,
      goal: opts.goal.split('\n').find((l) => l.startsWith('Your goal:'))?.slice(10).trim() ?? 'looking around',
    })

    const known = opts.memory.seen(snap.fp)
    opts.memory.touch(snap.fp)

    // ---- fast path: a screen we have seen, and something on it untried ----
    if (known && ctx.driverPreferFast !== false) {
      const untried = opts.memory.untried(snap)
      if (untried.length) {
        const ref = untried[0]!
        opts.memory.markTried(snap, ref)
        const r = await s.click(ref)
        out.actions++
        out.fastActions++
        coverage.bump(ctx.db, 'actions')
        summary.push(`${r.ok ? '' : 'tried to '}${r.note}`)
        if (summary.length > 6) summary.shift()
        continue
      }
      const next = unexploredPath(ctx, opts.memory)
      if (next) {
        const r = await s.goto(next)
        out.actions++
        out.fastActions++
        coverage.bump(ctx.db, 'actions')
        summary.push(r.note)
        if (summary.length > 6) summary.shift()
        continue
      }
    }

    // ---- the model, only when the situation is novel ----
    if (!ctx.models.driverUp()) {
      out.reason = 'model-down'
      out.result = 'the driver is unavailable; the free workers carry on'
      return out
    }

    let choice: { name: string; input: Record<string, unknown> } | null = null
    live.worker(opts.worker, 'explorer', { state: 'thinking' })
    try {
      const res = await ctx.models.run('driver', opts.worker, {
        system: opts.system,
        tools: TOOLS,
        maxTokens: ctx.cfg.driver.maxTokens,
        messages: [
          {
            role: 'user',
            content: [
              opts.goal,
              mapExcerpt(ctx, snap),
              summary.length ? 'what I have done so far:\n' + summary.map((x) => '- ' + x).join('\n') : '',
              'the screen right now:\n' + render(snap),
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
      })
      out.modelCalls++
      choice = res.tool ?? null
      if (!choice) {
        summary.push('the model said nothing usable; picking a link myself')
      }
    } catch (e) {
      if (e instanceof ModelDown) {
        ctx.log('model', `driver unavailable: ${e.message}`)
        out.reason = 'model-down'
        out.result = e.message
        return out
      }
      ctx.log('model', `driver error: ${(e as Error).message}`)
      out.reason = 'error'
      out.result = (e as Error).message
      return out
    }

    // Third failure and the turn falls back to a code-driven choice, which is
    // worse but never blocks.
    if (!choice) {
      const untried = opts.memory.untried(snap)
      if (!untried.length) {
        out.reason = 'stuck'
        out.result = 'no usable choice and nothing left to click'
        return out
      }
      choice = { name: 'click', input: { ref: untried[0]! } }
    }

    // Typing is progress within a screen; noting is not. A driver that writes
    // the same note about the same page nine times running is the definition
    // of stuck, and counting note() as progress hid that completely.
    if (choice.name === 'type' || choice.name === 'select') typedLastTurn = true
    // Writing something down is bookkeeping, not a move. Charging a turn for
    // it means a fifteen-turn scout can spend the whole pass describing
    // screens instead of opening any. Only the note that actually lands is
    // free — refunding a refused one is a loop that never ends.
    if (choice.name === 'note' && !opts.memory.noted(snap.fp) && refunds < 5) {
      refunds++
      turn--
    }
    const step = await dispatch(ctx, s, snap, opts, choice, out)
    live.worker(opts.worker, 'explorer', { state: 'acting', did: step })
    summary.push(step)
    if (summary.length > 6) summary.shift()
    if (out.reason === 'done') return out
  }
  out.result ||= 'ran out of turns'
  return out
}

async function dispatch(
  ctx: Ctx,
  s: Session,
  snap: Snapshot,
  opts: LoopOpts,
  choice: { name: string; input: Record<string, unknown> },
  out: LoopResult
): Promise<string> {
  const i = choice.input
  const ref = typeof i.ref === 'string' ? i.ref : ''
  out.actions++
  coverage.bump(ctx.db, 'actions')

  switch (choice.name) {
    case 'click': {
      const target = snap.controls.find((c) => c.ref === ref)
      if (target && DESTRUCTIVE.test(target.name)) {
        out.actions--
        return `refused to click "${target.name}" — that would end the session`
      }
      opts.memory.markTried(snap, ref)
      const r = await s.click(ref)
      return r.note
    }
    case 'type': {
      const r = await s.type(ref, String(i.text ?? ''))
      return r.note
    }
    case 'select': {
      const r = await s.select(ref, String(i.value ?? ''))
      return r.note
    }
    case 'press': {
      const r = await s.press(String(i.key ?? 'Enter'))
      return r.note
    }
    case 'goto': {
      const r = await s.goto(String(i.path ?? '/'))
      return r.note
    }
    case 'back': {
      const r = await s.back()
      return r.note
    }
    case 'note': {
      out.actions--
      if (opts.memory.noted(snap.fp)) return 'this screen is already written down; go somewhere else'
      const raw = i.fact
      const fact = (typeof raw === 'string' ? raw : raw ? JSON.stringify(raw) : '').slice(0, 300)
      if (!fact) return 'noted nothing'
      opts.memory.markNoted(snap.fp)
      out.notes.push(fact)
      if (s.pageId) map.markExplored(ctx.db, s.pageId)
      ctx.log('note', `${opts.worker}: ${fact}`)
      return `noted: ${fact}`
    }
    case 'surprise': {
      fileSurprise(ctx, opts.worker, String(i.expected ?? ''), String(i.observed ?? ''))
      coverage.bump(ctx.db, 'suspicions')
      out.actions--
      return 'filed a surprise'
    }
    case 'done': {
      out.reason = 'done'
      out.result = String(i.result ?? 'done')
      out.actions--
      return `done: ${out.result}`
    }
    default:
      out.actions--
      return `ignored an unknown tool "${choice.name}"`
  }
}

/** Only the part of the map relevant to this screen. Never the whole thing. */
function mapExcerpt(ctx: Ctx, snap: Snapshot): string {
  const page = map.pageByFp(ctx.db, snap.fp)
  const lines: string[] = []
  const unexplored = map
    .pages(ctx.db)
    .filter((p) => !p.explored)
    .slice(0, 6)
    .map((p) => p.url_pattern)
  if (unexplored.length) lines.push('screens not looked at yet: ' + [...new Set(unexplored)].join(', '))
  if (page) {
    const forms = map.formsOnPage(ctx.db, page.id)
    if (forms.length) lines.push(`this screen has ${forms.length} form${forms.length === 1 ? '' : 's'}`)
  }
  return lines.length ? 'what is already known:\n' + lines.join('\n') : ''
}

const DOORWAY_PATH = /\/(login|signin|sign-in|register|signup|sign-up)\b/i

/** A screen we have also seen without being logged in. */
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
