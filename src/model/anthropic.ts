import Anthropic from '@anthropic-ai/sdk'
import type { CallReq, CallRes, Model, ToolDef } from './index.js'
import { ModelDown } from './index.js'
import type { TierConfig } from '../config.js'

/**
 * Claude always goes through the official SDK, never through an
 * OpenAI-compatible shim: strict tools and prompt caching do not survive the
 * translation, and those are the two things that make this affordable.
 */
export class AnthropicModel implements Model {
  readonly provider = 'anthropic'
  readonly id: string
  private client: Anthropic
  private maxTokens: number

  constructor(tier: TierConfig) {
    const key = tier.apiKey ?? process.env.ANTHROPIC_API_KEY
    if (!key) {
      throw new Error(
        'The anthropic provider needs ANTHROPIC_API_KEY. Set it, or point this tier at a local model:\n' +
          '  "driver": { "provider": "openai-compatible", "baseUrl": "http://localhost:11434/v1", "model": "..." }'
      )
    }
    this.client = new Anthropic({ apiKey: key, ...(tier.baseUrl ? { baseURL: tier.baseUrl } : {}) })
    this.id = tier.model
    this.maxTokens = tier.maxTokens
  }

  async call(req: CallReq): Promise<CallRes> {
    // Order matters: the cache is a prefix match and any byte change
    // invalidates everything after it. tools -> system -> messages, volatile
    // content last.
    const tools = req.tools.map((t: ToolDef, i) => ({
      name: t.name,
      description: t.description,
      input_schema: { ...t.schema, additionalProperties: false } as never,
      strict: true,
      ...(i === req.tools.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
    }))

    try {
      const res = await this.client.messages.create({
        model: this.id,
        max_tokens: req.maxTokens || this.maxTokens,
        temperature: 0,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        tools: tools as never,
        ...(req.tools.length ? { tool_choice: { type: 'any' as const } } : {}),
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      })

      const use = res.content.find((c) => c.type === 'tool_use')
      const text = res.content
        .filter((c): c is Anthropic.TextBlock => c.type === 'text')
        .map((c) => c.text)
        .join('\n')
        .trim()

      return {
        ...(use ? { tool: { name: use.name, input: use.input as Record<string, unknown> } } : {}),
        ...(text ? { text } : {}),
        usage: {
          in: (res.usage.input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0),
          cachedIn: res.usage.cache_read_input_tokens ?? 0,
          out: res.usage.output_tokens ?? 0,
        },
      }
    } catch (e) {
      const err = e as { status?: number; message?: string; headers?: Record<string, string> }
      if (err.status === 429 || err.status === 529) {
        const retry = Number(err.headers?.['retry-after'] ?? 0) * 1000
        throw new ModelDown(`rate limited by anthropic: ${err.message ?? ''}`, retry || 30_000)
      }
      if (err.status && err.status >= 500) throw new ModelDown(`anthropic is unwell: ${err.message ?? ''}`, 15_000)
      throw e
    }
  }
}
