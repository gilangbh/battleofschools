import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, tx, getSetting, setSetting } from './db.js';
import { CATEGORIES, computeStandings, showdownSummary, generateGroupRounds, isKnockout } from './rules.js';

const DEFAULT_SETTINGS = {
  event_title: 'Homecoming 2026',
  event_date: '28 November 2026',
  venue: 'Padel Pro Satrio Club',
  courts: 'Court 1, Court 2, Court 3, Court 4, Court 5, Court 6',
  public_url: '',
};

const DEFAULT_STATIONS = [];

/** First run: load the schools and players scraped from battleofschools.id. */
export function seedIfEmpty() {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (!get('SELECT 1 AS x FROM settings WHERE key = ?', k)) setSetting(k, v);
  }
  if (get('SELECT COUNT(*) AS n FROM teams').n > 0) return false;
  const file = path.join(process.cwd(), 'seed', 'schools.json');
  const schools = JSON.parse(fs.readFileSync(file, 'utf8'));
  tx(() => {
    schools.forEach((s, i) => {
      run('INSERT INTO teams (id, name, school, honor, sort) VALUES (?, ?, ?, ?, ?)', s.slug, s.team, s.school, s.honor, i);
      for (const p of s.players) {
        const pending = /submitted/i.test(p.level) ? 1 : 0;
        const base = p.level.replace(/\(.*?\)/g, '').trim().toLowerCase();
        const level = base === 'silver' || base === 'low silver' ? 'silver' : base === 'lower bronze' ? 'lower_bronze' : 'bronze';
        run(
          'INSERT INTO players (team_id, name, level, level_pending, is_captain) VALUES (?, ?, ?, ?, ?)',
          s.slug, p.name, level, pending, p.captain ? 1 : 0,
        );
      }
    });
    DEFAULT_STATIONS.forEach((name, i) => run('INSERT INTO stations (name, sort) VALUES (?, ?)', name, i));
  });
  return true;
}

export function ensureAdmin(email) {
  if (!email) return;
  const e = email.trim().toLowerCase();
  if (!get('SELECT 1 AS x FROM users WHERE email = ?', e)) {
    run('INSERT INTO users (email, name, role) VALUES (?, ?, ?)', e, 'Admin', 'admin');
  }
}

export function courtList() {
  return getSetting('courts', DEFAULT_SETTINGS.courts).split(',').map((s) => s.trim()).filter(Boolean);
}

/** Everything the pages need, assembled in one pass. The dataset is tiny (10 schools, under 100 matches). */
export function loadState() {
  const settings = { ...DEFAULT_SETTINGS, ...Object.fromEntries(all('SELECT key, value FROM settings').map((r) => [r.key, r.value])) };
  const courts = settings.courts.split(',').map((s) => s.trim()).filter(Boolean);
  const teams = all('SELECT * FROM teams ORDER BY sort');
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const allPlayers = all('SELECT * FROM players ORDER BY team_id, is_gold, is_captain DESC, id');
  const players = allPlayers.filter((p) => p.active);
  const playerById = new Map(allPlayers.map((p) => [p.id, p]));
  for (const t of teams) {
    t.players = players.filter((p) => p.team_id === t.id);
    t.regulars = t.players.filter((p) => !p.is_gold);
    t.gold = t.players.find((p) => p.is_gold) || null;
  }

  const tickets = all('SELECT * FROM tickets ORDER BY id');
  const lineupRows = all('SELECT * FROM lineups');
  const matchRows = all('SELECT * FROM matches ORDER BY id');
  const showdowns = all('SELECT * FROM showdowns ORDER BY round, slot, id');
  const sdById = new Map(showdowns.map((s) => [s.id, s]));
  const matchById = new Map();

  for (const sd of showdowns) {
    sd.a = teamById.get(sd.team_a) || null;
    sd.b = teamById.get(sd.team_b) || null;
    sd.matches = [];
  }
  for (const m of matchRows) {
    const sd = sdById.get(m.showdown_id);
    if (!sd) continue;
    m.sd = sd;
    m.court = m.court || sd.court || '';
    m.lineup = { a: null, b: null };
    m.tickets = [];
    sd.matches.push(m);
    matchById.set(m.id, m);
  }
  for (const sd of showdowns) sd.matches.sort((x, y) => CATEGORIES.indexOf(x.category) - CATEGORIES.indexOf(y.category));

  for (const t of tickets) {
    const m = matchById.get(t.match_id);
    if (m) m.tickets.push(t);
  }
  for (const l of lineupRows) {
    const m = matchById.get(l.match_id);
    if (!m) continue;
    const side = l.team_id === m.sd.team_a ? 'a' : l.team_id === m.sd.team_b ? 'b' : null;
    if (!side) continue;
    const startTicket = m.tickets.find((t) => t.team_id === l.team_id && t.type === 'gold_player' && t.timing === 'start');
    m.lineup[side] = {
      ...l,
      player1: playerById.get(l.p1),
      player2: playerById.get(l.p2),
      goldOut: startTicket ? startTicket.player_out : null,
    };
  }
  for (const m of matchById.values()) m.revealed = Boolean(m.lineup.a && m.lineup.b);
  for (const sd of showdowns) sd.summary = showdownSummary(sd.stage, sd.matches);

  // Challenge points
  const stations = all('SELECT * FROM stations ORDER BY sort, id');
  const challengeRows = all('SELECT * FROM challenge');
  const challengeByTeam = new Map();
  for (const c of challengeRows) challengeByTeam.set(c.team_id, (challengeByTeam.get(c.team_id) || 0) + c.points);

  const standings = computeStandings(teams, showdowns, challengeByTeam);

  // Appearances (group stage) and tickets used per team
  const appearances = new Map(players.map((p) => [p.id, 0]));
  for (const m of matchById.values()) {
    if (m.sd.stage !== 'group') continue;
    for (const side of ['a', 'b']) {
      const l = m.lineup[side];
      if (!l) continue;
      appearances.set(l.p1, (appearances.get(l.p1) || 0) + 1);
      appearances.set(l.p2, (appearances.get(l.p2) || 0) + 1);
    }
  }
  const ticketsByTeam = new Map(teams.map((t) => [t.id, []]));
  for (const t of tickets) ticketsByTeam.get(t.team_id)?.push(t);

  const allMatches = [...matchById.values()];
  const courtOrder = (c) => { const i = courts.indexOf(c); return i === -1 ? 999 : i; };
  const live = allMatches.filter((m) => m.status === 'live').sort((x, y) => courtOrder(x.court) - courtOrder(y.court) || x.id - y.id);
  const recent = allMatches.filter((m) => m.status === 'done').sort((x, y) => (y.finished_at || 0) - (x.finished_at || 0));

  return {
    settings, courts, teams, teamById, players, allPlayers, playerById, showdowns, sdById, matchById, allMatches,
    stations, challengeRows, challengeByTeam, standings, appearances, ticketsByTeam, live, recent,
    groupsSet: teams.some((t) => t.grp),
    knockout: showdowns.filter((s) => isKnockout(s.stage)),
  };
}

