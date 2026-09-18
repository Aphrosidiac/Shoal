/**
 * The steps an account has taken since it was created, in a form that can be
 * walked again by matching what a user would see — a role and a name, never
 * a ref or a selector, because the fresh account a rewalk runs in has
 * different ids on every row.
 */
export type Step =
  | { op: 'goto'; url: string; path: string }
  | { op: 'click'; url: string; role: string; name: string; nth: number }
  | { op: 'type'; url: string; role: string; name: string; nth: number; text: string }
  | { op: 'select'; url: string; role: string; name: string; nth: number; value: string }
  | { op: 'press'; url: string; key: string }
  | { op: 'back'; url: string }

export const describe = (s: Step): string => {
  switch (s.op) {
    case 'goto': return `open ${s.path}`
    case 'click': return `click ${s.role} "${s.name}"`
    case 'type': return `type "${s.text.length > 40 ? s.text.slice(0, 37) + '…' : s.text}" into "${s.name}"`
    case 'select': return `choose "${s.value}" in "${s.name}"`
    case 'press': return `press ${s.key}`
    case 'back': return 'go back'
  }
}
