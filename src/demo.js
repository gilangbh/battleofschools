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
    run('DELETE FROM challenge');
    if (get('SELECT COUNT(*) AS n FROM stations').n === 0) {
      ['Target Shooting', 'Smash Challenge'].forEach((name, i) => run('INSERT INTO stations (name, sort) VALUES (?, ?)', name, i));
    }
    const stations = all('SELECT id FROM stations');
    for (const t of teams) for (const st of stations) {
      run('INSERT INTO challenge (team_id, station_id, points) VALUES (?, ?, ?)', t.id, st.id, Math.round((6 + Math.random() * 5) * 10) / 10);
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
