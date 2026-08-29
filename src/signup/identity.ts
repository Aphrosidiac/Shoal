import { randomBytes } from 'node:crypto'

const FIRST = ['ada', 'grace', 'alan', 'edsger', 'barbara', 'ken', 'radia', 'leslie', 'niklaus', 'margaret', 'tony', 'donald']
const LAST = ['lovelace', 'hopper', 'turing', 'dijkstra', 'liskov', 'thompson', 'perlman', 'lamport', 'wirth', 'hamilton', 'hoare', 'knuth']

export type Identity = {
  email: string
  password: string
  first: string
  last: string
  name: string
  company: string
  phone: string
  handle: string
}

const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!

/**
 * Agents make their own accounts, so setup is a URL. The domain is
 * `shoal.test`, which is reserved and therefore cannot reach anybody by
 * accident even if the app under test somehow got real mail out.
 */
export function identity(): Identity {
  const first = pick(FIRST)
  const last = pick(LAST)
  const tag = randomBytes(3).toString('hex')
  const handle = `${first}.${last}.${tag}`
  return {
    email: `${handle}@shoal.test`,
    password: `Shoal-${randomBytes(6).toString('base64url')}!7`,
    first,
    last,
    name: `${first[0]!.toUpperCase()}${first.slice(1)} ${last[0]!.toUpperCase()}${last.slice(1)}`,
    company: `${last[0]!.toUpperCase()}${last.slice(1)} Supplies`,
    phone: '01' + Math.floor(10_000_000 + Math.random() * 89_999_999),
    handle,
  }
}
