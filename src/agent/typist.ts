import type { ValueClass } from '../map/values.js'
import { valueFor } from '../map/values.js'

/**
 * Jev cannot write and should not: a value a model invents is a value that
 * differs on every rewalk. Jev says what kind of field it is; a persona says
 * which class of value to try; code owns the string. Reproducible by
 * construction.
 */
export function valueForKind(kind: string, cls: ValueClass, label: string): string {
  const type = htmlType(kind)
  if (cls !== 'normal') return valueFor(type, cls, label)
  switch (kind) {
    case 'email': return `crew.${rand()}@shoal.test`
    case 'password': return 'Shoal-Passw0rd!7'
    case 'person_name': return pick(['Grace Hopper', 'Ada Lovelace', 'Aminah Rashid', 'Wei Lin Tan'])
    case 'company_name': return pick(['Acme Trading Sdn Bhd', 'Bolt & Sons', 'Northwind Supplies', 'Sunlight Racking'])
    case 'money': return pick(['100', '250', '1300', '49.90'])
    case 'quantity': return pick(['2', '3', '5'])
    case 'date': return new Date().toISOString().slice(0, 10)
    case 'phone': return '0123456789'
    case 'address': return '12 Jalan Contoh, 50450 Kuala Lumpur'
    case 'reference': return 'REF-' + rand().toUpperCase()
    case 'search': return 'a'
    case 'url': return 'https://example.test/thing'
    case 'free_text': return 'Written by a shoal agent during a mission.'
    default: return valueFor(type, 'normal', label)
  }
}

export function htmlType(kind: string): string {
  switch (kind) {
    case 'email': return 'email'
    case 'password': return 'password'
    case 'money':
    case 'quantity': return 'number'
    case 'date': return 'date'
    case 'phone': return 'tel'
    case 'url': return 'url'
    default: return 'text'
  }
}

const rand = (): string => Math.random().toString(36).slice(2, 8)
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!
