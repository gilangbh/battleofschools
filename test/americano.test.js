import test from 'node:test';
import assert from 'node:assert/strict';
import { schedule, validateScore, leaderboard } from '../src/americano.js';

const pairKey = (p) => [...p].sort((x, y) => x - y).join('-');
const players = [1, 2, 3, 4].map((id, i) => ({ id, name: `P${id}`, sort: i }));
const played = (scores) => schedule([1, 2, 3, 4]).map((r, i) => ({ round: r.round, a1: r.a[0], a2: r.a[1], b1: r.b[0], b2: r.b[1], score_a: scores[i][0], score_b: scores[i][1], status: 'done' }));

test('four players: three rounds, every pair partners exactly once, nobody sits out', () => {
  const rounds = schedule([1, 2, 3, 4]);
  assert.equal(rounds.length, 3);
  assert.equal(new Set(rounds.flatMap((r) => [pairKey(r.a), pairKey(r.b)])).size, 6);
  for (const r of rounds) assert.equal(new Set([...r.a, ...r.b]).size, 4);
  assert.equal(schedule([1, 2, 3, 4, 5]), null);
  assert.equal(schedule([1, 2, 3]), null);
});

test('a round is first to four games, and 4–3 carries its tiebreak to five', () => {
  assert.equal(validateScore(4, 0), null);
  assert.equal(validateScore(2, 4), null);
  assert.equal(validateScore(4, 3, 5, 2), null);
  assert.equal(validateScore(3, 4, 4, 5), null, 'sudden death at 4–4');
  assert.ok(validateScore(4, 4));
  assert.ok(validateScore(5, 3));
  assert.ok(validateScore(3, 2));
  assert.ok(validateScore(4, 3), 'the tiebreak must be recorded');
  assert.ok(validateScore(4, 2, 5, 1), 'no tiebreak unless it was 3–3');
  assert.ok(validateScore(4, 3, 6, 4), 'tiebreak is to five with sudden death');
  assert.ok(validateScore(4, 3, 3, 5), 'tiebreak winner must hold four games');
  assert.ok(validateScore(null, 4));
});

test('the individual table counts games won and names an outright winner and runner-up', () => {
  const t = leaderboard(players, played([[4, 1], [4, 2], [4, 0]]));
  // P1 4+4+4=12, P2 4+2+0=6, P3 1+4+0=5, P4 1+2+4=7
  assert.deepEqual(t.rows.map((r) => [r.player.id, r.points]), [[1, 12], [4, 7], [2, 6], [3, 5]]);
  assert.deepEqual([t.winner.id, t.runnerUp.id, t.needsPlayoff, t.ties.length], [1, 4, false, 0]);
});

test('level on games is never broken by a points difference: it needs the playoff', () => {
  // P1 4+4+1=9, P2 4+2+4=10, P3 2+4+4=10, P4 2+2+1=5
  const t = leaderboard(players, played([[4, 2], [4, 2], [1, 4]]));
  assert.equal(t.needsPlayoff, true);
  assert.equal(t.winner, null);
  assert.deepEqual(t.ties.map((x) => [x.place, x.players.map((p) => p.id)]), [[1, [2, 3]]]);
  const unfinished = leaderboard(players, [{ ...played([[4, 0], [4, 0], [4, 0]])[0], status: 'scheduled' }]);
  assert.deepEqual([unfinished.finished, unfinished.needsPlayoff], [false, false]);
});
