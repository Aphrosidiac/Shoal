/**
 * Two independent limits, as in scheduler.md: `pace` requests per second at
 * the app so a dev server survives, and a spend ceiling that makes the
 * scheduler stop issuing the kinds of work that cost money while continuing
 * to issue the ones that do not.
 */
export class Throttle {
  private tokens: number
  private last = Date.now()
  private waiters: Array<() => void> = []
  private timer: NodeJS.Timeout | null = null

  constructor(private perSecond: number) {
    this.tokens = perSecond
  }

  private refill(): void {
    const t = Date.now()
    const gained = ((t - this.last) / 1000) * this.perSecond
    if (gained > 0) {
      this.tokens = Math.min(this.perSecond, this.tokens + gained)
      this.last = t
    }
  }

  /** Waits until the app can take another request. */
  async take(): Promise<void> {
    this.refill()
    if (this.tokens >= 1) {
      this.tokens -= 1
      return
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve)
      if (!this.timer) {
        this.timer = setInterval(() => {
          this.refill()
          while (this.tokens >= 1 && this.waiters.length) {
            this.tokens -= 1
            this.waiters.shift()!()
          }
          if (!this.waiters.length && this.timer) {
            clearInterval(this.timer)
            this.timer = null
          }
        }, 25)
        this.timer.unref?.()
      }
    })
  }

  /** Back off when the app starts refusing us. */
  slowDown(factor = 0.5): void {
    this.perSecond = Math.max(1, this.perSecond * factor)
  }

  speedUpTo(perSecond: number): void {
    this.perSecond = Math.min(perSecond, this.perSecond * 1.5 + 1)
  }

  rate(): number {
    return this.perSecond
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const w of this.waiters.splice(0)) w()
  }
}
