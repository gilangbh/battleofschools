import test from 'node:test';
import assert from 'node:assert/strict';
import { schedule, validateScore, leaderboard } from '../src/americano.js';

const pairKey = (p) => [...p].sort((x, y) => x - y).join('-');

test('five players: five rounds, four matches and one bye each, every pair partners exactly once', () => {
  const ids = [11, 12, 13, 14, 15];
  const rounds = schedule(ids);
  assert.equal(rounds.length, 5);
  const partners = new Map(); const played = new Map(ids.map((i) => [i, 0])); const byes = new Map(ids.map((i) => [i, 0]));
  for (const r of rounds) {
    assert.equal(new Set([...r.a, ...r.b, r.bye]).size, 5, 'all five are placed once in each round');
    byes.set(r.bye, byes.get(r.bye) + 1);
    for (const pair of [r.a, r.b]) { partners.set(pairKey(pair), (partners.get(pairKey(pair)) || 0) + 1); for (const id of pair) played.set(id, played.get(id) + 1); }
  }
  assert.deepEqual([...played.values()], [4, 4, 4, 4, 4]);
  assert.deepEqual([...byes.values()], [1, 1, 1, 1, 1]);
  assert.equal(partners.size, 10);
  assert.ok([...partners.values()].every((n) => n === 1));
  // Balanced opposition too: everyone faces each other player the same number of times.
  const faced = new Map();
  for (const r of rounds) for (const x of r.a) for (const y of r.b) faced.set(pairKey([x, y]), (faced.get(pairKey([x, y])) || 0) + 1);
  assert.equal(faced.size, 10);
  assert.ok([...faced.values()].every((n) => n === 2));
});

test('four players: three rounds, each partners the other three once; other sizes have no schedule', () => {
  const rounds = schedule([1, 2, 3, 4]);
  assert.equal(rounds.length, 3);
  assert.equal(new Set(rounds.flatMap((r) => [pairKey(r.a), pairKey(r.b)])).size, 6);
  assert.ok(rounds.every((r) => r.bye === null));
  assert.equal(schedule([1, 2, 3]), null);
  assert.equal(schedule([1, 2, 3, 4, 5, 6]), null);
});

test('any whole-number score is accepted, draws included, with no fixed total', () => {
  assert.equal(validateScore(10, 6), null);
  assert.equal(validateScore(8, 8), null);
  assert.equal(validateScore(17, 0), null);
  assert.equal(validateScore(9, 6), null);
  assert.equal(validateScore(11, 6), null);
  assert.ok(validateScore(150, 3), 'a typing mistake is refused');
  assert.ok(validateScore(8.5, 7.5));
  assert.ok(validateScore(-1, 17));
});

test('the table adds each player\'s rally points and names an outright winner and runner-up', () => {
  const players = [1, 2, 3, 4, 5].map((id, i) => ({ id, name: `P${id}`, sort: i }));
  const rounds = schedule(players.map((p) => p.id));
  const scores = [[10, 6], [9, 7], [12, 4], [8, 8], [11, 5]];
  const matches = rounds.map((r, i) => ({ round: r.round, a1: r.a[0], a2: r.a[1], b1: r.b[0], b2: r.b[1], bye: r.bye, score_a: scores[i][0], score_b: scores[i][1], status: 'done' }));
  const t = leaderboard(players, matches);
  assert.equal(t.finished, true);
  assert.equal(t.rows.reduce((n, r) => n + r.points, 0), scores.reduce((n, [x, y]) => n + 2 * (x + y), 0), 'every rally point is credited to two players');
  assert.ok(t.rows.every((r) => r.played === 4 && r.byes === 1));
  for (const r of t.rows) assert.equal(r.won + r.drawn + r.lost, 4);
  const sorted = [...t.rows].map((r) => r.points);
  assert.deepEqual(sorted, [...sorted].sort((x, y) => y - x));
  assert.equal(t.needsPlayoff, !(t.winner && t.runnerUp));
});

test('a tie for a prize place is not broken: it needs the playoff', () => {
  const players = [1, 2, 3, 4].map((id, i) => ({ id, name: `P${id}`, sort: i }));
  const all88 = schedule([1, 2, 3, 4]).map((r) => ({ a1: r.a[0], a2: r.a[1], b1: r.b[0], b2: r.b[1], bye: null, score_a: 8, score_b: 8, status: 'done' }));
  const t = leaderboard(players, all88);
  assert.deepEqual(t.rows.map((r) => r.rank), [1, 1, 1, 1]);
  assert.equal(t.needsPlayoff, true);
  assert.equal(t.winner, null);
  const unfinished = leaderboard(players, [{ ...all88[0], status: 'scheduled', score_a: null, score_b: null }]);
  assert.deepEqual([unfinished.finished, unfinished.needsPlayoff], [false, false]);
});
