import net from 'node:net'

const host = process.env.LEAKY_SMTP_HOST ?? '127.0.0.1'
const port = Number(process.env.LEAKY_SMTP_PORT ?? 1025)
const base = process.env.LEAKY_BASE_URL ?? 'http://localhost:4100'
const from = 'no-reply@leaky.test'

/**
 * A 40-line SMTP client. The fixture must not need node_modules of its own,
 * and a verification mail is four commands and a body.
 * Best effort: if nothing is listening on 1025 we carry on silently, which is
 * also how an app behaves when its mail provider is down.
 */
function smtpSend(to: string, subject: string, body: string): Promise<void> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port })
    const script = [
      `EHLO leaky.test`,
      `MAIL FROM:<${from}>`,
      `RCPT TO:<${to}>`,
      `DATA`,
      `From: Leaky <${from}>\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n.`,
      `QUIT`,
    ]
    let step = -1
    const done = () => {
      try { sock.destroy() } catch { /* closed */ }
      resolve()
    }
    sock.setTimeout(4000, done)
    sock.on('error', done)
    sock.on('close', resolve)
    sock.on('data', () => {
      step++
      const line = script[step]
      if (line === undefined) return done()
      sock.write(line + '\r\n')
    })
  })
}

export async function sendVerification(to: string, token: string): Promise<void> {
  const link = `${base}/verify?token=${token}`
  await smtpSend(
    to,
    'Verify your Leaky account',
    `Welcome to Leaky.\n\nConfirm your address by opening this link:\n${link}\n\nIf you did not sign up, ignore this message.`
  )
}
