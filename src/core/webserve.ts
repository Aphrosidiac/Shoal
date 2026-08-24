/**
 * Serves the target's built frontend, with /api pointed at the voyage's backend.
 *
 * NOT the target's own `vite dev`. Its config hardcodes a proxy to the app's
 * normal development port, so a UI driven through it would be talking to a
 * different database than the one being swept — or to nothing, or to whatever
 * the developer happens to have running. Rewriting that config means writing
 * into the target's repository, which Shoal has no business doing.
 *
 * Serving the built bundle avoids all of it, needs no dependency beyond node's
 * own http, and has the side benefit of testing what actually ships rather
 * than what the dev server transforms.
 */
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { extname, join, normalize } from 'node:path'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

export async function buildFrontend(root: string, force = false): Promise<string> {
  const dist = join(root, 'dist')
  if (existsSync(join(dist, 'index.html')) && !force) return dist
  await new Promise<void>((resolve, reject) => {
    const p = spawn('npm', ['run', 'build'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr?.on('data', (c) => (err += c.toString()))
    p.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`frontend build failed (${code}):\n${err.slice(-1200)}`)),
    )
  })
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`build produced no ${join(dist, 'index.html')}`)
  return dist
}

export function serveDist(dist: string, port: number, apiPort: number): Promise<{ server: Server; stop: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const url = req.url ?? '/'

    if (url.startsWith('/api')) {
      const upstream = httpRequest(
        { host: '127.0.0.1', port: apiPort, path: url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${apiPort}` } },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers)
          up.pipe(res)
        },
      )
      upstream.on('error', () => {
        // 503, not 502. Cloudflare replaces a 502 with its own page on the
        // deployed systems here, and a habit that only breaks in production is
        // not worth keeping locally either.
        res.writeHead(503, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'the voyage backend did not answer' }))
      })
      req.pipe(upstream)
      return
    }

    // Anything that is not a file is the SPA's own routing, so index.html.
    const rel = normalize(decodeURIComponent(url.split('?')[0] ?? '/')).replace(/^(\.\.[/\\])+/, '')
    let file = join(dist, rel)
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html')
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () =>
      resolve({
        server,
        stop: () => new Promise<void>((done) => server.close(() => done())),
      }),
    )
  })
}
