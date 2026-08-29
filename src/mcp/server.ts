import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { call, TOOLS } from './tools.js'
import { Channel } from './channel.js'

/**
 * Shoal as something Claude Code can operate: start it, ask what it found, fix
 * the thing, ask it to check again. One sentence to Claude Code — "start my
 * dev server and point Shoal at it" — instead of a second terminal.
 *
 *   claude mcp add --scope user --transport stdio shoal -- npx shoal mcp
 */
export async function serveMcp(dir: string): Promise<number> {
  const server = new Server({ name: 'shoal', version: '0.1.0' }, { capabilities: { tools: {}, logging: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS as unknown as [] }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>
    return call(req.params.name, args)
  })

  const channel = new Channel(dir, (level, text) => {
    void server.sendLoggingMessage({ level: level === 'warning' ? 'warning' : 'info', logger: 'shoal', data: text }).catch(() => undefined)
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  channel.catchUp()
  channel.start()

  await new Promise<void>((resolve) => {
    transport.onclose = (): void => resolve()
    process.on('SIGINT', resolve)
    process.on('SIGTERM', resolve)
  })
  channel.stop()
  return 0
}
