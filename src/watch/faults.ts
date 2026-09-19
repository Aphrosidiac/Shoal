import type { Ctx } from '../ctx.js'
import type { Observed } from '../browser/record.js'
import { isJsonish } from './types.js'
import type { Signal } from './types.js'

/**
 * The checks that are free, from the traffic alone, and need zero knowledge of
 * what the app does. Nothing in this file may call a model — if a check needs
 * judgment it is not a check.
 */

const STACK = [
  /\n\s+at [\w$.<>[\]\s]+ \(?[/\\][^\s)]+:\d+:\d+\)?/, // node / v8
  /\n\s+File "[^"]+", line \d+/, // python
  /\n\s+at [\w.$]+\([\w.]+\.java:\d+\)/, // jvm
  /goroutine \d+ \[/, // go
  /\bTraceback \(most recent call last\)/,
]

const SQL = /\b(?:SQLITE_|SQLSTATE|ORA-\d{5}|PG::|near "\w+": syntax error|You have an error in your SQL syntax)\b/

const ERROR_IN_200 = /"(?:error|errors|exception|error_message|errorMessage)"\s*:\s*(?!null|false|""|\[\]|\{\})/

const BREAKAGE = /internal|exception|unexpected|unhandled|something went wrong|failed to|timed? ?out|ECONN|ENOTFOUND|EAI_AGAIN|undefined|null|NaN|cannot read|is not a function|stack|500|503|database|prisma|sql|syntax/i
const VALIDATION = /please|must|need|should|required|invalid|already|taken|too (many|short|long|large|small)|at least|at most|try again|not (found|allowed|permitted|available)|incorrect|wrong|expired|does not|doesn't|can(?:no|')t be|enter a|choose|select|missing/i

export function errorText(body: string): string {
  const m = /"(?:error|errors|exception|error_message|errorMessage)"\s*:\s*("(?:[^"\\]|\\.)*"|\[[^\]]*\]|\{[^}]*\})/.exec(body)
  return m ? m[1]!.slice(0, 300) : ''
}

export function looksLikeBreakage(text: string): boolean {
  if (!text || /^"\$/.test(text)) return false
  if (VALIDATION.test(text) && !/internal|exception|unhandled|stack|ECONN|prisma|sql/i.test(text)) return false
  return BREAKAGE.test(text)
}

export function faults(ctx: Ctx, o: Observed): Signal[] {
  const out: Signal[] = []
  // A stack trace inside a JSON body has \n as two characters, not a newline,
  // so every one of these patterns silently missed the most common case there
  // is: an error handler that serialises err.stack.
  const body = unescapeJson(o.resBody ?? '')
  const where = `${o.method} ${o.pattern}`
  // An HTML document that answered 200 is a page, and a page's scripts
  // contain every word a stack trace does. The stack and error-in-a-200
  // checks read JSON and text; a page is only read when it is a 5xx.
  const html = /text\/html/i.test(String(o.resHeaders['content-type'] ?? '')) || /^\s*<!doctype html|^\s*<html/i.test(body)

  if (o.status >= 500) {
    out.push({
      check: 'fault.5xx',
      kind: 'fault',
      title: `${where} answers ${o.status}`,
      detail:
        `A bad request is a 4xx; a 5xx is the server admitting its own fault. ` +
        `This one returned ${o.status} to a request the app's own front end made.`,
      expected: `${where} to answer 2xx, or 4xx if the request was wrong`,
      observed: `${o.status}${body ? ': ' + firstLine(body) : ''}`,
      endpointId: o.endpointId,
      recordingId: o.id,
      data: { status: o.status },
    })
  }

  const stack = html && o.status < 500 ? undefined : STACK.find((re) => re.test(body))
  if (stack || (!html && SQL.test(body))) {
    out.push({
      check: 'fault.stack',
      kind: 'fault',
      title: `${where} returns internal detail in the response body`,
      detail:
        `The response carries a ${SQL.test(body) ? 'database error string' : 'stack trace'}. ` +
        `That is leaked internals, and it usually means an unhandled path rather than a handled failure.`,
      expected: 'an error body with no file paths, line numbers or SQL in it',
      observed: firstLine(body.slice(0, 400)),
      endpointId: o.endpointId,
      recordingId: o.id,
      data: { status: o.status },
    })
  }

  // A 200 whose body says `error` is the app's own validation channel as
  // often as it is a hidden failure — a Server Action answers "Please enter
  // your name." with a 200 and nothing is broken. Only what reads like the
  // system giving up is a fault; a polite sentence to the user is not.
  // JSON only. A React Flight payload (text/x-component) serialises an absent
  // error as "$undefined", which is the opposite of one.
  if (!html && isJsonish(o.resHeaders) && o.status >= 200 && o.status < 300 && ERROR_IN_200.test(body) && looksLikeBreakage(errorText(body))) {
    out.push({
      check: 'fault.error-in-200',
      kind: 'fault',
      title: `${where} answers ${o.status} with an error in the body`,
      detail: 'A success code on a failure hides real breakage from everything downstream, including the front end.',
      expected: `${where} to use a 4xx or 5xx when it fails`,
      observed: `${o.status} with ${firstLine(body.slice(0, 200))}`,
      endpointId: o.endpointId,
      recordingId: o.id,
      data: { status: o.status },
    })
  }

  if (o.ms >= ctx.cfg.slowMs && o.status < 500) {
    out.push({
      check: 'slow',
      kind: 'slow',
      title: `${where} took ${(o.ms / 1000).toFixed(1)}s`,
      detail: `Over the ${ctx.cfg.slowMs}ms threshold. Something on this path is unbounded or blocking, and it gets worse as the data grows.`,
      expected: `${where} to answer inside ${ctx.cfg.slowMs}ms`,
      observed: `${o.ms}ms`,
      endpointId: o.endpointId,
      recordingId: o.id,
      data: { ms: o.ms },
    })
  }

  return out
}

const firstLine = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 180)

export const unescapeJson = (s: string): string => s.replace(/\\r\\n|\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"')
