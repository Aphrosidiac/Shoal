import type { ValueClass } from '../map/values.js'

/**
 * Behaviour, not demographics. "Ahmad, 34, likes coffee" changes nothing about
 * which code runs. Every one of these changes which code runs: the value
 * classes the typist reaches for, and the hooks the loop fires around a
 * submit. Jev never sees the persona — it decides where to go; the persona
 * decides how badly to behave on the way.
 *
 * The last two matter more than they look: an app with three rows and an app
 * with three hundred are different programs, and only one of them is normally
 * tested.
 */
export type Persona = {
  name: string
  behaviour: string
  /** A brand new account, or one that has been used and has data in it. */
  world: 'fresh' | 'cluttered'
  /** Value classes tried, in turn, on numeric-looking and text fields. */
  classes?: ValueClass[]
  hooks?: {
    doubleSubmit?: boolean
    refreshAfterSubmit?: boolean
    backAndForward?: boolean
    skipOneRequired?: boolean
    dawdleMs?: number
  }
}

export const PERSONAS: Persona[] = [
  { name: 'the impatient one', behaviour: 'submits the form a second time when the first click feels slow', world: 'fresh', hooks: { doubleSubmit: true } },
  { name: 'the one who changes their mind', behaviour: 'goes back halfway through, then forward again, then finishes', world: 'fresh', hooks: { backAndForward: true } },
  { name: 'the extremist', behaviour: 'where a form takes a number, tries 0, then -1, then 999999', world: 'fresh', classes: ['zero', 'negative', 'huge'] },
  { name: 'the copy-paster', behaviour: 'pastes emoji and quotation marks into name fields', world: 'fresh', classes: ['unicode'] },
  { name: 'the incomplete one', behaviour: 'fills everything except one required field and submits anyway', world: 'fresh', hooks: { skipOneRequired: true } },
  { name: 'the one who wandered off', behaviour: 'leaves a form open for a while, then comes back and submits it', world: 'fresh', hooks: { dawdleMs: 4000 } },
  { name: 'the refresher', behaviour: 'reloads the page right after pressing the button that costs money', world: 'fresh', hooks: { refreshAfterSubmit: true } },
  { name: 'the beginner', behaviour: 'has just signed up and there is nothing here yet; makes the first one of everything', world: 'fresh' },
  { name: 'the regular', behaviour: 'has been using this for months and there are hundreds of rows', world: 'cluttered' },
  { name: 'the tidy one', behaviour: 'creates a thing, edits it, deletes it, and expects the count to end where it started', world: 'cluttered' },
]

export const pickPersona = (n: number): Persona => PERSONAS[n % PERSONAS.length]!
export const personaByName = (name: string): Persona => PERSONAS.find((p) => p.name === name) ?? PERSONAS[7]!
