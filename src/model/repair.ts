import type { ToolCall, ToolDef } from './index.js'

/**
 * Weak models produce almost-JSON, wrap it in a fence, or answer with the
 * arguments and no tool name. One schema, two enforcement paths: strict tools
 * on Claude, this by hand everywhere else.
 *
 * Capped at what can be recovered mechanically. Genuine failure is the
 * caller's problem, and the caller falls back to a code-driven choice.
 */
export function coerceToolCall(raw: string, tools: ToolDef[]): ToolCall | null {
  const obj = firstObject(raw)
  if (!obj) return null

  let name = pick(obj, ['tool', 'name', 'tool_name', 'function', 'action'])
  let input = obj.input ?? obj.arguments ?? obj.args ?? obj.parameters ?? obj.params

  if (typeof input === 'string') {
    const inner = firstObject(input)
    if (inner) input = inner
  }

  // {"click": {"ref": "e3"}} — the tool name used as the key
  if (!name) {
    for (const t of tools) {
      if (t.name in obj) {
        name = t.name
        input = (obj as Record<string, unknown>)[t.name]
        break
      }
    }
  }
  // arguments given bare: {"ref":"e3"} with only one tool that fits
  if (!name && input === undefined) {
    const keys = new Set(Object.keys(obj))
    const fits = tools.filter((t) => t.schema.required.every((r) => keys.has(r)))
    if (fits.length === 1) {
      name = fits[0]!.name
      input = obj
    }
  }

  if (typeof name !== 'string') return null
  const def = tools.find((t) => t.name === name.toLowerCase().trim())
  if (!def) return null
  const clean = validate(def, (input ?? {}) as Record<string, unknown>)
  return clean ? { name: def.name, input: clean } : null
}

function pick(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

/** Coerces types where it is unambiguous, and refuses where it is not. */
export function validate(def: ToolDef, input: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const out: Record<string, unknown> = {}
  for (const [key, rawSpec] of Object.entries(def.schema.properties)) {
    const spec = rawSpec as { type?: string; enum?: string[] }
    let v = input[key]
    if (v === undefined || v === null) continue
    // String({}) is "[object Object]", which is how a model's structured
    // answer turns into a note that says nothing.
    if (spec.type === 'string' && typeof v !== 'string') v = typeof v === 'object' ? JSON.stringify(v) : String(v)
    if (spec.type === 'number' || spec.type === 'integer') {
      const n = Number(v)
      if (!Number.isFinite(n)) continue
      v = spec.type === 'integer' ? Math.round(n) : n
    }
    if (spec.type === 'boolean' && typeof v !== 'boolean') v = v === 'true' || v === 1
    if (spec.enum && !spec.enum.includes(String(v))) continue
    out[key] = v
  }
  for (const r of def.schema.required) if (!(r in out)) return null
  return out
}

function firstObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  const text = raw.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim()
  const start = text.indexOf('{')
  if (start < 0) return null
  // walk to the matching brace, respecting strings
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]!
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        try {
          const v = JSON.parse(text.slice(start, i + 1)) as unknown
          return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
        } catch {
          return null
        }
      }
    }
  }
  return null
}
