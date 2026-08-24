/**
 * Target credentials, kept out of the repository.
 *
 * Shoal logs in as real accounts on a real system, so a target definition
 * naturally wants a password written next to five email addresses. That is
 * fine in a private repo and is a published credential the moment it is not —
 * and the accounts are the ones a live deployment was seeded with, so anyone
 * reading could try them against production. Repositories change visibility;
 * a secret committed to one does not become secret again afterwards.
 *
 * The file is gitignored and read at startup. There is no default: falling
 * back to a built-in password would put the thing back in the source and make
 * the whole exercise decorative.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface TargetSecrets {
  /** Shared password for the seeded accounts. */
  password: string
  /** Domain the persona local-parts hang off, e.g. "example.com". */
  emailDomain: string
  /** Absolute path to the target's backend. Machine-specific, so not in the source. */
  root: string
  /** Absolute path to the target's frontend, when there is one to drive. */
  webRoot?: string
}

const FILE = join(fileURLToPath(new URL('.', import.meta.url)), '../../shoal.local.json')

let cache: Record<string, TargetSecrets> | null = null

export function secretsFor(target: string): TargetSecrets {
  if (!cache) {
    try {
      cache = JSON.parse(readFileSync(FILE, 'utf8'))
    } catch {
      throw new Error(
        `no shoal.local.json — copy shoal.local.example.json to shoal.local.json and fill in the\n` +
          `  accounts for "${target}". It is gitignored; nothing in it is ever committed.`,
      )
    }
  }
  const found = cache?.[target]
  if (!found) throw new Error(`shoal.local.json has no entry for target "${target}"`)
  for (const field of ['password', 'emailDomain', 'root'] as const) {
    if (!found[field]) throw new Error(`shoal.local.json is missing "${field}" for target "${target}"`)
  }
  return found
}
