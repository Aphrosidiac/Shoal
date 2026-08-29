import { open } from './store/db.js'

/**
 * Clears findings, suspicions and traffic but keeps the map. Losing a day of
 * mapping must not be one keystroke — that is what `--all` is for.
 */
export function reset(dir: string): void {
  const db = open(dir)
  db.exec(`
    DELETE FROM finding_events;
    DELETE FROM findings;
    DELETE FROM suspicions;
    DELETE FROM recordings;
    DELETE FROM queue;
    DELETE FROM model_calls;
    DELETE FROM events;
    UPDATE endpoints SET hammered = 0, calls = 0, statuses_json = '{}';
    UPDATE pages SET visits = 0;
    DELETE FROM coverage;
  `)
}
