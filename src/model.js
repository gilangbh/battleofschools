import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, tx, getSetting, setSetting } from './db.js';
import { CATEGORIES, computeStandings, showdownSummary, generateGroupRounds, isKnockout } from './rules.js';
import { summarize } from './activity.js';

const DEFAULT_SETTINGS = {
  event_title: 'Homecoming 2026',
  event_date: '28 November 2026',
  venue: 'Padel Pro Satrio Club',
  courts: 'Court 1, Court 2, Court 3, Court 4, Court 5, Court 6',
  public_url: '',
};

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
          'INSERT INTO players (team_id, name, level, level_pending, is_captain, photo) VALUES (?, ?, ?, ?, ?, ?)',
          s.slug, p.name, level, pending, p.captain ? 1 : 0, p.photo || null,
        );
      }
    });
  });
  return true;
}

/** Gives players that were loaded before portraits existed their photo, matched by school and name. */
export function backfillPhotos() {
  const file = path.join(process.cwd(), 'seed', 'schools.json');
  if (!fs.existsSync(file)) return;
  for (const s of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    for (const p of s.players) if (p.photo) run('UPDATE players SET photo = ? WHERE team_id = ? AND name = ? AND photo IS NULL', p.photo, s.slug, p.name);
  }
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

  // School Yard activities and the pre-event School Spirit bonus
  const activityRows = all('SELECT * FROM activity');
  for (const r of activityRows) { try { r.raw = JSON.parse(r.raw); } catch { r.raw = {}; } }
  const bonusByTeam = new Map(all('SELECT * FROM bonus').map((b) => [b.team_id, b.points]));
  const yardByTeam = new Map(teams.map((t) => [t.id, summarize(activityRows.filter((r) => r.team_id === t.id))]));
  const yardStarted = activityRows.length > 0 || bonusByTeam.size > 0;
  const extraByTeam = new Map(teams.map((t) => {
    const y = yardByTeam.get(t.id);
    return [t.id, { yard: y.banked, bonus: bonusByTeam.get(t.id) || 0, pending: !y.complete || !bonusByTeam.has(t.id) }];
  }));

  const standings = computeStandings(teams, showdowns, extraByTeam);

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
    activityRows, yardByTeam, bonusByTeam, yardStarted, standings, appearances, ticketsByTeam, live, recent,
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

/**
 * Semifinals from the final group standings (A1 v A2, B1 v B2); final from the confirmed semifinal winners.
 * Nothing is filled while a place is still open: an unfinished group stage, a tie across the top-two cut,
 * or a semifinal whose winner the organizer has not confirmed.
 */
export function fillKnockout() {
  const s = loadState();
  const semis = s.showdowns.filter((x) => x.stage === 'semi');
  const final = s.showdowns.find((x) => x.stage === 'final');
  const notes = [];
  // Never re-seat a knockout showdown that already has a lineup or a score.
  const untouched = (sd) => sd.matches.every((x) => x.status === 'scheduled' && !x.lineup.a && !x.lineup.b);
  tx(() => {
    [['A', semis[0]], ['B', semis[1]]].forEach(([g, sd], i) => {
      const list = s.standings[g] || [];
      if (!sd || list.length < 2) return;
      if (!untouched(sd)) { notes.push(`Semifinal ${i + 1} already has a lineup or score, so it was left alone`); return; }
      if (list.some((row) => row.place === 'tied')) { notes.push(`Group ${g} has a tie for a semifinal place: set Semifinal ${i + 1} by hand once the committee decides`); return; }
      if (list[0].place !== 'qualified' || list[1].place !== 'qualified') {
        const waiting = list.filter((row) => row.pending).map((row) => row.team.name);
        notes.push(waiting.length
          ? `Group ${g} is still waiting for School Yard results or the School Spirit bonus of ${waiting.join(', ')}. Enter them, or set Semifinal ${i + 1} by hand in the fixtures table`
          : `Group ${g} still has matches to finish`);
        return;
      }
      run('UPDATE showdowns SET team_a = ?, team_b = ? WHERE id = ?', list[0].team.id, list[1].team.id, sd.id);
      notes.push(`Semifinal ${i + 1}: ${list[0].team.name} v ${list[1].team.name}`);
    });
    if (final && semis.length === 2 && semis.every((sd) => sd.summary.complete)) {
      const w = semis.map((sd) => (sd.summary.winner === 'a' ? sd.team_a : sd.summary.winner === 'b' ? sd.team_b : null));
      if (!w[0] || !w[1]) notes.push('A semifinal has no winner yet');
      else if (!untouched(final)) notes.push('The final already has a lineup or score, so it was left alone');
      else {
        run('UPDATE showdowns SET team_a = ?, team_b = ? WHERE id = ?', w[0], w[1], final.id);
        notes.push('Final set from the two semifinal winners');
      }
    }
  });
  return notes;
}

/** Removes every score. Lineups with their tickets, and School Yard results with the bonus, go only when asked. */
export function resetResults({ lineups = true, yard = true } = {}) {
  tx(() => {
    run("UPDATE matches SET status = 'scheduled', score_a = NULL, score_b = NULL, tb_a = NULL, tb_b = NULL, started_at = NULL, finished_at = NULL");
    if (lineups) {
      run('DELETE FROM tickets');
      run('DELETE FROM lineups');
      run("UPDATE showdowns SET team_a = NULL, team_b = NULL WHERE stage != 'group'");
    }
    if (yard) {
      run('DELETE FROM activity');
      run('DELETE FROM activity_log');
      run('DELETE FROM bonus');
    }
  });
}
