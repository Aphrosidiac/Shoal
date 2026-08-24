/**
 * Writes the draft.
 *
 * What comes out boots, logs in, surveys and runs the structural soundings.
 * What does not come out is anything requiring judgment: weights, contention,
 * and every domain rule. Those are left as marked gaps rather than as plausible
 * defaults, because a plausible default in a checking tool is worse than a
 * hole — a hole is visible.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Scan } from './scan.js'
import { prefixFor } from './scan.js'
import type { Introspection } from './introspect.js'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
/** PascalCase — a type name, so the first letter has to be one too. */
const camel = (s: string) => {
  const joined = s.replace(/[-_/:{}](\w)/g, (_, c) => c.toUpperCase()).replace(/\W/g, '')
  return joined.charAt(0).toUpperCase() + joined.slice(1)
}

/** Top-level keys of any `z.object({...})` in the route's file, as a hint. */
function payloadHint(root: string, file: string): string[] {
  try {
    const src = readFileSync(join(root, file), 'utf8')
    const keys = new Set<string>()
    for (const m of src.matchAll(/z\.object\(\{([\s\S]{0,900}?)\}\)/g)) {
      for (const line of (m[1] ?? '').split('\n')) {
        const k = line.match(/^\s*([A-Za-z_][\w]*)\s*:/)?.[1]
        if (k) keys.add(k)
      }
    }
    return [...keys].slice(0, 14)
  } catch {
    return []
  }
}

function actionName(method: string, path: string) {
  const verb = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }[method] ?? 'call'
  const tail = path.split('?')[0]!.split('/').filter((s) => s && !s.startsWith(':')).pop() ?? 'thing'
  return `${verb}-${tail}`.toLowerCase()
}

export function emitTarget(opts: {
  name: string
  root: string
  outDir: string
  port: number
  sourceDb: string
  scan: Scan
  db: Introspection
}) {
  const { name, scan, db } = opts
  mkdirSync(opts.outDir, { recursive: true })

  const mutating = scan.routes
    .filter((r) => MUTATING.has(r.method))
    .map((r) => ({ ...r, full: (prefixFor(scan, r.file) + r.path).replace(/\/+$/, '') || r.path }))
    .filter((r) => !/login|logout|health|webhook|upload/i.test(r.full))
    .slice(0, 18)

  const roles = scan.roles.length ? scan.roles : ['USER']

  writeFileSync(join(opts.outDir, 'world.ts'), `import type { World } from '../../src/core/types.js'

/**
 * TODO: name the collections this target tracks between waves.
 *
 * One per kind of thing an action creates and a later action needs to aim at.
 * Nothing derives these — what is worth remembering is a judgment about how
 * the system is used.
 */
export interface ${camel(name)}World extends World {
  // e.g. customers: string[]
  // e.g. orders: { id: string; total: number; status: string }[]
}
`)

  writeFileSync(join(opts.outDir, 'actions.ts'), `/**
 * Drafted by \`shoal init\` from the route table. Every weight is 1 and nothing
 * is marked collidable, because neither is derivable.
 *
 * Two decisions matter more than the rest:
 *   · WEIGHT — what a real user does often, not what the API offers.
 *   · CONTENTION — \`collidable\` points every actor at the SAME row (five
 *     people paying one invoice). \`collideVariants\` is for different rows
 *     competing for one scarce thing (five orders for the last unit in stock).
 *     Identical arguments in the second case prove nothing.
 */
import type { Action } from '../../src/core/types.js'
import type { ${camel(name)}World as World } from './world.js'
import { httpAction } from '../../src/target/define.js'

const ROLES = [${roles.map((r) => `'${r}'`).join(', ')}]

export const actions: Action<any, World>[] = [
${mutating
  .map((r) => {
    const hint = payloadHint(opts.root, r.file)
    return `  httpAction<any, World>({
    name: '${actionName(r.method, r.full)}',
    roles: ROLES,
    weight: 1, // TODO
    // TODO: collidable / collideVariants — see the note above.
    ${hint.length ? `// payload keys found in ${r.file}:\n    //   ${hint.join(', ')}` : `// no schema found in ${r.file}`}
    pick: (_w, _rng) => null, // TODO: choose arguments, or null when it does not apply yet
    request: (_a) => ['${r.method}', '${r.full}'${MUTATING.has(r.method) && r.method !== 'DELETE' ? ', {}' : ''}],
  }),`
  })
  .join('\n')}
]
`)

  const candidates = db.candidates
  writeFileSync(join(opts.outDir, 'soundings.ts'), `/**
 * The soundings. This is the whole product; everything else is delivery.
 *
 * Below are CANDIDATES, proposed from the shape of the schema and commented
 * out. Each is a question, not a check. Read it, decide whether the business
 * actually works that way, and write the \`because\` from the business — never
 * from the code. A rule extracted from the implementation encodes the
 * implementation's bugs and then agrees with them for ever, which is the one
 * failure this tool exists to avoid.
 *
 * \`shoal init\` will never write a \`because\`. It has no way to know one.
 */
import type { Sounding } from '../../src/core/types.js'
import {
  cachedAggregateMatchesRows,
  listingMatchesCount,
  noOrphanedRows,
  pagingIsStable,
} from '../../src/soundings/index.js'

const domain: Sounding[] = [
  // ── Candidates, from the schema ────────────────────────────────────────
${
  candidates.length
    ? candidates
        .map((c) => `  // [${c.kind}${c.confidence === 'possible' ? ', probably noise' : ''}] ${c.detail}\n  // ${c.draft}`)
        .join('\n\n')
    : '  // Nothing proposed itself. That is not reassurance — it means the schema\n  // carries no obvious caches or totals, not that the business has no rules.'
}
]

