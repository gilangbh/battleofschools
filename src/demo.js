import { all, get, run, tx } from './db.js';
import { generateFixtures, courtList } from './model.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => arr.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);

function randomPair(players) {
  for (let i = 0; i < 50; i++) {
    const [a, b] = shuffle(players);
    if (!(a.level === 'silver' && b.level === 'silver')) return [a, b];
  }
  return players.slice(0, 2);
}

/** Random groups, fixtures, lineups and scores so every screen has something to show. Test use only. */
export function loadDemo() {
  const teams = shuffle(all('SELECT id FROM teams'));
  tx(() => teams.forEach((t, i) => run('UPDATE teams SET grp = ? WHERE id = ?', i < teams.length / 2 ? 'A' : 'B', t.id)));
  generateFixtures();
  const courts = courtList();
  const now = Date.now();

  tx(() => {
    run('DELETE FROM tickets');
    // School Yard results for the two finished rounds, so the standings show a mix of recorded and pending.
    run('DELETE FROM activity');
    run('DELETE FROM station_final');
    run('DELETE FROM activity_log');
    run('DELETE FROM bonus');
    const yard = (team, station, slot, score) => run('INSERT INTO activity (team_id, station, slot, score, raw, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', team, station, slot, score, '{"demo":true}', now, now);
    for (const t of teams) {
      for (const slot of [1, 2]) {
        yard(t.id, 'pin', slot, pick([2, 3, 3, 4, 5]));
        yard(t.id, 'satu', slot, pick([2, 2.5, 3, 3.5, 4.5]));
        yard(t.id, 'accuracy', slot, pick([1.5, 2.5, 3.5, 5]));
        yard(t.id, 'red_bull', slot, pick([0, 1, 1]));
      }
      if (Math.random() < 0.4) yard(t.id, 'on', 0, pick([2.5, 3, 3.5, 4]));
      run('INSERT INTO bonus (team_id, points, at) VALUES (?, ?, ?)', t.id, 5, now);
    }

    const showdowns = all("SELECT * FROM showdowns WHERE stage = 'group' ORDER BY round, slot");
    showdowns.forEach((sd) => {
      const hour = 8 + sd.round;
      const time = `${String(hour).padStart(2, '0')}:${sd.slot < 3 ? '00' : '30'}`;
      run('UPDATE showdowns SET start_time = ?, court = ? WHERE id = ?', time, courts[sd.slot % courts.length], sd.id);
    });

    const lineup = (matchId, teamId) => {
      const players = all('SELECT * FROM players WHERE team_id = ? AND active = 1 AND is_gold = 0', teamId);
      const [a, b] = randomPair(players);
      run('INSERT OR REPLACE INTO lineups (match_id, team_id, p1, p2, submitted_at) VALUES (?, ?, ?, ?, ?)', matchId, teamId, a.id, b.id, now);
    };

    let liveCourt = 0;
    for (const sd of showdowns) {
      const matches = all('SELECT * FROM matches WHERE showdown_id = ? ORDER BY id', sd.id);
      const finished = sd.round < 3 || (sd.round === 3 && sd.slot < 2);
      const live = sd.round === 3 && sd.slot === 2;
      const half = sd.round === 3 && sd.slot === 3;
      matches.forEach((m, i) => {
        if (finished || live) { lineup(m.id, sd.team_a); lineup(m.id, sd.team_b); }
        if (half) lineup(m.id, sd.team_a);
        if (finished) {
          const a = pick([0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
          run("UPDATE matches SET status = 'done', score_a = ?, score_b = ?, finished_at = ? WHERE id = ?", a, 5 - a, now - (6 - sd.round) * 600000 - sd.slot * 60000 - i * 1000, m.id);
        }
        if (live) {
          const court = courts[liveCourt++ % courts.length];
          const a = pick([0, 1, 2]);
          const b = pick([0, 1, 2]);
          run("UPDATE matches SET status = 'live', court = ?, score_a = ?, score_b = ?, started_at = ? WHERE id = ?", court, a, b, now, m.id);
        }
      });
    }
    const first = get("SELECT m.id, s.team_a FROM matches m JOIN showdowns s ON s.id = m.showdown_id WHERE m.status = 'done' ORDER BY m.id LIMIT 1");
    if (first) run("INSERT INTO tickets (team_id, match_id, type, created_at) VALUES (?, ?, 'golden_point', ?)", first.team_a, first.id, now);
  });
}
