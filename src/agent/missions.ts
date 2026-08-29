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
 * When the scout finds a screen called "Invoices" with a "New invoice" button,
 * that is a mission: create an invoice and get it paid.
 *
 * A mission carries its own success test, which is what makes read-back
 * automatic — the agent then has a reason to look, and something concrete to
 * be surprised by.
 */
export async function writeMissions(ctx: Ctx, want = 4): Promise<number> {
  if (!ctx.models.plannerUp()) return 0
  if (ctx.models.plannerBudgetLeft() <= 0) return 0

  const excerpt = mapExcerpt(ctx)
  if (!excerpt) return 0

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
    const persona = PERSONAS[added % PERSONAS.length]!
    const id = queue.push(ctx.db, {
      kind: 'mission',
      payload: { goal, success, persona: `${persona.name}. ${persona.behaviour}`, fresh: persona.world === 'fresh' },
      score: scoreOf(ctx.db, 'mission', {}),
      dedupeKey: `mission:${goal.toLowerCase().replace(/\s+/g, ' ').slice(0, 80)}`,
    })
    if (id) {
      added++
      ctx.log('mission', goal)
    }
  }
  coverage.bump(ctx.db, 'missions_written', added)
  return added
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