/** Structural rules, which hold whatever the business is. */
const structural: Sounding[] = [
  noOrphanedRows(),
  // TODO: point these at a paged list endpoint.
  // pagingIsStable({ path: '/api/things?limit={limit}&page={page}', itemsKey: 'data' }),
  // listingMatchesCount({ path: '/api/things?limit=1', sql: 'SELECT COUNT(*)::int AS n FROM things' }),
]

export const soundings: Sounding[] = [...domain, ...structural]
`)

  const tokenGuess = scan.loginReturn && !/^\{\s*token/.test(scan.loginReturn.trim())
    ? `\n    // The login handler returns: ${scan.loginReturn}\n    // TODO: confirm where the token sits.\n    // token: (b) => b?.data?.token,`
    : ''

  writeFileSync(join(opts.outDir, 'index.ts'), `/**
 * ${name} — drafted by \`shoal init\`.
 *
 * Everything below was read out of the target. Everything marked TODO was not,
 * because it cannot be.
 */
import type { Persona, Session } from '../../src/core/types.js'
import type { ${camel(name)}World } from './world.js'
import { defineTarget } from '../../src/target/define.js'
import { required } from '../../src/core/config.js'
import { call } from '../../src/core/driver.js'
import { actions } from './actions.js'
import { soundings } from './soundings.js'

export default defineTarget<${camel(name)}World>((cfg) => {
  /**
   * TODO: one persona per kind of user, not per person.
   *
   * Role, competence, intent, environment and tenure change which code runs.
   * \`instances\` runs one login as several sessions; \`anonymous: true\` acts
   * without logging in, which is what a public checkout or booking form needs.
   */
  const personas: Persona[] = [
${roles.map((r) => `    { name: '${r.toLowerCase()}', email: required(cfg, '${r.toLowerCase()}Email'), role: '${r}', bias: {} },`).join('\n')}
  ]

  return {
    name: '${name}',
    root: cfg.root,
    password: required(cfg, 'password'),
    entry: '${scan.entry}',
    sourceDb: '${opts.sourceDb}',
    workDb: '${opts.sourceDb}_shoal',
    templateDb: '${opts.sourceDb}_shoal_tpl',
    port: ${opts.port},${scan.healthPath && scan.healthPath !== '/api/health' ? `\n    healthPath: '${scan.healthPath}',` : ''}${scan.loginPath ? `\n    auth: { path: '${scan.loginPath}' },${tokenGuess}` : ''}
    // Blanked so a voyage cannot reach a real customer, gateway or inbox.
    env: {
${scan.channelKeys.map((k) => `      ${k}: '',`).join('\n')}
    },
    surveyAs: '${roles[0]?.toLowerCase()}', // TODO: must be a role that sees everything
    requiresWorld: [], // TODO: collections without which a voyage proves nothing
    personas,
    actions,
    soundings,
    seasonBias: {}, // TODO: weight the build-up phase towards creating
    /**
     * TODO: read the starting world back off the API.
     *
     * Must run as an ungated role. A 403 here looks exactly like an empty
     * system, and a swarm that cannot see anything finds nothing while
     * reporting clear water.
     */
    async survey(_s: Session): Promise<${camel(name)}World> {
      return {}
    },
  }
})
`)

  return { files: ['index.ts', 'world.ts', 'actions.ts', 'soundings.ts'], actions: mutating.length }
}

export function configStub(name: string, root: string, roles: string[]) {
  const entry: Record<string, string> = { root, password: 'TODO' }
  for (const r of roles.length ? roles : ['user']) entry[`${r.toLowerCase()}Email`] = 'TODO'
  return { [name]: entry }
}

export const alreadyThere = (dir: string) => existsSync(join(dir, 'index.ts'))
