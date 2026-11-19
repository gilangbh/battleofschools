import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateFinalScore, validateRunningScore, validateLineup, showdownSummary, computeStandings, generateGroupRounds,
} from '../src/rules.js';

const P = (id, level = 'bronze', gender = null, extra = {}) => ({ id, name: `P${id}`, level, gender, is_gold: 0, ...extra });

test('group scores must add up to five games', () => {
  assert.equal(validateFinalScore('group', 3, 2), null);
  assert.equal(validateFinalScore('group', 5, 0), null);
  assert.ok(validateFinalScore('group', 3, 3));
  assert.ok(validateFinalScore('group', 4, 0));
  assert.ok(validateFinalScore('group', null, 2));
  assert.ok(validateFinalScore('group', 2.5, 2.5));
});

test('knockout is a race to six with a tiebreak at 5-5', () => {
  assert.equal(validateFinalScore('semi', 6, 4), null);
  assert.equal(validateFinalScore('final', 0, 6), null);
  assert.equal(validateFinalScore('semi', 6, 5), null);
  assert.equal(validateFinalScore('semi', 6, 5, 7, 6), null);
  assert.ok(validateFinalScore('semi', 6, 6));
  assert.ok(validateFinalScore('semi', 5, 4));
  assert.ok(validateFinalScore('semi', 7, 5));
  assert.ok(validateFinalScore('semi', 6, 3, 7, 2), 'tiebreak only at 5-5');
  assert.ok(validateFinalScore('semi', 6, 5, 5, 7), 'tiebreak winner must have six games');
  assert.ok(validateFinalScore('semi', 6, 5, 8, 6), 'tiebreak is first to seven');
});

test('running scores stay within the format', () => {
  assert.equal(validateRunningScore('group', 2, 1), null);
  assert.ok(validateRunningScore('group', 4, 2));
  assert.equal(validateRunningScore('semi', 5, 5), null);
  assert.ok(validateRunningScore('semi', 6, 6));
});

test('two Silver players cannot pair', () => {
  const players = [P(1, 'silver'), P(2, 'silver'), P(3)];
  assert.equal(validateLineup({ stage: 'group', category: 'open', players, p1: 1, p2: 2 }).length, 1);
  assert.equal(validateLineup({ stage: 'final', category: 'open', players, p1: 1, p2: 2 }).length, 1);
  assert.equal(validateLineup({ stage: 'group', category: 'open', players, p1: 1, p2: 3 }).length, 0);
});

test('pairs need two different players from the roster', () => {
  const players = [P(1), P(2)];
  assert.ok(validateLineup({ stage: 'group', category: 'open', players, p1: 1, p2: 1 }).length);
  assert.ok(validateLineup({ stage: 'group', category: 'open', players, p1: 1, p2: 99 }).length);
});

test('gender is checked for men’s and women’s doubles only when known', () => {
  const players = [P(1, 'bronze', 'M'), P(2, 'bronze', 'F'), P(3)];
  assert.ok(validateLineup({ stage: 'group', category: 'men', players, p1: 1, p2: 2 }).length);
  assert.ok(validateLineup({ stage: 'group', category: 'women', players, p1: 1, p2: 2 }).length);
  assert.equal(validateLineup({ stage: 'group', category: 'open', players, p1: 1, p2: 2 }).length, 0);
  assert.equal(validateLineup({ stage: 'group', category: 'men', players, p1: 1, p2: 3 }).length, 0);
});

test('knockout: one category match per player per round', () => {
  const players = [P(1), P(2), P(3)];
  const otherLineups = [{ category: 'men', p1: 1, p2: 3 }];
  assert.ok(validateLineup({ stage: 'semi', category: 'open', players, p1: 1, p2: 2, otherLineups }).length);
  assert.equal(validateLineup({ stage: 'group', category: 'open', players, p1: 1, p2: 2, otherLineups }).length, 0);
});

test('Gold Player ticket: group stage only, limit of two tickets, same gender', () => {
  const gold = P(9, 'bronze', 'M', { is_gold: 1 });
  const players = [P(1, 'bronze', 'M'), P(2, 'bronze', 'F'), gold];
  const base = { category: 'open', players, p1: 1, p2: 2 };
  assert.equal(validateLineup({ ...base, stage: 'group', goldOut: 1 }).length, 0);
  assert.ok(validateLineup({ ...base, stage: 'group', goldOut: 2 }).length, 'different gender');
  assert.ok(validateLineup({ ...base, stage: 'group', goldOut: 1, ticketsUsedElsewhere: 2 }).length);
  assert.ok(validateLineup({ ...base, stage: 'semi', goldOut: 1 }).length);
  assert.ok(validateLineup({ ...base, stage: 'group', p1: 9, p2: 2 }).length, 'gold cannot be picked as a regular');
});

test('knockout showdown goes to the school that wins two categories', () => {
  const m = (a, b, status = 'done') => ({ status, score_a: a, score_b: b });
  assert.equal(showdownSummary('semi', [m(6, 2), m(4, 6), m(6, 5)]).winner, 'a');
  assert.equal(showdownSummary('semi', [m(6, 2), m(4, 6), m(null, null, 'live')]).winner, null);
  const g = showdownSummary('group', [m(3, 2), m(1, 4), m(5, 0)]);
  assert.deepEqual([g.gamesA, g.gamesB, g.complete, g.winner], [9, 6, true, null]);
});

test('standings add games won and challenge points, per group', () => {
  const teams = [{ id: 'a1', name: 'A1', grp: 'A' }, { id: 'a2', name: 'A2', grp: 'A' }, { id: 'b1', name: 'B1', grp: 'B' }];
  const done = (a, b) => ({ status: 'done', score_a: a, score_b: b });
  const showdowns = [
    { stage: 'group', team_a: 'a1', team_b: 'b1', matches: [done(3, 2), done(4, 1), { status: 'live', score_a: 2, score_b: 0 }] },
    { stage: 'group', team_a: 'a2', team_b: 'b1', matches: [done(5, 0)] },
    { stage: 'semi', team_a: 'a1', team_b: 'a2', matches: [done(6, 0)] },
  ];
  const s = computeStandings(teams, showdowns, new Map([['a2', 2.5]]));
  assert.deepEqual(s.A.map((r) => [r.team.id, r.games, r.total, r.rank]), [['a2', 5, 7.5, 1], ['a1', 7, 7, 2]]);
  assert.equal(s.B[0].games, 3);
  assert.equal(s.B[0].lost, 3);
});

test('every school meets every school in the other group exactly once', () => {
  const A = ['a1', 'a2', 'a3', 'a4', 'a5'];
  const B = ['b1', 'b2', 'b3', 'b4', 'b5'];
  const rounds = generateGroupRounds(A, B);
  assert.equal(rounds.length, 5);
  const seen = new Set();
  for (const pairs of rounds) {
    assert.equal(new Set(pairs.flat()).size, 10, 'each school plays once per round');
    for (const [x, y] of pairs) seen.add(`${x}-${y}`);
  }
  assert.equal(seen.size, 25);
});
