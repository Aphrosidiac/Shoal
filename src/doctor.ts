import { existsSync, statfsSync } from 'node:fs'
import type { Config } from './config.js'
import { assertLocal } from './config.js'
import { probe } from './target/probe.js'
import { shoalDir } from './store/db.js'
import { MailCatcher } from './signup/mail.js'
import { makeModel } from './model/index.js'
import { Jev, noul, asNoul } from './jev/client.js'
import { jevConfig } from './jev/setup.js'

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

  // Jev: one real question, so a wrong key or a dead network fails here and
  // not on the first turn of a run.
  try {
    const jev = new Jev(jevConfig(cfg), null)
    const t0 = Date.now()
    const r = await jev.ask('doctor', { screen: 'Invoice INV-1  Total 1,300  Status PAID  [button Pay now]' }, {
      contradiction: noul('Does `screen` show a paid status next to a control that only makes sense when unpaid?'),
    })
    const p = asNoul(r.answers.contradiction)
    lines.push(
      p >= 0.7
        ? ok('jev', `typesafe / ${r.model}   answered in ${Date.now() - t0}ms (${r.usage.input_tokens} tokens, contradiction ${(p * 100).toFixed(0)}%)`)
        : bad('jev', `typesafe / ${r.model}   answered, but put a planted contradiction at ${(p * 100).toFixed(0)}% — the judge is not seeing straight`)
    )
    if (cfg.jev.maxUsd !== null) lines.push(ok('jev', `budget cap $${cfg.jev.maxUsd.toFixed(2)}`))
  } catch (e) {
    lines.push(bad('jev', (e as Error).message.split('\n')[0]!))
    fail = true
  }

  if (cfg.planner) {
    const t = cfg.planner
    if (t.provider === 'claude-code' && process.env.ANTHROPIC_API_KEY) {
      lines.push(
        bad(
          'planner',
          'claude-code with ANTHROPIC_API_KEY set. That variable outranks your subscription OAuth token, ' +
            'so every call would be billed at API rates. Unset it.'
        )
      )
      fail = true
    } else {
      try {
        const t0 = Date.now()
        const m = await makeModel(t, 'planner')
        const res = await m.call({ system: 'Answer briefly.', messages: [{ role: 'user', content: 'Say ok.' }], tools: [], maxTokens: 16 })
        lines.push(ok('planner', `${t.provider} / ${m.id}   ${res.text ? 'answered' : 'answered with nothing'}, in ${Date.now() - t0}ms`))
      } catch (e) {
        lines.push(bad('planner', `${t.provider} / ${t.model}   ${(e as Error).message.split('\n')[0]}`))
        fail = true
      }
    }
  } else {
    lines.push(ok('planner', 'none configured — missions are written from the map by code'))
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
