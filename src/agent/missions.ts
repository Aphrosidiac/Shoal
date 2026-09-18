import type { Ctx } from '../ctx.js'
import * as map from '../store/repo/map.js'
import * as queue from '../store/repo/queue.js'
import * as coverage from '../store/repo/coverage.js'
import { scoreOf } from '../queue/score.js'
import { PLANNER } from './prompts/index.js'
import { PERSONAS } from './personas.js'
import { ModelDown } from '../model/index.js'

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
 */
export async function writeMissions(ctx: Ctx, want = 4): Promise<number> {
  let added = fromMap(ctx, want)
  if (added < want && ctx.models.plannerUp() && ctx.models.plannerBudgetLeft() > 0) {
    added += await fromPlanner(ctx, want - added)
  }
  coverage.bump(ctx.db, 'missions_written', added)
  return added
}

function fromMap(ctx: Ctx, want: number): number {
  const pages = map.pages(ctx.db).filter((p) => p.requires_auth)
  let n = 0
  const candidates: Array<{ goal: string; success: string; key: string; depth: number }> = []
  for (const p of pages) {
    const noun = nounOf(p.url_pattern)
    if (!noun) continue
    const depth = p.url_pattern.split('/').filter(Boolean).length
    for (const f of map.formsOnPage(ctx.db, p.id)) {
      const fields = map.fieldsOf(ctx.db, f.id).filter((x) => x.type !== 'password' && x.type !== 'hidden')
      if (!fields.length) continue
      if (/search|filter|find/i.test(fields.map((x) => x.name).join(' ')) && fields.length === 1) continue
      const verb = /pay/i.test(p.url_pattern) ? 'Pay' : /edit|settings|profile/i.test(p.url_pattern) ? 'Update' : 'Create'
      const what = verb === 'Create' ? `a new ${noun}` : `the ${noun}`
      candidates.push({
        goal: `${verb} ${what} using the form on ${p.url_pattern} (fields: ${fields.map((x) => x.name).slice(0, 6).join(', ')}). Fill every field it needs and submit it.`,
        success: verb === 'Create' ? `the new ${noun} is shown — in the list or on its own page — with the values you entered.` : `the ${noun} is shown with the values you entered.`,
        key: `mission:${verb.toLowerCase()}:${p.url_pattern}:${f.name ?? f.id}`,
        depth,
      })
    }
    if (p.url_pattern.includes(':id') || depth > 3) continue
    candidates.push({
      goal: `Open the ${noun} list at ${p.url_pattern}, open one ${noun} from it, and read its details.`,
      success: `one ${noun}'s own page is open and its details agree with the row it was opened from.`,
      key: `mission:open:${p.url_pattern}`,
      depth: depth + 10,
    })
  }
  // Shallow first: the thing an invoice depends on is made on a shallower
  // screen than the invoice. A chain is walked, not waited for.
  candidates.sort((a, b) => a.depth - b.depth)
  for (const c of candidates) {
    if (n >= want) break
    if (push(ctx, c.goal, c.success, c.key)) n++
  }
  return n
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
    if (push(ctx, goal, success, `mission:${goal.toLowerCase().replace(/\s+/g, ' ').slice(0, 80)}`)) added++
  }
  return added
}

let rotation = 0
function push(ctx: Ctx, goal: string, success: string, key: string): boolean {
  const persona = PERSONAS[rotation++ % PERSONAS.length]!
  const id = queue.push(ctx.db, {
    kind: 'mission',
    payload: { goal, success, persona: persona.name, fresh: persona.world === 'fresh' },
    score: scoreOf(ctx.db, 'mission', {}),
    dedupeKey: key,
  })
  if (id) ctx.log('mission', `${goal.slice(0, 90)} — as ${persona.name}`)
  return id !== null && id !== undefined && id !== 0
}

/** /app/invoices/:id/pay -> "invoice"; /app/customers -> "customer". */
export function nounOf(pattern: string): string | null {
  const parts = pattern.split('/').filter((x) => x && !x.startsWith(':') && !/^(app|admin|dashboard|new|edit|create)$/i.test(x))
  const last = parts[parts.length - 1]
  if (!last) return null
  if (/^(login|signup|register|logout|help|profile|settings|notifications|reports?)$/i.test(last)) return null
  return last.replace(/ies$/, 'y').replace(/s$/, '').replace(/[-_]/g, ' ')
}

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
