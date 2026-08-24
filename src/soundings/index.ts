/**
 * The generic sounding library.
 *
 * Import what applies, give it a route or a query, and a new target has a real
 * instrument before a single domain rule has been written. The domain rules —
 * the ones nobody can write for you — go in the target's own soundings file,
 * and that is where the value is.
 */
export { pagingIsStable, listingMatchesCount, roleGating, frozenAfter, noOrphanedRows } from './generic.js'
export { screenAgreesWithTheDatabase, type PageCheck, type BrowserOptions } from './browser.js'
