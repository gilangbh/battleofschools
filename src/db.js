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

// Added after the first release: portrait file name under public/assets/players.
if (!db.prepare('PRAGMA table_info(players)').all().some((c) => c.name === 'photo')) db.exec('ALTER TABLE players ADD COLUMN photo TEXT');

// Winner of a semifinal or final, set by an admin once the committee confirms it ('a' or 'b').
if (!db.prepare('PRAGMA table_info(showdowns)').all().some((c) => c.name === 'winner')) db.exec('ALTER TABLE showdowns ADD COLUMN winner TEXT');

// Registration identity, kept apart from the short name shown on scoreboards.
for (const col of ['reg_id', 'full_name', 'jersey_name']) {
  if (!db.prepare('PRAGMA table_info(players)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE players ADD COLUMN ${col} TEXT`);
}

// School Yard activities. One official result per school, station and group showdown (slot 1 to 5), or slot 0 for
// the single event-wide On run. The primary key is what stops a repeated submission becoming a second attempt.
// Every write is also appended to activity_log, so a correction never erases what was first recorded.
db.exec(`
CREATE TABLE IF NOT EXISTS activity (
  team_id TEXT NOT NULL REFERENCES teams(id), station TEXT NOT NULL, slot INTEGER NOT NULL,
  score REAL NOT NULL, raw TEXT NOT NULL, by_user INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, station, slot)
);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY, team_id TEXT NOT NULL, station TEXT NOT NULL, slot INTEGER NOT NULL,
  action TEXT NOT NULL, score REAL, raw TEXT, by_user INTEGER, by_email TEXT, at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bonus (
  team_id TEXT PRIMARY KEY REFERENCES teams(id), points REAL NOT NULL, by_user INTEGER, at INTEGER NOT NULL
);
`);

// Later additions to the activity tables.
const addColumn = (table, col, type) => { if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); };
addColumn('activity', 'held', 'INTEGER NOT NULL DEFAULT 0'); // recorded but waiting for a committee decision: not counted
addColumn('bonus', 'accounts', 'INTEGER'); // verified eligible unique accounts behind the School Spirit bonus
addColumn('bonus', 'evidence', 'TEXT');

// School Yard Champion: a separate ledger of each supporter's raw result at each station. Credited points stay
// empty until the award policy is approved. One record per person and station for the whole event.
// Gold Americano: a separate individual event with its own players and matches, apart from the school tournament.
db.exec(`
CREATE TABLE IF NOT EXISTS award (
  id INTEGER PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id), person TEXT NOT NULL, person_key TEXT NOT NULL,
  kind TEXT NOT NULL, station TEXT NOT NULL, raw TEXT NOT NULL, ref TEXT, credit REAL,
  by_user INTEGER, by_email TEXT, at INTEGER NOT NULL,
  UNIQUE (person_key, station)
);
CREATE TABLE IF NOT EXISTS award_log (
  id INTEGER PRIMARY KEY, action TEXT NOT NULL, team_id TEXT, person TEXT, station TEXT, raw TEXT, by_email TEXT, at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS am_players (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, label TEXT, team_id TEXT REFERENCES teams(id), photo TEXT, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS am_matches (
  id INTEGER PRIMARY KEY, round INTEGER NOT NULL, a1 INTEGER NOT NULL, a2 INTEGER NOT NULL, b1 INTEGER NOT NULL, b2 INTEGER NOT NULL,
  bye INTEGER, score_a INTEGER, score_b INTEGER, status TEXT NOT NULL DEFAULT 'scheduled', updated_at INTEGER
);
`);

// Planned court and time for one category match (blank = the showdown's). matches.court is only where the desk
// actually put the match. The exhibition records its tiebreak separately.
addColumn('matches', 'plan_court', 'TEXT');
addColumn('matches', 'plan_time', 'TEXT');
addColumn('am_matches', 'tb_a', 'INTEGER');
addColumn('am_matches', 'tb_b', 'INTEGER');

// A school's final points for one station, typed straight into the overview table. When present it is used for
// the standings in place of the showdown-by-showdown results, which stay on record as evidence.
db.exec(`
CREATE TABLE IF NOT EXISTS station_final (
  team_id TEXT NOT NULL REFERENCES teams(id), station TEXT NOT NULL, points REAL NOT NULL,
  by_user INTEGER, at INTEGER NOT NULL,
  PRIMARY KEY (team_id, station)
);
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
