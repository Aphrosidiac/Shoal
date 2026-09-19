import type { Ctx } from '../ctx.js'
import * as map from '../store/repo/map.js'
import * as queue from '../store/repo/queue.js'
import * as coverage from '../store/repo/coverage.js'
import { scoreOf } from '../queue/score.js'
import { PLANNER } from './prompts/index.js'
import { PERSONAS } from './personas.js'
import { ModelDown } from '../model/index.js'
import type { Link, MissionPayload } from '../queue/kinds.js'

/**
 * Goals in plain English, generated from the map rather than written by us.
 * When the scout finds a screen called "Invoices" with a form on it, that is
 * a mission: make one, and check it is there afterwards.
 *
 * Written by code from the shape of the map. A generative planner, if one is
 * configured, adds richer ones on top — but nothing about a mission needs a
 * model to write: the noun is in the URL, the form is in the map, and the
 * success test is always the same shape: the thing you made is shown with
 * the values you gave it. That is what makes read-back automatic — the agent
 * has a reason to look, and something concrete for the judge to compare.
 *
 * Depth comes from chains. A form on /app/invoices/:id needs an invoice to
 * exist, and in a fresh account none does; so the mission is "create an
 * order" and then "open an invoice and set its status", walked in one
 * account, in that order. The prerequisite is read off the map: the create
 * form for the same noun if there is one, else the create form for whichever
 * noun's pages link into this one. The bugs a swarm never reached in ten
 * minutes all sat behind exactly this: the second screen of a chain.
 */
export async function writeMissions(ctx: Ctx, want = 6): Promise<number> {
  let added = fromMap(ctx, want)
  if (added < want && ctx.models.plannerUp() && ctx.models.plannerBudgetLeft() > 0) {
    added += await fromPlanner(ctx, want - added)
  }
  coverage.bump(ctx.db, 'missions_written', added)
  return added
}

type Candidate = { links: Link[]; key: string; depth: number; fresh?: boolean; pre?: string; persona?: string }

/**
 * A form is not tested by one visit. The same create form is a different
 * test with a number below zero in it, with a required field left empty,
 * with the button pressed twice — so a form mission is written once per
 * persona that changes what happens at the form, and the queue runs each.
 * Every other mission runs once, as whoever is next.
 */
const FORM_PERSONAS = ['the beginner', 'the extremist', 'the incomplete one', 'the impatient one', 'the copy-paster', 'the one who changes their mind']
const ACT_PERSONAS = ['the beginner', 'the extremist']

function fromMap(ctx: Ctx, want: number): number {
  const shape = readMap(ctx)
  const candidates: Candidate[] = []

  // Creating and editing things on the screens that show a list of them.
  for (const f of shape.forms) {
    if (f.onDetail) continue
    if (f.fields.length) {
      if (!f.noun) continue
      FORM_PERSONAS.forEach((persona, i) =>
        candidates.push({ links: [createLink(f)], key: `mission:${f.verb.toLowerCase()}:${f.pattern}:${f.name}:${persona}`, depth: f.depth + i * 30, persona })
      )
    } else if (f.submit) {
      // A button with no fields — "Mark all as read", "Run the sync" — is
      // still a thing the app can be told to do, and still a screen to read
      // afterwards.
      candidates.push({
        links: [{
          goal: `On ${f.pattern}, press the "${f.submit}" button and look at what the screen says afterwards.`,
          success: `the screen shows what pressing "${f.submit}" did, and nothing on it disagrees with that.`,
        }],
        key: `mission:press:${f.pattern}:${f.submit}`,
        depth: f.depth + 5,
      })
    }
  }

  // Opening one record from its list and reading it.
  for (const p of shape.lists) {
    candidates.push({
      links: [{
        goal: `Open the ${p.noun} list at ${p.pattern}, open one ${p.noun} from it, and read its details.`,
        success: `one ${p.noun}'s own page is open and its details agree with the row it was opened from.`,
      }],
      key: `mission:open:${p.pattern}`,
      depth: p.depth + 10,
    })
  }

  // Acting on one record: the form on /app/invoices/:id. The chain first
  // makes something for it to act on.
  for (const f of shape.forms) {
    if (!f.onDetail || !f.noun) continue
    const pre = prerequisites(shape, f.noun)[0] ?? null
    const act: Link = {
      goal:
        `Open the ${f.noun} list at ${f.listPattern ?? 'the ' + f.noun + ' list'}, open one ${f.noun} from it, then ${f.verb.toLowerCase()} ` +
        (f.trailing ? `it using the form at ${f.pattern}` : `it using the "${f.name}" form on its page`) +
        (f.fields.length ? ` (fields: ${f.fields.slice(0, 6).join(', ')}). Fill every field it needs and submit it.` : ` by pressing "${f.submit}".`),
      success: `the ${f.noun}'s page shows the ${f.fields.length ? 'values you entered' : 'result of what you did'}, and nothing on it disagrees with that.`,
    }
    ACT_PERSONAS.forEach((persona, i) =>
      candidates.push({
        links: pre ? [pre.link, act] : [act],
        key: `mission:act:${f.pattern}:${f.name}:${persona}`,
        depth: f.depth + 20 + i * 30,
        persona,
        // No way to make one: hope an old account has one.
        ...(pre ? { pre: pre.noun } : { fresh: false }),
      })
    )
  }

  // Shallow first: the thing an invoice depends on is made on a shallower
  // screen than the invoice. A chain is walked, not waited for.
  candidates.sort((a, b) => a.depth - b.depth)
  let n = 0
  for (const c of candidates) {
    if (n >= want) break
    if (push(ctx, c.links, c.key, { ...(c.fresh === undefined ? {} : { fresh: c.fresh }), ...(c.pre ? { pre: c.pre } : {}), ...(c.persona ? { persona: c.persona } : {}) })) n++
  }
  return n
}

