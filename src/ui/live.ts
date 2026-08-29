/**
 * What each worker is doing this second. Deliberately in memory and
 * deliberately lossy: it exists so the first ten seconds of looking at the
 * dashboard answer "is it alive and doing something useful", and nothing
 * downstream reads it.
 */
export type WorkerState = {
  name: string
  kind: 'explorer' | 'hammerer' | 'confirmer'
  state: 'thinking' | 'acting' | 'stuck' | 'idle'
  account: string | null
  where: string
  did: string
  goal: string
  at: number
}

export type FeedRow = { at: number; method: string; path: string; status: number; ms: number; worker: string }

export type HammerRow = { endpoint: string; shape: string; workers: number; at: number }

class Live {
  workers = new Map<string, WorkerState>()
  feed: FeedRow[] = []
  hammers: HammerRow[] = []

  worker(name: string, kind: WorkerState['kind'], patch: Partial<WorkerState>): void {
    const prev = this.workers.get(name) ?? {
      name, kind, state: 'idle' as const, account: null, where: '', did: '', goal: '', at: Date.now(),
    }
    this.workers.set(name, { ...prev, ...patch, kind, at: Date.now() })
  }

  drop(name: string): void {
    this.workers.delete(name)
  }

  request(r: FeedRow): void {
    this.feed.push(r)
    if (this.feed.length > 300) this.feed.splice(0, this.feed.length - 300)
  }

  hammer(h: HammerRow): void {
    this.hammers.unshift(h)
    if (this.hammers.length > 12) this.hammers.length = 12
  }

  snapshot(): { workers: WorkerState[]; feed: FeedRow[]; hammers: HammerRow[] } {
    return {
      workers: [...this.workers.values()].sort((a, b) => a.name.localeCompare(b.name)),
      feed: this.feed.slice(-60).reverse(),
      hammers: this.hammers,
    }
  }
}

export const live = new Live()
