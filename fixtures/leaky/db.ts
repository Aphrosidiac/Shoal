import Database from 'better-sqlite3'
import { existsSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const DB_PATH = join(here, 'leaky.db')

if (process.env.LEAKY_FRESH !== '0' && existsSync(DB_PATH)) {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = DB_PATH + suffix
    if (existsSync(p)) unlinkSync(p)
  }
}

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('busy_timeout = 5000')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  password   TEXT NOT NULL,
  name       TEXT,
  role       TEXT NOT NULL DEFAULT 'user',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  name       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  notes      TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  customer_id INTEGER,
  ref         TEXT NOT NULL,
  qty         INTEGER NOT NULL DEFAULT 1,
  price       REAL NOT NULL DEFAULT 0,
  notes       TEXT,
  idem_key    TEXT,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  order_id   INTEGER,
  ref        TEXT NOT NULL,
  total      REAL NOT NULL DEFAULT 0,
  paid_amt   REAL NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'UNPAID',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  amount     REAL NOT NULL,
  method     TEXT,
  reference  TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deliveries (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  slot       TEXT NOT NULL,
  taken      INTEGER NOT NULL DEFAULT 0,
  address    TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS slots (
  id        INTEGER PRIMARY KEY,
  label     TEXT NOT NULL UNIQUE,
  capacity  INTEGER NOT NULL,
  booked    INTEGER NOT NULL DEFAULT 0
);
`)

if ((db.prepare('SELECT COUNT(*) c FROM slots').get() as { c: number }).c === 0) {
  const ins = db.prepare('INSERT INTO slots (label, capacity, booked) VALUES (?, ?, 0)')
  for (const l of ['mon-am', 'mon-pm', 'tue-am', 'tue-pm', 'wed-am']) ins.run(l, 3)
}

export const now = () => Math.floor(Date.now() / 1000)
export const rid = (n = 12) =>
  Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')
