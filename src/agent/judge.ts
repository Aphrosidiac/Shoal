import type { Ctx } from '../ctx.js'
import type { Snapshot } from '../browser/snapshot.js'
import type { Answer } from '../jev/client.js'
import { asNoul, asChoice } from '../jev/client.js'
import { SUSPECT, type StepState } from '../jev/bank.js'
import * as suspicions from '../store/repo/suspicions.js'
import * as recordings from '../store/repo/recordings.js'
import * as coverage from '../store/repo/coverage.js'
import { findingFp } from '../map/fingerprint.js'
import type { Kind } from '../store/repo/findings.js'
import type { Step } from './trail.js'
import { describe } from './trail.js'

/**
 * The judge. Reads one step — what was done, the screen before, the screen
 * after — and files suspicions. Nothing here is a finding: a suspicion is
 * rewalked in a fresh account and re-judged before it can be one.
 *
 * Two kinds of check, and the order matters:
 *
 *   code first  — anything that is a comparison, a count, a regex or an HTTP
 *                 status is decided here with no model at all. "The request
 *                 answered 500 and the screen says Saved" needs no judgment.
 *   Jev second  — the judgments that need reading: is this a contradiction,
 *                 is this validation about the wrong field, is this dev text.
 *                 Each is a calibrated probability, thresholded at SUSPECT.
 *
 * The composite checks use both: Jev says whether the phone number is shown
 * on screen at all; code says whether the one shown is the one entered.
 */

export type Verdict = {
  check: string
  kind: Kind
  title: string
  detail: string
  expected: string
  observed: string
  /** What distinguishes this from another finding of the same check on the same screen. */
  shape: string
  /** The probability that fired it, or 1 for a code check. */
  p: number
  /** The question to ask again on a rewalk, if there is one. */
  question?: string
  /** Which screen the finding belongs to: where the control was, or where the content is. Default: after. */
  screen?: string
}

export type Judged = {
  verdicts: Verdict[]
  filed: number[]
}

export type StepEvidence = {
  step: StepState
  before: Snapshot
  after: Snapshot
  changed: boolean
  answers: Record<string, Answer>
  /** Recordings this action caused, oldest first. */
  requests: recordings.Recording[]
  /** Which value classes the typist used on this screen. 'normal' means plausible input. */
  valueClasses: string[]
  trail: Step[]
  /** The session was behind the door when the action was taken. A sign-up link on a public page is not a logout. */
  signedIn?: boolean
}

const DEV_TEXT = [
  /\bundefined\b/,
  /\bNaN\b/,
  /\[object Object\]/,
  /\{\{[^}]{1,60}\}\}/,
  /\$\{[^}]{1,60}\}/,
  /\bat\s+\S+\s+\([^)]*:\d+:\d+\)/, // a stack frame
  /\b(TypeError|ReferenceError|SyntaxError|SQLITE_\w+|ECONNREFUSED|ENOENT)\b/,
  /\blorem ipsum\b/i,
]

