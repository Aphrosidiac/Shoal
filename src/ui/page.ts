/**
 * The dashboard, served as it is written. No framework, no bundler, no build
 * step: a dev tool that can fail to compile is one that stops you shipping,
 * and this has to start at 2am on somebody else's machine.
 *
 * Its language is ANK Ops' (css.ts); its flow is the front door first — a
 * URL, a duration, a budget, one green button — then Findings.
 */
export { CSS } from './css.js'
export { HTML } from './html.js'
export { JS } from './app.js'
