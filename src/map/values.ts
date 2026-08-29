/**
 * A model is not needed to think of 0, -1 and 999999. Field types are known
 * from the map, so values are generated in code — which is most of why the
 * fast path exists at all.
 */
export const CLASSES = ['normal', 'empty', 'zero', 'negative', 'huge', 'fraction', 'unicode', 'long'] as const
export type ValueClass = (typeof CLASSES)[number]

const LOREM = 'The quick brown fox jumps over the lazy dog. '

export function classesFor(type: string): ValueClass[] {
  const t = (type || 'text').toLowerCase()
  if (t === 'number' || t === 'range') return ['normal', 'zero', 'negative', 'huge', 'fraction', 'empty']
  if (t === 'email') return ['normal', 'empty', 'long', 'unicode']
  if (t === 'password') return ['normal', 'empty', 'long']
  if (t === 'date' || t === 'datetime-local' || t === 'month') return ['normal', 'empty', 'huge', 'unicode']
  if (t === 'checkbox' || t === 'radio') return ['normal', 'empty']
  if (t === 'select') return ['normal', 'empty']
  return ['normal', 'empty', 'unicode', 'long', 'huge']
}

export function valueFor(type: string, cls: ValueClass, name = ''): string {
  const t = (type || 'text').toLowerCase()
  const numberish = t === 'number' || t === 'range' || /qty|quantity|amount|price|total|count|age/i.test(name)

  switch (cls) {
    case 'empty':
      return ''
    case 'zero':
      return numberish ? '0' : ''
    case 'negative':
      return numberish ? '-1' : ''
    case 'fraction':
      return numberish ? '1.5' : ''
    case 'huge':
      if (numberish) return '999999999'
      if (t === 'date') return '9999-99-99'
      return 'x'.repeat(300)
    case 'unicode':
      return '🐟 Ünïcødé — “quoted” <tag> & ampersand'
    case 'long':
      return LOREM.repeat(30).slice(0, 1200)
    case 'normal':
    default:
      return normal(t, name)
  }
}

function normal(t: string, name: string): string {
  if (t === 'email') return `crew.${Math.random().toString(36).slice(2, 8)}@shoal.test`
  if (t === 'password') return 'Shoal-Passw0rd!7'
  if (t === 'number' || t === 'range') return /price|amount|total|cost/i.test(name) ? '100' : '2'
  if (t === 'date') return new Date().toISOString().slice(0, 10)
  if (t === 'datetime-local') return new Date().toISOString().slice(0, 16)
  if (t === 'month') return new Date().toISOString().slice(0, 7)
  if (t === 'tel') return '0123456789'
  if (t === 'url') return 'https://example.test/thing'
  if (/name/i.test(name)) return 'Grace Hopper'
  if (/address/i.test(name)) return '12 Jalan Contoh, Kuala Lumpur'
  if (/note|desc|comment|message/i.test(name)) return 'Written by a shoal agent.'
  if (/ref|code|sku/i.test(name)) return 'REF-' + Math.random().toString(36).slice(2, 7).toUpperCase()
  return 'shoal'
}