/**
 * Ways to make a <noun> exist, best first: its own create form; then the
 * create form of a noun whose record page links to it (an order's page
 * links to invoices, because making the order made one); then a noun whose
 * list page does. With a navigation bar on every screen the map cannot tell
 * the second from the third, so the runtime tries them in turn.
 */
function prerequisites(shape: MapShape, noun: string): Array<{ noun: string; link: Link }> {
  const creator = (n: string): FormOnMap | undefined =>
    shape.forms.find((f) => !f.onDetail && f.verb === 'Create' && f.noun === n && f.fields.length)
  const out: Array<{ noun: string; link: Link }> = []
  const own = creator(noun)
  if (own) out.push({ noun, link: createLink(own) })
  const parents = [...(shape.parents.get(noun) ?? [])].sort((a, b) => Number(b.strong) - Number(a.strong))
  for (const parent of parents) {
    if (parent.noun === noun || out.some((o) => o.noun === parent.noun)) continue
    const f = creator(parent.noun)
    if (f) out.push({ noun: parent.noun, link: createLink(f) })
  }
  return out
}

function createLink(f: FormOnMap): Link {
  const what = f.verb === 'Create' ? `a new ${f.noun}` : `the ${f.noun}`
  return {
    goal:
      `${f.verb} ${what} using the "${f.name}" form on ${f.pattern}` +
      (f.inDialog ? ` — it opens when you press the button for it` : '') +
      ` (fields: ${f.fields.slice(0, 6).join(', ')}). Fill every field it needs and submit it.`,
    success:
      f.verb === 'Create'
        ? `the new ${f.noun} is shown — in the list or on its own page — with the values you entered.`
        : `the ${f.noun} is shown with the values you entered.`,
  }
}

type FormOnMap = {
  pattern: string
  depth: number
  noun: string | null
  onDetail: boolean
  /** /app/invoices/:id/pay -> "pay": the action after the id. */
  trailing: string | null
  listPattern: string | null
  name: string
  submit: string | null
  inDialog: boolean
  fields: string[]
  verb: 'Create' | 'Update' | 'Pay'
}
type MapShape = {
  forms: FormOnMap[]
  lists: Array<{ pattern: string; noun: string; depth: number }>
  /** noun -> the nouns whose pages have links into its pages; strong when the link is on a record's own page. */
  parents: Map<string, Array<{ noun: string; strong: boolean }>>
}

