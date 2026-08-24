/**
 * Per-target configuration, kept out of the repository.
 *
 * Two different things live here and both belong outside the source. Paths are
 * machine-specific, so a target with one hardcoded cannot be run by anybody
 * else. Credentials are secret, and a password committed to a repository does
 * not become secret again when the visibility changes back.
 *
 * Everything except `root` is whatever the target asks for — Shoal does not
 * inspect it. A target reads its own entry and decides what it needs.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface TargetConfig {
  /** Absolute path to the target's backend. */
  root: string
  [key: string]: unknown
}

export const CONFIG_FILE = join(fileURLToPath(new URL('.', import.meta.url)), '../../shoal.local.json')

let cache: Record<string, TargetConfig> | null = null

export function configFor(target: string): TargetConfig {
  if (!cache) {
    try {
      cache = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    } catch {
      throw new Error(
        `no shoal.local.json — copy shoal.local.example.json to shoal.local.json and add an\n` +
          `  entry for "${target}". It is gitignored; nothing in it is ever committed.`,
      )
    }
  }
  const found = cache?.[target]
  if (!found) throw new Error(`shoal.local.json has no entry for target "${target}"`)
  if (!found.root) throw new Error(`shoal.local.json is missing "root" for target "${target}"`)
  return found
}

/** Reads a required string, with an error that names what to add rather than undefined. */
export function required(cfg: TargetConfig, key: string): string {
  const v = cfg[key]
  if (typeof v !== 'string' || !v) throw new Error(`shoal.local.json is missing "${key}" for this target`)
  return v
}
