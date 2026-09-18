import type { Config } from '../config.js'
import type { JevConfig } from './client.js'

export function jevConfig(cfg: Config): JevConfig {
  const apiKey = cfg.jev.apiKey ?? process.env.TYPESAFE_API_KEY ?? ''
  if (!apiKey) {
    throw new Error(
      'Shoal drives and judges with TypeSafe Jev and no key is set. Put TYPESAFE_API_KEY in .env or the environment ' +
        '(https://console.typesafe.ai), or "jev": {"apiKey": "..."} in shoal.config.json.'
    )
  }
  return { apiKey, model: cfg.jev.model, baseUrl: cfg.jev.baseUrl, maxUsd: cfg.jev.maxUsd, timeoutMs: cfg.jev.timeoutMs }
}
