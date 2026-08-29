import { createHash } from 'node:crypto'

/**
 * An app fingerprint, so a finding can be stamped with the build it was seen
 * against. We have no source access, so this is made of what the app tells the
 * outside world: the ETags and script URLs of its own front end, plus a few
 * headers that change when a server restarts.
 */
export function fingerprintOf(input: {
  html: string
  headers: Record<string, string>
}): string {
  const scripts = [...input.html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]!).sort()
  const styles = [...input.html.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"/g)].map((m) => m[1]!).sort()
  const h = input.headers
  const parts = [
    scripts.join(','),
    styles.join(','),
    h['etag'] ?? '',
    h['x-powered-by'] ?? '',
    h['server'] ?? '',
    h['x-app-version'] ?? h['x-version'] ?? '',
  ]
  return createHash('sha1').update(parts.join('\n')).digest('hex').slice(0, 12)
}