function readMap(ctx: Ctx): MapShape {
  // A JSON response the explorer followed a link into is in the map as a
  // page; it is not a screen anyone works on.
  const pages = map.pages(ctx.db).filter((p) => p.requires_auth && !/^\/api\//.test(p.url_pattern))
  const patterns = new Set(pages.map((p) => p.url_pattern))
  const listOf = (pattern: string): string | null => {
    const i = pattern.indexOf('/:id')
    return i < 0 ? null : pattern.slice(0, i)
  }
  const forms: FormOnMap[] = []
  const lists: MapShape['lists'] = []
  const seenList = new Set<string>()
  for (const p of pages) {
    const pattern = p.url_pattern
    const depth = pattern.split('/').filter(Boolean).length
    const onDetail = pattern.includes(':id')
    // Settings and profile screens are not lists of a noun, but the form on
    // one is still a form: "Update the settings".
    const own = /\/(settings|profile|preferences|account)$/i.exec(pattern)?.[1]?.toLowerCase() ?? null
    const noun = (onDetail ? recordNoun(pattern) : nounOf(pattern)) ?? own
    for (const f of map.formsOnPage(ctx.db, p.id)) {
      const fields = map.fieldsOf(ctx.db, f.id).filter((x) => x.type !== 'password' && x.type !== 'hidden')
      if (/search|filter|find/i.test(fields.map((x) => x.name).join(' ')) && fields.length === 1) continue
      if (!fields.length && !f.submit) continue
      const after = onDetail ? pattern.slice(pattern.indexOf('/:id') + 4).split('/').filter(Boolean)[0] ?? null : null
      const verb: FormOnMap['verb'] = /pay/i.test(after ?? pattern) ? 'Pay' : /edit|settings|profile|status/i.test(after ?? pattern) || onDetail ? 'Update' : 'Create'
      forms.push({
        pattern, depth, noun, onDetail, trailing: after, listPattern: onDetail ? listOf(pattern) : null,
        name: f.name ?? f.submit ?? 'form', submit: f.submit, inDialog: f.in_dialog === 1,
        fields: fields.map((x) => x.name), verb,
      })
    }
    // A list worth opening a record from is one whose records have a page.
    if (!onDetail && noun && depth <= 3 && patterns.has(`${pattern}/:id`) && !seenList.has(pattern)) {
      seenList.add(pattern)
      lists.push({ pattern, noun, depth })
    }
  }
  // Which nouns lead to which: an edge from /app/orders/:id to /app/invoices
  // makes "order" a parent of "invoice".
  const byId = new Map(pages.map((p) => [p.id, p]))
  const parents = new Map<string, Array<{ noun: string; strong: boolean }>>()
  for (const p of pages) {
    const onDetail = p.url_pattern.includes(':id')
    const from = onDetail ? recordNoun(p.url_pattern) : nounOf(p.url_pattern)
    if (!from) continue
    for (const e of map.edgesFrom(ctx.db, p.id)) {
      const to = byId.get(e.to_page_id)
      if (!to) continue
      const toNoun = to.url_pattern.includes(':id') ? recordNoun(to.url_pattern) : nounOf(to.url_pattern)
      if (!toNoun || toNoun === from) continue
      const list: Array<{ noun: string; strong: boolean }> = parents.get(toNoun) ?? []
      const have = list.find((x) => x.noun === from)
      if (have) have.strong ||= onDetail
      else list.push({ noun: from, strong: onDetail })
      parents.set(toNoun, list)
    }
  }
  return { forms, lists, parents }
}

async function fromPlanner(ctx: Ctx, want: number): Promise<number> {
  const excerpt = mapExcerpt(ctx)
  if (!excerpt || !ctx.cfg.planner) return 0
  let text: string
  try {
    const res = await ctx.models.run('planner', 'planner', {
      system: PLANNER,
      maxTokens: ctx.cfg.planner.maxTokens,
      tools: [],
      messages: [
        {
          role: 'user',
          content:
            `${excerpt}\n\nWrite ${want} goals. One per line, in this exact shape and nothing else:\n` +
            `GOAL: <what to do> || SUCCESS: <what should be true afterwards, with a number or a value in it>`,
        },
      ],
    })
    text = res.text ?? ''
  } catch (e) {
    if (e instanceof ModelDown) ctx.log('model', `planner unavailable: ${e.message}`)
    return 0
  }
  let added = 0
  for (const line of text.split('\n')) {
    const m = /GOAL:\s*(.+?)\s*\|\|\s*SUCCESS:\s*(.+)/i.exec(line)
    if (!m) continue
    const goal = m[1]!.trim().slice(0, 220)
    const success = m[2]!.trim().slice(0, 220)
    if (goal.length < 8 || /sign ?up|log ?in|log ?out|delete (my|the) account|change .*password/i.test(goal)) continue
    if (push(ctx, [{ goal, success }], `mission:${goal.toLowerCase().replace(/\s+/g, ' ').slice(0, 80)}`)) added++
  }
  return added
}

let rotation = 0
function push(ctx: Ctx, links: Link[], key: string, opts: { fresh?: boolean; pre?: string; triedPre?: string[]; persona?: string } = {}): boolean {
  const persona = opts.persona ? personaNamed(opts.persona) : PERSONAS[rotation++ % PERSONAS.length]!
  const [first, ...then] = links
  const payload: MissionPayload = {
    goal: first!.goal, success: first!.success, persona: persona.name,
    fresh: opts.fresh ?? persona.world === 'fresh', ...(then.length ? { then } : {}), key,
    ...(opts.pre ? { pre: opts.pre } : {}), ...(opts.triedPre?.length ? { triedPre: opts.triedPre } : {}),
  }
  const id = queue.push(ctx.db, { kind: 'mission', payload, score: scoreOf(ctx.db, 'mission', {}), dedupeKey: key })
  if (id) ctx.log('mission', `${links.map((l) => l.goal.slice(0, 60)).join(' → ')} — as ${persona.name}`)
  return id !== null && id !== undefined && id !== 0
}

const personaNamed = (name: string) => PERSONAS.find((p) => p.name === name) ?? PERSONAS[0]!

/**
 * The mission for a screen that turned out to need data it has none of:
 * the same links again, with the next way of making that data in front.
 * Called when a crew stood on an empty list and could go no further. Each
 * requeue tries a prerequisite not tried before, so a wrong guess at which
 * noun makes an invoice costs one mission, not the bug.
 */
export function chainWithPrerequisite(ctx: Ctx, p: MissionPayload, path: string): boolean {
  if (!p.key) return false
  const base = p.key.replace(/:chained:.*$/, '')
  const pattern = ctx.patterns.pattern(path)
  const noun = pattern.includes(':id') ? recordNoun(pattern) : nounOf(pattern)
  if (!noun) return false
  const tried = [...(p.triedPre ?? []), ...(p.pre ? [p.pre] : [])]
  const next = prerequisites(readMap(ctx), noun).find((o) => !tried.includes(o.noun))
  if (!next) return false
  // The act is whatever was not a prerequisite: everything after the first
  // link when code put one there, else the whole mission.
  const act: Link[] = p.pre ? (p.then ?? []) : [{ goal: p.goal, success: p.success }, ...(p.then ?? [])]
  if (!act.length) return false
  return push(ctx, [next.link, ...act], `${base}:chained:${next.noun}`, { pre: next.noun, triedPre: tried, persona: p.persona })
}

/** /app/invoices/:id/pay -> "pay"; /app/customers -> "customer". */
export function nounOf(pattern: string): string | null {
  const parts = pattern.split('/').filter((x) => x && !x.startsWith(':') && !/^(app|admin|dashboard|new|edit|create)$/i.test(x))
  const last = parts[parts.length - 1]
  if (!last) return null
  // A profile handle, a slug with a hash in it, a number: an address, not a noun.
  if (/^@|\d{3,}|^[a-f0-9]{8,}$|^me$/i.test(last)) return null
  if (/^(log-?in|sign-?in|sign-?up|register|log-?out|sign-?out|verify|reset|forgot|help|profile|settings|notifications|reports?|search|contact|about|pricing|terms|privacy|membership)$/i.test(last)) return null
  return singular(last)
}

/** /app/invoices/:id/pay -> "invoice": the thing the id names. */
export function recordNoun(pattern: string): string | null {
  const parts = pattern.split('/').filter(Boolean)
  const i = parts.indexOf(':id')
  const seg = i > 0 ? parts[i - 1]! : parts[parts.length - 1]
  if (!seg || seg.startsWith(':') || /^(app|admin|dashboard)$/i.test(seg)) return null
  return singular(seg)
}

const singular = (s: string): string => s.replace(/ies$/, 'y').replace(/s$/, '').replace(/[-_]/g, ' ')

/** Only the shape of the app, never its data. */
function mapExcerpt(ctx: Ctx): string | null {
  const pages = map.pages(ctx.db).filter((p) => p.requires_auth)
  if (pages.length < 3) return null
  const lines: string[] = ['This app has these screens:']
  for (const p of pages.slice(0, 24)) {
    const forms = map.formsOnPage(ctx.db, p.id)
    const fields = forms.flatMap((f) => map.fieldsOf(ctx.db, f.id).map((x) => x.name))
    lines.push(
      `  ${p.url_pattern}${p.title ? `  "${p.title}"` : ''}` +
        (fields.length ? `  — a form taking ${[...new Set(fields)].slice(0, 8).join(', ')}` : '')
    )
  }
  const writes = map
    .endpoints(ctx.db)
    .filter((e) => e.writes)
    .slice(0, 20)
    .map((e) => `  ${e.method} ${e.path_pattern}`)
  if (writes.length) lines.push('', 'and these are the things it can be told to do:', ...writes)
  return lines.join('\n')
}
