/**
 * Behaviour, not demographics. "Ahmad, 34, likes coffee" changes nothing about
 * which code runs. Every one of these changes which code runs.
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
}

export const PERSONAS: Persona[] = [
  { name: 'the impatient one', behaviour: 'You submit the form a second time when the first click feels slow.', world: 'fresh' },
  { name: 'the one who changes their mind', behaviour: 'You go back halfway through, then forward again, then finish.', world: 'fresh' },
  { name: 'the extremist', behaviour: 'Where a form takes a number you try 0, then -1, then 999999.', world: 'fresh' },
  { name: 'the copy-paster', behaviour: 'You paste emoji and quotation marks into name fields, because that is what was on your clipboard.', world: 'fresh' },
  { name: 'the incomplete one', behaviour: 'You fill everything except one required field and submit anyway.', world: 'fresh' },
  { name: 'the one who wandered off', behaviour: 'You leave a form open for a long time, then come back and submit it.', world: 'fresh' },
  { name: 'the refresher', behaviour: 'You reload the page right after pressing the button that costs money.', world: 'fresh' },
  { name: 'the beginner', behaviour: 'You have just signed up and there is nothing here yet. You are trying to make the first one of everything.', world: 'fresh' },
  { name: 'the regular', behaviour: 'You have been using this for months and there are hundreds of rows. You are looking for one of them.', world: 'cluttered' },
  { name: 'the tidy one', behaviour: 'You create a thing, then edit it, then delete it, and you expect the count to end where it started.', world: 'cluttered' },
]

export const pickPersona = (n: number): Persona => PERSONAS[n % PERSONAS.length]!
