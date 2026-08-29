import type { Config } from './config.js'
import { boot } from './supervisor.js'
import * as findings from './store/repo/findings.js'
import { Replayer } from './replay/request.js'
import * as recordings from './store/repo/recordings.js'
import { faultAttempt } from './replay/probes.js'
import { text } from './report/render.js'
import { build } from './report/build.js'

/**
 * Re-run one finding's repro against the app as it is right now. This is the
 * last step of the fix loop: change the code, press it, watch the finding go
 * green — and a `fixed` finding is never deleted, because one that disappears
 * and comes back three days later is worth more than either event on its own.
 */
export async function recheck(cfg: Config, id: number, log: (k: string, m: string) => void): Promise<number> {
  const sup = await boot(cfg, log)
  const { ctx } = sup
  try {
    const f = findings.byId(ctx.db, id)
    if (!f) {
      process.stderr.write(`no finding #${id}\n`)
      return 1
    }
    const repro = JSON.parse(f.repro_json) as { check: string }
    const recIds = findings.eventsOf(ctx.db, id)
    const rec = recIds.map((r) => recordings.byId(ctx.db, r)).find((r) => r !== undefined)
    if (!rec) {
      findings.setState(ctx.db, id, 'stale', ctx.app.versionId)
      process.stdout.write(`#${id} cannot be rechecked — the recording behind it is gone. Marked stale.\n`)
      return 0
    }

    const rp = new Replayer(ctx, 'recheck')
    let reproduced = 0
    let conclusive = 0
    let why = ''
    for (let i = 0; i < 5; i++) {
      const a = await faultAttempt(ctx, rp, rec, repro.check)
      if (a.verdict === 'inconclusive') {
        why = a.why ?? 'could not test it'
        continue
      }
      conclusive++
      if (a.verdict === 'reproduced') reproduced++
    }

    if (reproduced) {
      findings.setState(ctx.db, id, 'open', ctx.app.versionId)
      process.stdout.write(`#${id} still reproduces, ${reproduced}/${conclusive}, against build ${ctx.app.fingerprint}\n`)
    } else if (!conclusive) {
      // "Fixed" has to be earned. A run of requests that never reached the code
      // is not evidence of anything, and calling it fixed is the worst thing
      // this tool could tell you — it says a bug is gone while the app is
      // still serving it.
      findings.setState(ctx.db, id, 'stale', ctx.app.versionId)
      process.stdout.write(`#${id} could not be re-checked: ${why}. Marked stale, not fixed.\n`)
    } else {
      findings.setState(ctx.db, id, 'fixed', ctx.app.versionId)
      process.stdout.write(`#${id} no longer reproduces in ${conclusive} attempts against build ${ctx.app.fingerprint}. Marked fixed, and kept.\n`)
    }
    sup.writeReport()
    if (process.env.SHOAL_RECHECK_REPORT) process.stdout.write(text(build(ctx.db, ctx.base)) + '\n')
    return 0
  } finally {
    await sup.shutdown()
  }
}