// ---------- Mutations ----------

function addShowdown(stage, round, slot, a, b) {
  const r = run('INSERT INTO showdowns (stage, round, slot, team_a, team_b) VALUES (?, ?, ?, ?, ?)', stage, round, slot, a, b);
  const id = Number(r.lastInsertRowid);
  for (const c of CATEGORIES) run('INSERT INTO matches (showdown_id, category) VALUES (?, ?)', id, c);
  return id;
}

export function createShowdown(stage, round, a = null, b = null) {
  const slot = (get('SELECT COALESCE(MAX(slot), -1) + 1 AS s FROM showdowns WHERE round = ?', round).s) || 0;
  return tx(() => addShowdown(stage, round, slot, a, b));
}

/** Replace every fixture with five cross-group rounds plus two semifinals and a final. Clears all scores and lineups. */
export function generateFixtures() {
  const a = all("SELECT id FROM teams WHERE grp = 'A' ORDER BY sort").map((t) => t.id);
  const b = all("SELECT id FROM teams WHERE grp = 'B' ORDER BY sort").map((t) => t.id);
  if (a.length !== b.length || a.length < 2) throw new Error('Put the same number of schools in Group A and Group B first.');
  tx(() => {
    run('DELETE FROM showdowns');
    const rounds = generateGroupRounds(a, b);
    rounds.forEach((pairs, r) => pairs.forEach(([x, y], i) => addShowdown('group', r + 1, i, x, y)));
    const n = rounds.length;
    addShowdown('semi', n + 1, 0, null, null);
    addShowdown('semi', n + 1, 1, null, null);
    addShowdown('final', n + 2, 0, null, null);
  });
}

/** Semifinals from the current standings (A1 v A2, B1 v B2), final from the semifinal winners. */
export function fillKnockout() {
  const s = loadState();
  const semis = s.showdowns.filter((x) => x.stage === 'semi');
  const final = s.showdowns.find((x) => x.stage === 'final');
  const notes = [];
  // Never re-seat a knockout showdown that already has a lineup or a score.
  const untouched = (sd) => sd.matches.every((m) => m.status === 'scheduled' && !m.lineup.a && !m.lineup.b);
  const ga = s.standings.A || [];
  const gb = s.standings.B || [];
  tx(() => {
    if (semis[0] && ga.length >= 2 && untouched(semis[0])) {
      run('UPDATE showdowns SET team_a = ?, team_b = ? WHERE id = ?', ga[0].team.id, ga[1].team.id, semis[0].id);
      notes.push(`Semifinal 1: ${ga[0].team.name} v ${ga[1].team.name}`);
    }
    if (semis[1] && gb.length >= 2 && untouched(semis[1])) {
      run('UPDATE showdowns SET team_a = ?, team_b = ? WHERE id = ?', gb[0].team.id, gb[1].team.id, semis[1].id);
      notes.push(`Semifinal 2: ${gb[0].team.name} v ${gb[1].team.name}`);
    }
    if (final && semis.length === 2) {
      const w = semis.map((sd) => (sd.summary.winner === 'a' ? sd.team_a : sd.summary.winner === 'b' ? sd.team_b : null));
      if (w[0] && w[1] && untouched(final)) {
        run('UPDATE showdowns SET team_a = ?, team_b = ? WHERE id = ?', w[0], w[1], final.id);
        notes.push('Final set from the semifinal winners.');
      }
    }
  });
  return notes;
}

export function resetResults() {
  tx(() => {
    run('DELETE FROM tickets');
    run('DELETE FROM lineups');
    run("UPDATE matches SET status = 'scheduled', score_a = NULL, score_b = NULL, tb_a = NULL, tb_b = NULL, started_at = NULL, finished_at = NULL");
    run('DELETE FROM challenge');
    run("UPDATE showdowns SET team_a = NULL, team_b = NULL WHERE stage != 'group'");
  });
}
