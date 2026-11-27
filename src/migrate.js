// One-time data corrections that go with a release, and a plain readback of the live data in the server log.
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, tx, db, getSetting, setSetting } from './db.js';
import { schedule } from './americano.js';

const dataDir = () => process.env.DATA_DIR || path.join(process.cwd(), 'data');

/** A copy of the database as it was, kept beside it, before anything is changed. */
function snapshot(label) {
  const dir = path.join(dataDir(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

// Knockout category assignments from the master schedule (organizer handoff, 27 November 2026).
const KNOCKOUT_PLAN = {
  semi0: { men: ['15:25', 'Court 1'], women: ['15:25', 'Court 2'], open: ['15:45', 'Court 1'] },
  semi1: { men: ['15:25', 'Court 4'], women: ['15:25', 'Court 5'], open: ['15:45', 'Court 2'] },
  final: { men: ['16:25', 'Court 3'], women: ['16:45', 'Court 3'], open: ['17:05', 'Court 3'] },
};
const EXHIBITION = [['acs', 'ACS'], ['bsj', 'BSJ'], ['jis', 'JIS'], ['nzsj', 'NZSJ']];
// Scorer row to canonical registration ID, as supplied by the organizer.
const GOLD_IDS = [
  [82, 'jis', 'BOS26-GOLDEN-cb955c532297460e8f58c6182b430030'],
  [84, 'bsj', 'BOS26-GOLDEN-bd9b7927cd604974ac3c990e6bc9b15d'],
  [85, 'nzsj', 'BOS26-GOLDEN-25231de1e47c461a944a470a4ea3e1ec'],
];

/** Category courts saved before the fixtures were re-entered must not survive on matches that have not started. */
function launchCourts() {
  run("UPDATE matches SET court = NULL WHERE status = 'scheduled'");
  const ko = all("SELECT * FROM showdowns WHERE stage IN ('semi', 'final') ORDER BY stage, slot, id");
  const semis = ko.filter((s) => s.stage === 'semi');
  const finals = ko.filter((s) => s.stage === 'final');
  if (semis.length !== 2 || finals.length !== 1) return;
  for (const [sd, plan] of [[semis[0], KNOCKOUT_PLAN.semi0], [semis[1], KNOCKOUT_PLAN.semi1], [finals[0], KNOCKOUT_PLAN.final]]) {
    for (const [category, [time, court]] of Object.entries(plan)) {
      run("UPDATE matches SET plan_time = ?, plan_court = ? WHERE showdown_id = ? AND category = ? AND status = 'scheduled'", time, court, sd.id, category);
    }
  }
}

/** The exhibition is the four school-community Gold players, three rounds, blank. Skipped once any round has a score. */
function exhibitionField() {
  if (get("SELECT COUNT(*) AS n FROM am_matches WHERE status = 'done'").n) return;
  const gold = EXHIBITION.map(([team, label]) => ({ team, label, p: get('SELECT * FROM players WHERE team_id = ? AND is_gold = 1 ORDER BY active DESC, id DESC', team) }));
  if (gold.some((g) => !g.p)) return;
  const existing = all('SELECT * FROM am_players ORDER BY sort, id');
  const first = (name) => String(name || '').trim().split(/\s+/)[0].toLowerCase();
  run('DELETE FROM am_matches');
  const ids = gold.map((g, i) => {
    const had = existing.find((x) => first(x.name) === first(g.p.full_name || g.p.name));
    if (had) { run('UPDATE am_players SET label = ?, team_id = ?, sort = ? WHERE id = ?', g.label, g.team, i, had.id); return had.id; }
    return Number(run('INSERT INTO am_players (name, label, team_id, photo, sort) VALUES (?, ?, ?, ?, ?)', g.p.full_name || g.p.name, g.label, g.team, g.p.photo, i).lastInsertRowid);
  });
  for (const x of existing) if (!ids.includes(x.id)) run('DELETE FROM am_players WHERE id = ?', x.id);
  for (const r of schedule(ids)) run('INSERT INTO am_matches (round, a1, a2, b1, b2) VALUES (?, ?, ?, ?, ?)', r.round, r.a[0], r.a[1], r.b[0], r.b[1]);
  setSetting('am_winner', '');
  setSetting('am_runner', '');
}

function goldIds() {
  for (const [id, team, reg] of GOLD_IDS) run('UPDATE players SET reg_id = ? WHERE id = ? AND team_id = ? AND is_gold = 1 AND reg_id IS NULL', reg, id, team);
}

/** The two organizer free agents named in the handoff of 27 November (both confirmed as men). */
function goldPool() {
  if (get('SELECT COUNT(*) AS n FROM free_gold').n) return;
  for (const name of ['Julius Liman', 'Harsya Rusmiputro']) run("INSERT INTO free_gold (name, gender, active) VALUES (?, 'M', 1)", name);
}

const MIGRATIONS = [
  ['mig_20261127_launch', () => { launchCourts(); exhibitionField(); goldIds(); }],
  ['mig_20261127_goldpool', goldPool],
];

export function migrate() {
  for (const [key, step] of MIGRATIONS) {
    if (getSetting(key)) continue;
    if (get('SELECT COUNT(*) AS n FROM showdowns').n) console.log(`Data correction ${key}: backup written to ${snapshot('pre-' + key)}`);
    tx(() => { step(); setSetting(key, new Date().toISOString()); });
  }
}

/** Counts and court assignments only: no names, pairings or logins. */
export function dataCheck() {
  const n = (sql) => get(sql).n;
  const offCourt = n("SELECT COUNT(*) AS n FROM matches m JOIN showdowns s ON s.id = m.showdown_id WHERE s.stage = 'group' AND COALESCE(m.court, m.plan_court, s.court) IS NOT s.court");
  const ko = all("SELECT s.stage, s.slot, m.category, COALESCE(m.plan_time, s.start_time) AS t, COALESCE(m.court, m.plan_court, s.court) AS c FROM matches m JOIN showdowns s ON s.id = m.showdown_id WHERE s.stage != 'group' ORDER BY s.stage DESC, s.slot, m.id");
  const gold = all('SELECT team_id, MAX(active) AS active FROM players WHERE is_gold = 1 GROUP BY team_id ORDER BY team_id');
  console.log(`DATA CHECK matches: group ${n("SELECT COUNT(*) AS n FROM matches m JOIN showdowns s ON s.id = m.showdown_id WHERE s.stage = 'group'")}, group off their showdown court ${offCourt}, started or scored ${n("SELECT COUNT(*) AS n FROM matches WHERE status != 'scheduled'")}, lineups ${n('SELECT COUNT(*) AS n FROM lineups')}, tickets ${n('SELECT COUNT(*) AS n FROM tickets')}`);
  console.log(`DATA CHECK knockout: ${ko.map((m) => `${m.stage}${m.stage === 'semi' ? m.slot + 1 : ''} ${m.category} ${m.t || '?'} ${m.c || '?'}`).join('; ')}`);
  console.log(`DATA CHECK school yard: showdown results ${n('SELECT COUNT(*) AS n FROM activity')}, final totals ${n('SELECT COUNT(*) AS n FROM station_final')}, starting points ${n('SELECT COUNT(*) AS n FROM bonus')}, ledger records ${n('SELECT COUNT(*) AS n FROM award')}`);
  console.log(`DATA CHECK exhibition: players ${n('SELECT COUNT(*) AS n FROM am_players')} (${all('SELECT label FROM am_players ORDER BY sort, id').map((p) => p.label || '?').join(', ')}), rounds ${n('SELECT COUNT(*) AS n FROM am_matches')}, scored ${n("SELECT COUNT(*) AS n FROM am_matches WHERE status = 'done'")}`);
  console.log(`DATA CHECK school gold players: ${gold.map((g) => `${g.team_id} ${g.active ? 'active' : 'OFF'}`).join(', ') || 'none'}; organizer gold pool ${n('SELECT COUNT(*) AS n FROM free_gold WHERE active = 1')}; captain logins ${n("SELECT COUNT(*) AS n FROM users WHERE role = 'captain'")}; visibility ${getSetting('visibility')}`);
}
