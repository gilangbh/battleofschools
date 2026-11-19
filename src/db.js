import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(dir, { recursive: true });

export const db = new DatabaseSync(path.join(dir, 'bos.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, school TEXT NOT NULL, honor TEXT,
  grp TEXT, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id),
  name TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'bronze', level_pending INTEGER NOT NULL DEFAULT 0,
  gender TEXT, is_captain INTEGER NOT NULL DEFAULT 0, is_gold INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT,
  role TEXT NOT NULL, team_id TEXT REFERENCES teams(id)
);
CREATE TABLE IF NOT EXISTS login_tokens (
  hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS showdowns (
  id INTEGER PRIMARY KEY, stage TEXT NOT NULL, round INTEGER NOT NULL, slot INTEGER NOT NULL DEFAULT 0,
  team_a TEXT REFERENCES teams(id), team_b TEXT REFERENCES teams(id),
  court TEXT, start_time TEXT
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY, showdown_id INTEGER NOT NULL REFERENCES showdowns(id) ON DELETE CASCADE,
  category TEXT NOT NULL, court TEXT, status TEXT NOT NULL DEFAULT 'scheduled',
  score_a INTEGER, score_b INTEGER, tb_a INTEGER, tb_b INTEGER,
  started_at INTEGER, finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS lineups (
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id),
  p1 INTEGER NOT NULL REFERENCES players(id), p2 INTEGER NOT NULL REFERENCES players(id),
  submitted_at INTEGER NOT NULL, by_user INTEGER,
  PRIMARY KEY (match_id, team_id)
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id),
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  type TEXT NOT NULL, player_out INTEGER REFERENCES players(id), timing TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stations (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS challenge (
  team_id TEXT NOT NULL REFERENCES teams(id),
  station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  points REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, station_id)
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getSetting(key, fallback = '') {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  return r && r.value != null ? r.value : fallback;
}

export function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}
