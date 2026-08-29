import type { Ctx } from '../ctx.js'
import type { Observed } from '../browser/record.js'
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

export function faults(ctx: Ctx, o: Observed): Signal[] {
  const out: Signal[] = []
  // A stack trace inside a JSON body has \n as two characters, not a newline,
  // so every one of these patterns silently missed the most common case there
  // is: an error handler that serialises err.stack.
  const body = unescapeJson(o.resBody ?? '')
  const where = `${o.method} ${o.pattern}`

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

  const stack = STACK.find((re) => re.test(body))
  if (stack || SQL.test(body)) {
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

  if (o.status >= 200 && o.status < 300 && ERROR_IN_200.test(body)) {
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
