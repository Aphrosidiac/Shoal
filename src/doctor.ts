import { existsSync, statfsSync } from 'node:fs'
import type { Config } from './config.js'
import { assertLocal } from './config.js'
import { probe } from './target/probe.js'
import { shoalDir } from './store/db.js'
import { MailCatcher } from './signup/mail.js'
import { makeModel } from './model/index.js'

const ok = (label: string, detail: string): string => `  ${label.padEnd(10)} ${detail}`
const bad = (label: string, detail: string): string => `  ${label.padEnd(10)} ${detail}   ✗`

/**
 * Runs before anything expensive and checks the six things that ruin a run.
 * The credential line matters most: in claude-code mode ANTHROPIC_API_KEY
 * outranks the OAuth token and would quietly bill at API rates.
 */
export async function doctor(cfg: Config): Promise<number> {
  const lines: string[] = []
  let fail = false

  try {
    assertLocal(cfg.url)
  } catch (e) {
    process.stdout.write(bad('app', (e as Error).message) + '\n')
    return 1
  }

  const p = await probe(cfg.url)
  lines.push(
    p.up
      ? ok('app', `${cfg.url}   up, responds in ${p.ms}ms, ${p.rendering}-rendered${p.title ? `, "${p.title}"` : ''}`)
      : bad('app', `${cfg.url}   ${p.error ?? 'no answer'}`)
  )
  if (!p.up) fail = true

  lines.push(
    p.signupPath
      ? ok('signup', `found at ${p.signupPath}   email + password, no OAuth wall`)
      : bad('signup', 'no signup form found. Shoal cannot get in on its own if the app is invite-only or OAuth-only')
  )
  if (!p.signupPath) fail = true

  const mail = new MailCatcher(cfg.mailPort)
  const mailUp = await mail.start()
  await mail.stop()
  lines.push(
    mailUp
      ? ok('mail', `localhost:${cfg.mailPort}   catcher can listen`)
      : ok('mail', `localhost:${cfg.mailPort}   busy — email verification will be skipped`)
  )

  for (const tier of ['driver', 'planner'] as const) {
    const t = cfg[tier]
    if (t.provider === 'claude-code' && process.env.ANTHROPIC_API_KEY) {
      lines.push(
        bad(
          tier,
          'claude-code with ANTHROPIC_API_KEY set. That variable outranks your subscription OAuth token, ' +
            'so every call would be billed at API rates. Unset it.'
        )
      )
      fail = true
      continue
    }
    try {
      const t0 = Date.now()
      const m = await makeModel(t, tier)
      const res = await m.call({
        system: 'Answer with the tool.',
        messages: [{ role: 'user', content: 'Say ok.' }],
        tools: [
          {
            name: 'done',
            description: 'Say ok.',
            schema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'], additionalProperties: false },
          },
        ],
        maxTokens: 64,
      })
      const how = res.tool
        ? `called the ${res.tool.name} tool`
        : res.text
        ? 'answered in prose, so every turn will go through the repair loop'
        : 'answered with nothing at all'
      lines.push(ok(tier, `${t.provider} / ${m.id}   ${how}, in ${Date.now() - t0}ms`))
    } catch (e) {
      lines.push(bad(tier, `${t.provider} / ${t.model}   ${(e as Error).message.split('\n')[0]}`))
      fail = true
    }
  }

  const dir = shoalDir(cfg.dir)
  let free = ''
  try {
    const s = statfsSync(dir)
    free = `${((s.bavail * s.bsize) / 1e9).toFixed(1)} GB free`
  } catch {
    free = 'free space unknown'
  }
  lines.push(existsSync(dir) ? ok('disk', `.shoal/   writable, ${free}`) : bad('disk', 'cannot create .shoal/'))

  process.stdout.write(lines.join('\n') + '\n')
  if (fail) process.stdout.write('\nFix the ✗ lines before starting a run.\n')
  return fail ? 1 : 0
}
