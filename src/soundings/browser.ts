/**
 * The browser sounding: what a person actually sees.
 *
 * Everything else here talks to the API, and an API can be entirely correct
 * while the screen built on it is blank. That is the failure that produces the
 * worst bug reports, because there is nothing to find — a 200, a rendered page,
 * a clean console, and no data.
 *
 * Two things are checked and nothing else, on purpose. Nothing threw, and where
 * the database holds rows the screen shows some. Not how many, not in what
 * order, nothing about layout: a browser check that asserts on appearance
 * becomes a screenshot test that fails on every design change and is switched
 * off within a month.
 */
import type { ProbeContext, ProbeSounding } from '../core/types.js'

export interface PageCheck {
  path: string
  /**
   * Pattern matching the identifiers this page should show — invoice numbers,
   * order references. Paired with `countSql`, it decides whether a blank screen
   * is a bug or an empty table.
   */
  expects?: RegExp
  /** Counts what the page ought to be showing. Needs `expects` to mean anything. */
  countSql?: string
}

export interface BrowserOptions {
  url: string
  /** Filled into the login form. */
  email: string
  password: string
  pages: PageCheck[]
  selectors?: { email?: string; password?: string; submit?: string; loginPath?: string }
  id?: string
}

export function screenAgreesWithTheDatabase(opts: BrowserOptions): ProbeSounding {
  const sel = {
    email: 'input[type="email"]',
    password: 'input[type="password"]',
    submit: 'button[type="submit"]',
    loginPath: '/login',
    ...opts.selectors,
  }
  return {
    kind: 'probe',
    id: opts.id ?? 'the-screen-agrees-with-the-database',
    title: 'every page loads without error and is not blank when it should not be',
    because:
      'A list that renders empty over a table full of rows is not an error anywhere — the request ' +
      'succeeded, the page rendered, the console is clean. It is found by a person who assumes ' +
      'there is no work to do, which is the most expensive way to find anything.',
    async take(ctx: ProbeContext) {
      const { chromium } = await import('playwright-core')
      // The Chrome that is installed, rather than downloading a second one.
      const browser = await chromium.launch({ channel: 'chrome', headless: true })
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

        await page.goto(`${opts.url}${sel.loginPath}`, { waitUntil: 'networkidle' })
        await page.fill(sel.email, opts.email)
        await page.fill(sel.password, opts.password)
        await page.click(sel.submit)
        await page.waitForURL((u) => !u.pathname.startsWith(sel.loginPath), { timeout: 15_000 })

        for (const spec of opts.pages) {
          problems.length = 0
          await page.goto(`${opts.url}${spec.path}`, { waitUntil: 'networkidle' })
          // Lists arrive after the first paint; networkidle covers the fetch,
          // this covers the render that follows it.
          await page.waitForTimeout(400)

          // `document` lives in the browser, not in this process — the cast
          // keeps the DOM lib out of the tsconfig, where it would let browser
          // globals compile into node code by accident.
          const text: string = await page.evaluate('document.body.innerText' as never)
          if (problems.length) bad.push({ page: spec.path, problems: [...new Set(problems)].slice(0, 3) })

          if (spec.expects && spec.countSql) {
            const rows = (await ctx.sql(spec.countSql)) as { n: number }[]
            const held = rows[0]?.n ?? 0
            const shown = new Set(text.match(spec.expects) ?? []).size
            if (held > 0 && shown === 0) {
              bad.push({ page: spec.path, problem: 'blank over a table that is not', databaseRows: held, onScreen: 0 })
            }
          }
        }
        await page.close()
      } catch (e: any) {
        // A probe that could not run is not a pass.
        bad.push({ problem: 'the browser sounding could not run', detail: String(e?.message ?? e).slice(0, 300) })
      } finally {
        await browser.close().catch(() => {})
      }
      return bad
    },
  }
}
