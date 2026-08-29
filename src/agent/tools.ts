import type { ToolDef } from '../model/index.js'

/**
 * Nine tools. Not ten, not thirty. A big tool surface makes a cheap model
 * wander, and every one of these has to be understood by a 7B model reading a
 * short prompt.
 *
 * `look` is not among them: the loop looks every turn and hands the snapshot
 * over, so asking for it would only ever waste a call. See decisions.md #60.
 *
 * There is no `evaluate`. No arbitrary JavaScript, ever. If an agent could
 * reach into the page and change state directly then the recording would stop
 * matching what a user could actually do, and every finding would be
 * arguable.
 */
export const TOOLS: ToolDef[] = [
  {
    name: 'click',
    description: 'Click one element. Use the [ref] shown next to it.',
    schema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'], additionalProperties: false },
  },
  {
    name: 'type',
    description: 'Put text into one text box, replacing whatever is in it.',
    schema: {
      type: 'object',
      properties: { ref: { type: 'string' }, text: { type: 'string' } },
      required: ['ref', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'select',
    description: 'Choose one option in a dropdown.',
    schema: {
      type: 'object',
      properties: { ref: { type: 'string' }, value: { type: 'string' } },
      required: ['ref', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'press',
    description: 'Press one key: Enter, Escape or Tab.',
    schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'], additionalProperties: false },
  },
  {
    name: 'goto',
    description: 'Open a path on this same site, like /settings.',
    schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'back',
    description: 'Go back to the previous page.',
    schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'note',
    description: 'Write down one thing you learned about this app, in a sentence.',
    schema: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'], additionalProperties: false },
  },
  {
    name: 'surprise',
    description:
      'Say that the screen disagrees with what you just did. Only for something concrete you can point at. This is not a bug report; something else checks it.',
    schema: {
      type: 'object',
      properties: { expected: { type: 'string' }, observed: { type: 'string' } },
      required: ['expected', 'observed'],
      additionalProperties: false,
    },
  },
  {
    name: 'done',
    description: 'Stop. Say in one sentence what happened.',
    schema: { type: 'object', properties: { result: { type: 'string' } }, required: ['result'], additionalProperties: false },
  },
]

export const TOOL_NAMES = new Set(TOOLS.map((t) => t.name))
