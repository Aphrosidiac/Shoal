import { request } from 'undici'
import type { CallReq, CallRes, Model } from './index.js'
import { ModelDown } from './index.js'
import type { TierConfig } from '../config.js'
import { coerceToolCall } from './repair.js'

/**
 * One adapter, many backends: OpenRouter, Ollama, LM Studio, vLLM, Groq,
 * Together. This is what makes a local driver possible, and a local driver is
 * what makes a 24-hour run cost a couple of dollars instead of fifty.
 *
 * Weak models are bad at native tool calling, so this falls back to
 * constrained JSON plus the repair loop in repair.ts.
 */
export class OpenAICompatModel implements Model {
  readonly provider = 'openai-compatible'
  readonly id: string
  private baseUrl: string
  private key: string
  private maxTokens: number
  private extra: Record<string, unknown>
  /** Flips to false the first time the backend rejects or fumbles `tools`. */
  private nativeTools = true

  constructor(tier: TierConfig) {
    if (!tier.baseUrl) {
      throw new Error('openai-compatible needs a baseUrl, e.g. http://localhost:11434/v1 for Ollama')
    }
    this.baseUrl = tier.baseUrl.replace(/\/+$/, '')
    this.key = tier.apiKey ?? process.env.SHOAL_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? 'not-needed'
    this.id = tier.model
    this.maxTokens = tier.maxTokens
    this.extra = tier.extra ?? {}
  }

  private async post(body: unknown): Promise<Record<string, unknown>> {
    const res = await request(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}` },
      body: JSON.stringify(body),
      // A local model on a laptop that is also running a browser can take
      // minutes for its first token. Timing it out is how a run looks broken
      // when it is only slow.
      headersTimeout: 300_000,
      bodyTimeout: 300_000,
    })
    const text = await res.body.text()
    if (res.statusCode === 429) throw new ModelDown(`rate limited: ${text.slice(0, 200)}`, 30_000)
    if (res.statusCode >= 500) throw new ModelDown(`backend is unwell (${res.statusCode}): ${text.slice(0, 200)}`, 15_000)
    if (res.statusCode >= 400) throw new Error(`${this.baseUrl} said ${res.statusCode}: ${text.slice(0, 400)}`)
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new Error(`${this.baseUrl} returned something that is not JSON: ${text.slice(0, 200)}`)
    }
  }

  async call(req: CallReq): Promise<CallRes> {
    const messages = [
      { role: 'system', content: req.system },
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ]

    if (this.nativeTools && req.tools.length) {
      try {
        const out = await this.post({
          ...this.extra,
          model: this.id,
          temperature: 0,
          max_tokens: req.maxTokens || this.maxTokens,
          messages,
          tools: req.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.schema },
          })),
          tool_choice: 'required',
        })
        const parsed = readChoice(out)
        if (parsed.tool || parsed.text) return parsed
        this.nativeTools = false
      } catch (e) {
        if (e instanceof ModelDown) throw e
        this.nativeTools = false
      }
    }

    // Constrained JSON path. Same schema, validated by hand.
    const instruction =
      'Answer with one JSON object and nothing else — no prose, no markdown fence:\n' +
      '{"tool":"<one of ' + req.tools.map((t) => t.name).join(', ') + '>","input":{...}}\n\n' +
      req.tools.map((t) => `${t.name}: ${t.description}\n  input: ${JSON.stringify(t.schema.properties)}`).join('\n')

    const out = await this.post({
      ...this.extra,
      model: this.id,
      temperature: 0,
      max_tokens: req.maxTokens || this.maxTokens,
      messages: [...messages, { role: 'system', content: instruction }],
      ...(req.tools.length ? { response_format: { type: 'json_object' } } : {}),
    })
    const parsed = readChoice(out)
    const tool = coerceToolCall(parsed.text ?? '', req.tools)
    return { ...(tool ? { tool } : {}), ...(parsed.text ? { text: parsed.text } : {}), usage: parsed.usage }
  }
}

function readChoice(out: Record<string, unknown>): CallRes {
  const choices = (out.choices ?? []) as Array<Record<string, unknown>>
  const msg = (choices[0]?.message ?? {}) as Record<string, unknown>
  const usageRaw = (out.usage ?? {}) as Record<string, number>
  const usage = {
    in: usageRaw.prompt_tokens ?? 0,
    cachedIn: (usageRaw as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details?.cached_tokens ?? 0,
    out: usageRaw.completion_tokens ?? 0,
  }
  const calls = (msg.tool_calls ?? []) as Array<{ function?: { name?: string; arguments?: string } }>
  if (calls.length && calls[0]?.function?.name) {
    let input: Record<string, unknown> = {}
    try {
      input = JSON.parse(calls[0]!.function!.arguments ?? '{}') as Record<string, unknown>
    } catch {
      input = {}
    }
    return { tool: { name: calls[0]!.function!.name!, input }, usage }
  }
  const text = typeof msg.content === 'string' ? msg.content : ''
  return { ...(text ? { text } : {}), usage }
}