export function judge(ctx: Ctx, worker: string, ev: StepEvidence, opts: { dry?: boolean } = {}): Judged {
  const verdicts: Verdict[] = []
  const a = ev.answers
  const s = ev.step
  const after = ev.after
  const target = s.action.target ? `${s.action.target.role} "${s.action.target.name}"` : s.action.op
  const failed = ev.requests.filter((r) => (r.status ?? 0) >= 400 && !isDocument(r))
  const worst = failed.sort((x, y) => (y.status ?? 0) - (x.status ?? 0))[0]
  // A click the browser could not deliver — covered by an overlay, gone by
  // the time it landed — did nothing because it never happened.
  const acted = !s.action.failed && (s.action.op === 'click' || s.action.op === 'select' || s.action.op === 'press')
  const pErr = asNoul(a['screen.error'])
  const pOk = asNoul(a['screen.success'])
  const wrote = ev.requests.some((r) => /^(POST|PUT|PATCH|DELETE)$/i.test(r.method) && (r.status ?? 0) < 400)
  // A submit the browser itself refused — a required field empty, an email
  // that is not one — sends nothing and shows a native bubble the DOM cannot
  // see. That is the browser working, not a control that does nothing.
  const nativeRefusal = acted && submitOf(ev.before, s.action.target) !== null && formInvalid(ev.before, submitOf(ev.before, s.action.target)!)
  // A link to the screen already showing does nothing, by design; and the
  // brand link — the first link on the page — goes home whatever it says.
  const href = s.action.target?.href ? pathOf(new URL(s.action.target.href, 'http://x' + ev.before.path).toString()) : null
  const sameTarget = href !== null && href.replace(/\/$/, '') === ev.before.path.replace(/\/$/, '')
  const brandLink = s.action.target?.role === 'link' && ev.before.controls.find((c) => c.role === 'link')?.name === s.action.target?.name

  // ---- code ----
  const dev = DEV_TEXT.find((re) => re.test(after.visibleText))
  if (dev) {
    const m = after.visibleText.match(dev)![0]
    verdicts.push({
      check: 'screen.dev_text', kind: 'fault', shape: m.slice(0, 40), p: 1,
      title: `${after.urlPattern} shows "${m.slice(0, 40)}" to the user`,
      detail: 'Text meant for a developer — an unset variable, a template that never rendered, a stack frame — reached the screen.',
      expected: 'every visible word is meant for a user', observed: `"${m}" on ${after.path}`,
    })
  }

  // A label whose "for" names no element. Clicking it focuses nothing and a
  // screen reader cannot say what the control is. Pure DOM, p = 1; the
  // rewalk sees the same DOM.
  if (after.orphanLabels.length) {
    const names = after.orphanLabels.slice(0, 4).join(', ')
    verdicts.push({
      check: 'screen.orphan_label', kind: 'wrong', shape: after.orphanLabels[0]!, p: 1,
      title: `${after.urlPattern}${after.modal ? ` ("${after.modal}")` : ''} has label${after.orphanLabels.length === 1 ? '' : 's'} pointing at nothing: ${names}`,
      detail: 'A <label for=…> names an id that no element on the screen has. Clicking the label focuses nothing, and assistive technology cannot name the control it was meant for.',
      expected: 'every label is attached to its control', observed: `label${after.orphanLabels.length === 1 ? '' : 's'} ${names} on ${after.path} point at no element`,
    })
  }

  // A control that changes nothing AND sends nothing is a stronger case than
  // one that at least talked to the server, so the bar is lower for it.
  const pShould = asNoul(a['screen.should_have_changed'])
  if (acted && !ev.changed && !nativeRefusal && !sameTarget && pShould >= (ev.requests.length === 0 ? 0.7 : SUSPECT)) {
    verdicts.push({
      check: 'screen.dead_control', screen: ev.before.urlPattern, kind: 'wrong', shape: s.action.target?.name ?? '', p: pShould,
      title: `${target} on ${ev.before.urlPattern} does nothing`,
      detail: `A control that promises an effect — save, create, open, next — produced no visible change: no navigation, no message, no changed value${ev.requests.length ? '' : ', and no request to the server'}. A user presses it again, or gives up.`,
      expected: `${target} visibly does something`, observed: `the screen is identical after ${describe(lastStep(ev.trail))}${ev.requests.length ? '' : ' and nothing was sent'}`,
      question: 'screen.should_have_changed',
    })
  }

  // Every write in the step failed and the screen still says it worked. If
  // one of two double-submits succeeded, the screen is telling the truth.
  if (worst && !wrote && pOk >= SUSPECT && pErr < 0.5) {
    verdicts.push({
      check: 'screen.false_success', screen: ev.before.urlPattern, kind: 'data-loss', shape: String(worst.status), p: pOk,
      title: `${ev.before.urlPattern} says it saved when the request answered ${worst.status}`,
      detail: `The screen confirmed the action while the request behind it (${worst.method} ${pathOf(worst.url)}) failed with ${worst.status}. The user walks away believing the thing exists.`,
      expected: `a failed request is reported as failed`, observed: `${worst.method} ${pathOf(worst.url)} → ${worst.status}, screen says: ${after.messages.join(' | ').slice(0, 120) || 'success'}`,
      question: 'screen.success',
    })
  }

  const enteredNames = Object.keys(s.entered).filter((k) => s.entered[k]!.trim())
  const lost = enteredNames.filter((k) => {
    const f = s.after.fields.find((x) => x.name === k)
    return f !== undefined && f.value.trim() !== s.entered[k]!.trim()
  })
  // All of them gone but at most one: a field reset to a default that happens
  // to equal what was typed (a price box that starts at 100) is not the form
  // keeping the value, and it kept the wipe from ever being seen.
  if (acted && pErr >= SUSPECT && enteredNames.length >= 2 && lost.length >= 2 && lost.length >= enteredNames.length - 1 && after.path === ev.before.path) {
    verdicts.push({
      check: 'screen.lost_input', screen: ev.before.urlPattern, kind: 'wrong', shape: '', p: pErr,
      title: `${ev.before.urlPattern} empties the form when the submit fails`,
      detail: 'The submit was refused and every field the user had filled was cleared. They have to type it all again to fix one thing.',
      expected: 'a refused form keeps what was typed', observed: `${lost.length} filled fields were cleared with "${after.messages[0] ?? ''}" shown`,
      question: 'screen.error',
    })
  }

  // Said it saved, on a screen that lists these things, and the thing is not
  // in the list. The number of rows is code's; whether that is a list is Jev's.
  const kindOfScreen = asChoice(a['screen.kind'])?.choice ?? ''
  const notShown = enteredNames.filter((k) => s.entered[k]!.length >= 3 && !contains(after.visibleText, s.entered[k]!))
  if (
    acted && wrote && pOk >= SUSPECT && pErr < 0.5 && after.path === ev.before.path &&
    (kindOfScreen === 'list' || kindOfScreen === 'empty') && enteredNames.length && notShown.length === enteredNames.length &&
    rowDelta(ev.before, after) <= 0 && !failed.length
  ) {
    verdicts.push({
      check: 'screen.stale_after_write', screen: ev.before.urlPattern, kind: 'wrong', shape: '', p: pOk,
      title: `${ev.before.urlPattern} says it saved and the list does not show it`,
      detail: 'The screen confirmed the write and the list on the same screen was not refreshed, so what the user just made is not there. They make it again.',
      expected: `the list shows ${notShown.map((k) => s.entered[k]).join(', ')}`, observed: `"${after.messages[0] ?? 'saved'}" shown, list unchanged`,
      question: 'screen.success',
    })
  }

  for (const [name, entered] of Object.entries(s.entered)) {
    const shown = asNoul(a[`shows.${name}`])
    if (!wrote || shown < SUSPECT || !entered.trim() || pOk < 0.5) continue
    // A search box echoes its query back trimmed, quoted or not at all; that is not a dropped write.
    if (/search|query|find|filter|\bq\b/i.test(name)) continue
    if (contains(after.visibleText, entered)) continue
    // The value came back with its tags eaten: the app put what was typed
    // into the page as HTML. That is not a dropped value, it is an injection.
    if (/<[a-z]+>/i.test(entered) && contains(after.visibleText, entered.replace(/<[^>]*>/g, ''))) {
      verdicts.push({
        check: 'screen.html_injection', kind: 'fault', shape: name, p: 1,
        title: `${after.urlPattern} renders "${name}" as HTML`,
        detail: `A value typed into "${name}" containing a tag came back on screen with the tag interpreted rather than shown. Whatever a user types into that field runs as markup — script included.`,
        expected: `"${name}" shows the text exactly as typed`, observed: `the tag in ${entered.slice(0, 40)} was swallowed`,
      })
      continue
    }
    verdicts.push({
      check: 'screen.dropped_value', kind: 'data-loss', shape: name, p: shown,
      title: `${ev.before.urlPattern} accepts "${name}" and shows something else`,
      detail: `The user entered a value for "${name}", the app said it saved, and the screen now shows a different value for that field. The write was silently changed or dropped.`,
      expected: `"${name}" shows ${entered}`, observed: `"${name}" is shown but not as ${entered}`,
      question: `shows.${name}`,
    })
  }

  const loginAfter = after.controls.some((c) => c.type === 'password')
  const loginBefore = ev.before.controls.some((c) => c.type === 'password')
  if (ev.signedIn && loginAfter && !loginBefore && s.action.op !== 'goto' && !/log ?out|sign ?out|log ?in|sign ?in|sign ?up|register|create an account/i.test(s.action.target?.name ?? '')) {
    verdicts.push({
      check: 'screen.logged_out', screen: ev.before.urlPattern, kind: 'auth', shape: '', p: 1,
      title: `${target} on ${ev.before.urlPattern} ends the session`,
      detail: 'An ordinary action landed the user on a sign-in screen. Either the session was lost or the route is behind a guard nothing else is.',
      expected: 'the session survives ordinary use', observed: `a password field appeared on ${after.path}`,
    })
  }

  const createdRows = rowDelta(ev.before, after)
  if (acted && createdRows >= 2 && /save|create|add|submit|new|raise|record/i.test(s.action.target?.name ?? '')) {
    verdicts.push({
      check: 'screen.duplicate', kind: 'data-loss', shape: '', p: 1,
      title: `one ${target} on ${ev.before.urlPattern} adds ${createdRows} rows`,
      detail: 'A single submit produced more than one record. Whatever de-duplicates on the server is not there.',
      expected: 'one submit, one row', observed: `${createdRows} rows appeared`,
    })
  }

  // ---- Jev ----
  const direct: Array<[string, Kind, string, string]> = [
    ['screen.contradiction', 'wrong', `${after.urlPattern} shows two things that cannot both be true`, 'The screen displays a status and a control or figure that exclude each other for one record. One of them is lying.'],
    ['screen.wrong_destination', 'wrong', `${target} on ${ev.before.urlPattern} opens the wrong screen`, 'The label promised one thing and the screen that opened is about another.'],

    ['screen.dead_end', 'wrong', `${after.urlPattern} is a dead end`, 'After the action there is nothing the user can do next and no explanation.'],
    ['screen.loading_stuck', 'fault', `${after.urlPattern} never finishes loading`, 'The main content is a loading state with nothing behind it, after the network went quiet.'],
  ]
  const pVal = Math.max(asNoul(a['screen.validation_unknown_field']), asNoul(a['screen.validation_wrong_field']))
  if (pVal >= SUSPECT && pErr >= 0.5 && after.messages.length) {
    const which = asNoul(a['screen.validation_unknown_field']) >= asNoul(a['screen.validation_wrong_field']) ? 'screen.validation_unknown_field' : 'screen.validation_wrong_field'
    verdicts.push({
      check: 'screen.wrong_validation', kind: 'wrong', shape: '', p: pVal, question: which, screen: ev.before.urlPattern,
      title: `${ev.before.urlPattern} blames the wrong field`,
      detail: which === 'screen.validation_unknown_field'
        ? 'The validation message names a field the form does not have. The user cannot fix what they cannot see.'
        : 'The validation message blames a field that was filled correctly, or describes a problem the input does not have. The user fixes the wrong thing.',
      expected: 'a validation message about the field that is actually wrong', observed: `"${after.messages[0]}" after entering ${Object.entries(s.entered).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    })
  }
  const loading = /\b(loading|please wait)\b|…$/i.test(after.visibleText)
  // Typing PAID into a dropdown next to a line that says OPEN is not a
  // contradiction, it is a form half filled. The app has not done anything
  // yet; the screen's state is judged after the step that asks it to.
  const formOnly = s.action.op === 'type' || s.action.op === 'select'
  for (const [check, kind, title, detail] of direct) {
    if (formOnly && check !== 'screen.wrong_destination') continue
    let p = asNoul(a[check])
    if (check === 'screen.loading_stuck') {
      if (!loading) continue
      p = Math.max(p, loading && p >= 0.6 ? SUSPECT : p)
    }
    if (p < SUSPECT) continue
    if (check === 'screen.dead_end' && after.controls.some((c) => c.role === 'link')) continue
    if (check === 'screen.wrong_destination' && (!acted || sameTarget || brandLink)) continue
    if (check === 'screen.wrong_destination' && verdicts.some((v) => v.check === 'screen.logged_out')) continue
    verdicts.push({
      check, kind, title, detail, p, question: check,
      shape: check === 'screen.wrong_destination' ? s.action.target?.name ?? '' : '',
      ...(check === 'screen.wrong_destination' ? { screen: ev.before.urlPattern } : {}),
      expected: check, observed: `${check} at ${(p * 100).toFixed(0)}% on ${after.path}`,
    })
  }
  // The semantic version only where the app's own words are on screen. A
  // list of records the swarm itself filled with "🐟 Ünïcødé" and three
  // hundred x's is placeholder text by any reading, and it is ours.
  const devP = asNoul(a['screen.dev_text'])
  const ownData = kindOfScreen === 'list' || kindOfScreen === 'detail' || after.tables.length > 0
  if (!dev && devP >= SUSPECT && !ownData) {
    verdicts.push({
      check: 'screen.dev_text', kind: 'fault', shape: 'semantic', p: devP, question: 'screen.dev_text',
      title: `${after.urlPattern} shows placeholder or developer text`,
      detail: 'Text that was never meant for a user — a placeholder, a template, a TODO — is on the screen.',
      expected: 'every visible word is meant for a user', observed: `placeholder text at ${(devP * 100).toFixed(0)}% on ${after.path}`,
    })
  }

  // ---- file ----
  const filed: number[] = []
  if (opts.dry) return { verdicts, filed }
  const last = ev.requests[ev.requests.length - 1]
  for (const v of verdicts) {
    const screen = v.screen ?? after.urlPattern
    const fp = findingFp(screen, v.check, v.shape)
    // One suspicion per fingerprint per run. Confirmed, it is already a
    // finding; unreproduced, walking it a third time is not new evidence;
    // open, a confirmer already has it. The one exception: an unreproduced
    // suspicion filed from a shorter trail. The walk that did not hold was
    // a walk that stopped early, and the longer one is new evidence — once.
    const trail = shrinkTrail(ev.trail)
    const earlier = suspicions.allByFp(ctx.db, fp)
    if (earlier.length) {
      const longer = earlier.length < 2 && earlier.every((e) => {
        if (e.state !== 'unreproduced') return false
        const was = (JSON.parse(e.note ?? '{}') as { trail?: unknown[] }).trail ?? []
        return was.length < trail.length
      })
      if (!longer) continue
    }
    const id = suspicions.file(ctx.db, {
      source: 'screen',
      worker,
      recording_id: last?.id ?? null,
      expected: v.expected,
      observed: v.observed,
      note: JSON.stringify({
        check: v.check, kind: v.kind, title: v.title, detail: v.detail, fp, p: v.p,
        question: v.question ?? null, urlPattern: screen, path: after.path,
        trail, entered: s.entered, goal: s.goal,
        kindOfScreen: asChoice(a['screen.kind'])?.choice ?? null,
      }),
    })
    filed.push(id)
    coverage.bump(ctx.db, 'suspicions')
    ctx.log('suspect', `${worker}: ${v.check} ${(v.p * 100).toFixed(0)}% — ${v.title}`)
  }
  return { verdicts, filed }
}

const isDocument = (r: recordings.Recording): boolean => /text\/html/i.test(r.res_headers ?? '') && r.method === 'GET'

export const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

/** "1300" is on a screen that shows "RM 1,300.00"; "Grace Hopper" is on one that shows "GRACE HOPPER". */
export function contains(haystack: string, needle: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\s,]/g, '')
  const h = norm(haystack)
  const n = norm(needle)
  if (!n) return true
  if (h.includes(n)) return true
  const num = Number(needle.replace(/[^\d.-]/g, ''))
  if (Number.isFinite(num) && /\d/.test(needle) && needle.replace(/[^\d.-]/g, '').length >= needle.length - 3) {
    // any numeric token on the screen equal to it, ignoring formatting
    const tokens = haystack.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []
    return tokens.some((t) => Math.abs(Number(t.replace(/,/g, '')) - num) < 1e-9)
  }
  return false
}

/** The form a clicked submit belongs to, if the click was on one. */
function submitOf(snap: Snapshot, target: { role: string; name: string } | undefined): Snapshot['forms'][number] | null {
  if (!target || target.role !== 'button') return null
  const btn = snap.controls.find((c) => c.role === 'button' && c.name === target.name)
  if (!btn) return null
  return snap.forms.find((f) => f.submitRef === btn.ref) ?? null
}

function formInvalid(snap: Snapshot, form: Snapshot['forms'][number]): boolean {
  for (const f of form.fields) {
    const c = snap.controls.find((x) => x.ref === f.ref)
    if (!c) continue
    if (f.required && !c.value.trim() && c.role !== 'checkbox' && c.role !== 'combobox') return true
    if (c.type === 'email' && c.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.value.trim())) return true
    if (c.type === 'number' && c.value.trim() && !Number.isFinite(Number(c.value))) return true
  }
  return false
}

function rowDelta(before: Snapshot, after: Snapshot): number {
  const sum = (s: Snapshot) => s.tables.reduce((n, t) => n + t.count, 0)
  if (!before.tables.length || !after.tables.length) return 0
  return sum(after) - sum(before)
}

const lastStep = (trail: Step[]): Step => trail[trail.length - 1] ?? { op: 'back', url: '' }

/**
 * The steps a rewalk needs. Everything from the first value typed in this
 * account onward, because whatever was typed is what created the invoice the
 * last step is standing on — a fresh account has to make it too. With
 * nothing typed, the last twelve: the rewalk opens each step's own URL
 * before matching a control, so a screen bug found while wandering needs
 * only its immediate approach.
 */
export function shrinkTrail(trail: Step[]): Step[] {
  const firstTyped = trail.findIndex((s) => s.op === 'type' || s.op === 'select')
  const tail = firstTyped >= 0 && trail.length - firstTyped <= 40 ? trail.slice(firstTyped) : trail.slice(-12)
  const first = tail[0]
  if (first && first.op !== 'goto') return [{ op: 'goto', url: first.url, path: first.url }, ...tail]
  return tail
}
