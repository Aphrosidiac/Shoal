import { spawn } from 'node:child_process'
import type { CallReq, CallRes, Model } from './index.js'
import { ModelDown } from './index.js'
import type { TierConfig } from '../config.js'
import { coerceToolCall } from './repair.js'

/**
 * The planner on a Claude subscription instead of API billing.
 *
 * Two traps, both of which cost real money silently:
 *
 *  - `--bare` refuses to read subscription OAuth credentials. In bare mode
 *    only ANTHROPIC_API_KEY works, which is the precise opposite of the point.
 *    So: never `--bare`, anywhere on this path.
 *  - ANTHROPIC_API_KEY outranks the OAuth token in credential precedence, so
 *    if it is set anywhere in the environment this quietly bills at API rates.
 *    We refuse to start rather than find out on the invoice.
 */
export function assertNoApiKey(): void {
  if (process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is set and the planner is in claude-code mode.\n' +
        'That variable outranks your subscription OAuth token, so every planner call would be\n' +
        'billed at API rates without saying so. Unset it, or set planner.provider to "anthropic".'
    )
  }
}

export class ClaudeCodeModel implements Model {
  readonly provider = 'claude-code'
  readonly id: string
  private sdk: { query?: unknown } | null = null
  private triedSdk = false

  constructor(tier: TierConfig) {
    assertNoApiKey()
    this.id = tier.model || 'claude-opus-5'
  }

  async call(req: CallReq): Promise<CallRes> {
    assertNoApiKey()
    const prompt = renderPrompt(req)
    const schema = req.tools.length ? toolChoiceSchema(req) : null

    const text = await this.viaSdk(prompt, schema).catch(async (e) => {
      if (e instanceof ModelDown) throw e
      return this.viaCli(prompt, schema)
    })

    const tool = req.tools.length ? coerceToolCall(text, req.tools) : null
    return {
      ...(tool ? { tool } : {}),
      ...(text ? { text } : {}),
      // A subscription meters calls, not tokens. See decisions.md #35.
      usage: { in: 0, cachedIn: 0, out: 0 },
    }
  }

  private async viaSdk(prompt: string, schema: unknown): Promise<string> {
    if (!this.triedSdk) {
      this.triedSdk = true
      try {
        this.sdk = (await import('@anthropic-ai/claude-agent-sdk' as string)) as { query?: unknown }
      } catch {
        this.sdk = null
      }
    }
    if (!this.sdk?.query) throw new Error('agent sdk not installed')
    const query = this.sdk.query as (p: string, o: unknown) => AsyncIterable<Record<string, unknown>>
    let out = ''
    for await (const m of query(schema ? prompt + '\n\n' + JSON.stringify(schema) : prompt, {
      model: this.id,
      maxTurns: 1,
      disallowedTools: ['Bash', 'Edit', 'Write', 'Read', 'WebFetch', 'WebSearch'],
    })) {
      const content = (m as { message?: { content?: Array<{ type: string; text?: string }> } }).message?.content
      if (Array.isArray(content)) for (const c of content) if (c.type === 'text' && c.text) out += c.text
    }
    if (!out.trim()) throw new Error('agent sdk returned nothing')
    return out
  }

  private viaCli(prompt: string, schema: unknown): Promise<string> {
    // NOTE: no --bare. See the comment at the top of this file.
    const args = ['-p', prompt, '--output-format', 'json', '--model', this.id]
    if (schema) args.push('--json-schema', JSON.stringify(schema))
    return new Promise((resolve, reject) => {
      const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      const timer = setTimeout(() => child.kill('SIGKILL'), 180_000)
      child.stdout.on('data', (d) => (out += String(d)))
      child.stderr.on('data', (d) => (err += String(d)))
      child.on('error', (e) => {
        clearTimeout(timer)
        reject(new Error(`could not run \`claude\`: ${e.message}. Install Claude Code, or set planner.provider to "anthropic".`))
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        const blob = out + err
        if (/usage limit|rate.?limit/i.test(blob)) return reject(new ModelDown('claude code hit a usage limit', 15 * 60_000))
        if (code !== 0) return reject(new Error(`claude exited ${code}: ${blob.slice(0, 400)}`))
        try {
          const j = JSON.parse(out) as { result?: string; text?: string }
          resolve(j.result ?? j.text ?? out)
        } catch {
          resolve(out)
        }
      })
    })
  }
}

function renderPrompt(req: CallReq): string {
  const body = req.messages.map((m) => `${m.role === 'user' ? 'INPUT' : 'PREVIOUS'}:\n${m.content}`).join('\n\n')
  const tools = req.tools.length
    ? '\n\nChoose exactly one of these and answer with one JSON object, no prose:\n' +
      req.tools.map((t) => `- ${t.name}: ${t.description}\n  input: ${JSON.stringify(t.schema.properties)}`).join('\n') +
      '\n\n{"tool":"<name>","input":{...}}'
    : ''
  return `${req.system}\n\n${body}${tools}`
}

function toolChoiceSchema(req: CallReq): unknown {
  return {
    type: 'object',
    properties: {
      tool: { type: 'string', enum: req.tools.map((t) => t.name) },
      input: { type: 'object' },
    },
    required: ['tool', 'input'],
    additionalProperties: false,
  }
}
