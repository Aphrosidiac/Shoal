import { SMTPServer } from 'smtp-server'
import { simpleParser } from 'mailparser'

export type Mail = { to: string[]; from: string; subject: string; text: string; html: string; links: string[]; at: number }

/**
 * The only setup step beyond the URL, and only for apps that verify email:
 * point your app's SMTP at localhost:1025 and agents read their own
 * verification links.
 */
export class MailCatcher {
  private server: SMTPServer | null = null
  private box: Mail[] = []
  private waiters: Array<{ match: (m: Mail) => boolean; resolve: (m: Mail) => void }> = []
  listening = false

  constructor(private port: number) {}

  async start(): Promise<boolean> {
    if (this.server) return this.listening
    this.server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onData: (stream, _session, callback) => {
        void (async () => {
          try {
            const parsed = await simpleParser(stream)
            const text = parsed.text ?? ''
            const html = typeof parsed.html === 'string' ? parsed.html : ''
            const mail: Mail = {
              to: addresses(parsed.to),
              from: addresses(parsed.from)[0] ?? '',
              subject: parsed.subject ?? '',
              text,
              html,
              links: links(text + '\n' + html),
              at: Date.now(),
            }
            this.deliver(mail)
          } catch {
            /* an unparseable mail is not worth taking the run down for */
          }
          callback()
        })()
      },
    })
    this.server.on('error', () => undefined)
    return new Promise<boolean>((resolve) => {
      this.server!.listen(this.port, '127.0.0.1', () => {
        this.listening = true
        resolve(true)
      })
      this.server!.on('error', () => resolve(false))
    })
  }

  private deliver(m: Mail): void {
    this.box.push(m)
    if (this.box.length > 500) this.box.splice(0, 200)
    this.waiters = this.waiters.filter((w) => {
      if (!w.match(m)) return true
      w.resolve(m)
      return false
    })
  }

  /** Waits for a message to an address, including one that already arrived. */
  waitFor(address: string, timeoutMs = 15_000): Promise<Mail | null> {
    const a = address.toLowerCase()
    const match = (m: Mail): boolean => m.to.some((t) => t.toLowerCase() === a)
    const already = [...this.box].reverse().find(match)
    if (already) return Promise.resolve(already)
    return new Promise((resolve) => {
      const w = { match, resolve: (m: Mail) => resolve(m) }
      this.waiters.push(w)
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w)
        resolve(null)
      }, timeoutMs)
      t.unref?.()
    })
  }

  all(): Mail[] {
    return this.box
  }

  async stop(): Promise<void> {
    if (!this.server) return
    await new Promise<void>((r) => this.server!.close(() => r()))
    this.server = null
    this.listening = false
  }
}

function addresses(v: unknown): string[] {
  const node = v as { value?: Array<{ address?: string }> } | Array<{ value?: Array<{ address?: string }> }> | undefined
  if (!node) return []
  const list = Array.isArray(node) ? node : [node]
  const out: string[] = []
  for (const n of list) for (const a of n.value ?? []) if (a.address) out.push(a.address)
  return out
}

function links(s: string): string[] {
  const found = new Set<string>()
  for (const m of s.matchAll(/https?:\/\/[^\s"'<>)]+/g)) found.add(m[0]!.replace(/[.,)]+$/, ''))
  return [...found]
}
