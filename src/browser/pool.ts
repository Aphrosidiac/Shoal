import { chromium, type Browser, type BrowserContext } from 'playwright'

/**
 * One browser, N contexts, one per explorer. Contexts are the cheap part and
 * the isolated part: a context is a separate cookie jar, which is what makes
 * "this agent is a different account" true rather than hopeful.
 */
export class BrowserPool {
  private browser: Browser | null = null
  private open: BrowserContext[] = []

  constructor(private headless = true) {}

  async start(): Promise<void> {
    if (this.browser) return
    this.browser = await chromium.launch({
      headless: this.headless,
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    })
  }

  async context(): Promise<BrowserContext> {
    await this.start()
    const c = await this.browser!.newContext({
      viewport: { width: 1280, height: 900 },
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    })
    c.setDefaultTimeout(10_000)
    this.open.push(c)
    return c
  }

  async release(c: BrowserContext): Promise<void> {
    this.open = this.open.filter((x) => x !== c)
    try {
      await c.close()
    } catch {
      /* already gone */
    }
  }

  async stop(): Promise<void> {
    for (const c of this.open.splice(0)) {
      try { await c.close() } catch { /* already gone */ }
    }
    if (this.browser) {
      try { await this.browser.close() } catch { /* already gone */ }
      this.browser = null
    }
  }
}
