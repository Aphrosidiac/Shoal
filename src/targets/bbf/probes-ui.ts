/**
 * The browser probe: what a person actually sees.
 *
 * Everything else in Shoal talks to the API, and an API can be entirely
 * correct while the screen built on it is blank. That is the fifth blind spot
 * an audit has and the one that produces the worst bug reports, because there
 * is nothing to find: a 200, a rendered page, no error anywhere, and no data.
 *
 * Two things are checked and nothing else, on purpose. A UI probe that asserts
 * on layout becomes a screenshot test that fails on every design change and is
 * switched off within a month.
 *
 *   1. Nothing threw. No console error, no unhandled rejection, no 5xx behind
 *      the page.
 *   2. Where the database holds rows, the screen shows some. Not how many, not
 *      in what order — that the list is not empty when it should not be.
 */
import type { ProbeContext, ProbeSounding } from '../../core/types.js'

const PAGES = [
  { path: '/dashboard', expects: null },
  { path: '/customers', expects: null },
  { path: '/quotations', expects: /QUO\d{4}\/\d+/g },
  { path: '/invoices', expects: /INV\d{4}\/\d+/g },
  { path: '/logistics', expects: null },
  { path: '/logistics/calendar', expects: null },
  { path: '/products', expects: null },
  { path: '/whatsapp', expects: null },
]

/**
 * Rows the database holds for the page, so an empty screen can be judged.
 *
 * Only the two lists that show everything they hold. The logistics screen
 * filters by date by default and is legitimately empty on a quiet week, so
 * "blank" there means nothing — it is still visited, but only for errors. The
 * first version of this probe also looked for delivery numbers as `DEL2608/…`
 * when BBF issues `DO2608/…`, and duly reported a screen full of jobs as
 * blank. A rule the target never agreed to is a false finding, and false
 * findings are how an instrument stops being read.
 */
const COUNTS: Record<string, string> = {
  '/quotations': `SELECT COUNT(*)::int AS n FROM sales_docs WHERE type = 'QUOTATION'`,
  '/invoices': `SELECT COUNT(*)::int AS n FROM sales_docs WHERE type = 'INVOICE'`,
}

export interface UiOpts {
  url: string
  email: string
  password: string
  /** Set by the CLI; without it the probe reports itself skipped rather than passing. */
  enabled: boolean
}

export function uiProbe(opts: UiOpts): ProbeSounding {
  return {
    kind: 'probe',
    id: 'the-screen-shows-what-the-books-hold',
    title: 'every page loads without error and is not blank when it should not be',
    because:
      'A list that renders empty over a table full of rows is not an error anywhere — the request ' +
      'succeeded, the page rendered, the console is clean. It is found by a person who assumes ' +
      'there is no work to do, which is the most expensive way to find anything.',
    async take(ctx: ProbeContext) {
      if (!opts.enabled) return []
      const { chromium } = await import('playwright-core')

      const browser = await chromium.launch({
        // The Chrome that is installed, rather than downloading a second one.
        channel: 'chrome',
        headless: true,
      })
      const bad: any[] = []
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
        const problems: string[] = []
        page.on('console', (m) => {
          if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 160)}`)
        })
        page.on('pageerror', (e) => problems.push(`threw: ${String(e.message).slice(0, 160)}`))
        page.on('response', (r) => {
          if (r.status() >= 500) problems.push(`${r.status()} from ${new URL(r.url()).pathname}`)
        })

        await page.goto(`${opts.url}/login`, { waitUntil: 'networkidle' })
        await page.fill('input[type="email"]', opts.email)
        await page.fill('input[type="password"]', opts.password)
        await page.click('button[type="submit"]')
        await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 })

        for (const spec of PAGES) {
          problems.length = 0
          await page.goto(`${opts.url}${spec.path}`, { waitUntil: 'networkidle' })
          // Lists arrive after the first paint; networkidle covers the fetch,
          // this covers the render that follows it.
          await page.waitForTimeout(400)

          // `document` lives in the browser, not in this process — the cast
          // keeps the DOM lib out of Shoal's own tsconfig, where it would let
          // browser globals compile in node code by accident.
          const text: string = await page.evaluate('document.body.innerText' as never)
          if (problems.length) bad.push({ page: spec.path, problems: [...new Set(problems)].slice(0, 3) })

          const sql = COUNTS[spec.path]
          if (spec.expects && sql) {
            const rows = (await ctx.sql(sql)) as { n: number }[]
            const held = rows[0]?.n ?? 0
            const shown = new Set(text.match(spec.expects) ?? []).size
            if (held > 0 && shown === 0) {
              bad.push({ page: spec.path, problem: 'blank over a table that is not', databaseRows: held, onScreen: 0 })
            }
          }
        }
        await page.close()
      } catch (e: any) {
        bad.push({ problem: 'the browser probe could not run', detail: String(e?.message ?? e).slice(0, 300) })
      } finally {
        await browser.close().catch(() => {})
      }
      return bad
    },
  }
}
