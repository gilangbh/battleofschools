import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateFinalScore, validateRunningScore, validateLineup, showdownSummary, computeStandings, generateGroupRounds, ticketBalance, goldReplaceError,
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

test('men’s and women’s doubles need a known, matching gender', () => {
  const players = [P(1, 'bronze', 'M'), P(2, 'bronze', 'F'), P(3)];
  assert.ok(validateLineup({ stage: 'group', category: 'men', players, p1: 1, p2: 2 }).length);
  assert.ok(validateLineup({ stage: 'group', category: 'women', players, p1: 1, p2: 2 }).length);
  assert.equal(validateLineup({ stage: 'group', category: 'open', players, p1: 1, p2: 2 }).length, 0);
  assert.ok(validateLineup({ stage: 'group', category: 'men', players, p1: 1, p2: 3 }).length, 'unknown gender cannot be checked');
  assert.equal(validateLineup({ stage: 'group', category: 'open', players, p1: 1, p2: 3 }).length, 0);
});

test('knockout: one category match per player per round', () => {
  const players = [P(1), P(2), P(3)];
  const otherLineups = [{ category: 'men', p1: 1, p2: 3 }];
  assert.ok(validateLineup({ stage: 'semi', category: 'open', players, p1: 1, p2: 2, otherLineups }).length);
  assert.equal(validateLineup({ stage: 'group', category: 'open', players, p1: 1, p2: 2, otherLineups }).length, 0);
});

test('Gold Player: group stage only, three deployments, same gender, not with a Golden Point', () => {
  const gold = P(9, 'bronze', 'M', { is_gold: 1 });
  const players = [P(1, 'bronze', 'M'), P(2, 'bronze', 'F'), gold];
  const base = { category: 'open', players, p1: 1, p2: 2 };
  assert.equal(validateLineup({ ...base, stage: 'group', goldOut: 1 }).length, 0);
  assert.ok(validateLineup({ ...base, stage: 'group', goldOut: 2 }).length, 'different gender');
  assert.equal(validateLineup({ ...base, stage: 'group', goldOut: 1, goldUsedElsewhere: 2 }).length, 0);
  assert.ok(validateLineup({ ...base, stage: 'group', goldOut: 1, goldUsedElsewhere: 3 }).length);
  assert.ok(validateLineup({ ...base, stage: 'group', goldOut: 1, goldenPointHere: true }).length);
  const noGender = [P(1), P(2, 'bronze', 'F'), gold];
  assert.ok(validateLineup({ ...base, players: noGender, stage: 'group', goldOut: 1 }).length, 'missing gender cannot be checked');
  assert.ok(validateLineup({ ...base, stage: 'semi', goldOut: 1 }).length);
  assert.ok(validateLineup({ ...base, stage: 'group', p1: 9, p2: 2 }).length, 'gold cannot be picked as a regular');
});

test('a semifinal or final goes to the first school with two categories, never to total games', () => {
  const m = (a, b, status = 'done') => ({ status, score_a: a, score_b: b });
  const semi = showdownSummary('semi', [m(6, 5), m(0, 6), m(6, 5)]);
  assert.deepEqual([semi.winner, semi.catsA, semi.catsB, semi.gamesA, semi.gamesB, semi.complete], ['a', 2, 1, 12, 16, true]);
  const level = showdownSummary('semi', [m(6, 2), m(4, 6), m(null, null, 'live')]);
  assert.deepEqual([level.winner, level.complete], [null, false], 'at 1-1 the third category is required');
  const early = showdownSummary('final', [m(6, 2), m(6, 4), m(null, null, 'scheduled')]);
  assert.deepEqual([early.winner, early.complete], ['a', true], 'at 2-0 the third category is optional');
  const g = showdownSummary('group', [m(3, 2), m(1, 4), m(5, 0)]);
  assert.deepEqual([g.gamesA, g.gamesB, g.complete, g.winner], [9, 6, true, null]);
});

test('standings add games won, School Yard points and the bonus, per group', () => {
  const teams = [{ id: 'a1', name: 'A1', grp: 'A' }, { id: 'a2', name: 'A2', grp: 'A' }, { id: 'b1', name: 'B1', grp: 'B' }];
  const done = (a, b) => ({ status: 'done', score_a: a, score_b: b });
  const showdowns = [
    { stage: 'group', team_a: 'a1', team_b: 'b1', matches: [done(3, 2), done(4, 1), { status: 'live', score_a: 2, score_b: 0 }] },
    { stage: 'group', team_a: 'a2', team_b: 'b1', matches: [done(5, 0)] },
    { stage: 'semi', team_a: 'a1', team_b: 'a2', matches: [done(6, 0)] },
  ];
  const s = computeStandings(teams, showdowns, new Map([['a2', { yard: 2.0625, bonus: 0.5 }]]));
  assert.deepEqual(s.A.map((r) => [r.team.id, r.games, r.total, r.rank]), [['a2', 5, 7.5625, 1], ['a1', 7, 7, 2]]);
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

test('ticket balances are separate: three Gold Player deployments and two Golden Points', () => {
  const bal = ticketBalance([{ type: 'gold_player' }, { type: 'golden_point' }, { type: 'golden_point' }]);
  assert.deepEqual([bal.goldLeft, bal.pointLeft], [2, 0]);
});

test('schools level on total share a rank and a tie across the top-two cut is held', () => {
  const teams = ['a1', 'a2', 'a3', 'b1'].map((id) => ({ id, name: id.toUpperCase(), grp: id[0].toUpperCase() }));
  const done = (a, b) => ({ status: 'done', score_a: a, score_b: b });
  const mk = (list) => list.map(([x, s]) => ({ stage: 'group', team_a: x, team_b: 'b1', matches: [done(s, 5 - s)] }));
  const tied = computeStandings(teams, mk([['a1', 4], ['a2', 3], ['a3', 3]]), new Map());
  assert.deepEqual(tied.A.map((r) => [r.team.id, r.rank, r.place]), [['a1', 1, 'qualified'], ['a2', 2, 'tied'], ['a3', 2, 'tied']]);
  const clear = computeStandings(teams, mk([['a1', 4], ['a2', 3], ['a3', 1]]), new Map());
  assert.deepEqual(clear.A.map((r) => r.place), ['qualified', 'qualified', null]);
  const running = computeStandings(teams, [...mk([['a1', 4], ['a2', 3], ['a3', 1]]), { stage: 'group', team_a: 'a1', team_b: 'b1', matches: [{ status: 'scheduled' }] }], new Map());
  assert.deepEqual(running.A.map((r) => r.place), ['provisional', 'provisional', null]);
  // Matches finished but one school's activity results are still missing: nobody in that group is confirmed.
  const waiting = computeStandings(teams, mk([['a1', 4], ['a2', 3], ['a3', 1]]), new Map([['a3', { yard: 1, bonus: 0, pending: true }]]));
  assert.deepEqual(waiting.A.map((r) => r.place), ['provisional', 'provisional', null]);
});

// The organizer's thirteen Gold substitution acceptance cases (rules of 23 November 2026).
test('Gold Player replaces only a highest-rated player of the pair, of the same gender', () => {
  const G = (gender) => P(9, 'bronze', gender, { is_gold: 1 });
  const ok = (gold, a, b, out) => goldReplaceError(gold, a, b, out) === null;
  // 1. Higher-rated same gender: Bronze M + Silver M, Gold M
  let a = P(1, 'bronze', 'M'); let b = P(2, 'silver', 'M');
  assert.ok(ok(G('M'), a, b, b));
  assert.ok(!ok(G('M'), a, b, a), 'replacing the Bronze to leave Gold with Silver is invalid');
  // 2 and 3. Open: Bronze M + Silver F
  b = P(2, 'silver', 'F');
  assert.ok(!ok(G('M'), a, b, a), 'matching the lower-rated player\'s gender does not get round the higher rating');
  assert.ok(!ok(G('M'), a, b, b));
  assert.ok(ok(G('F'), a, b, b));
  assert.ok(!ok(G('F'), a, b, a));
  // 4. Equal ratings, mixed genders
  b = P(2, 'bronze', 'F');
  assert.ok(ok(G('M'), a, b, a));
  assert.ok(!ok(G('M'), a, b, b));
  // 5 and 6. Equal ratings, same gender
  a = P(1, 'bronze', 'F');
  assert.ok(ok(G('F'), a, b, a) && ok(G('F'), a, b, b));
  assert.ok(!ok(G('M'), a, b, a) && !ok(G('M'), a, b, b));
  // 7. Lower Bronze does not tie with Bronze
  a = P(1, 'lower_bronze', 'F');
  assert.ok(ok(G('F'), a, b, b));
  assert.ok(!ok(G('F'), a, b, a));
  // 8. Low Silver is stored as Silver
  b = P(2, 'silver', 'F'); a = P(1, 'bronze', 'F');
  assert.ok(ok(G('F'), a, b, b) && !ok(G('F'), a, b, a));
  // 9. Approved category is what counts (the stored level is the approved one)
  // 10. A category still under review cannot be assumed
  assert.ok(!ok(G('F'), a, P(2, 'bronze', 'F', { level_pending: 1 }), a));
  assert.ok(!ok(G('F'), P(1, 'bronze', 'F', { level_pending: 1 }), b, b), 'even when the proposed player is the approved one');
  // 11. Missing gender on the highest-rated player or on the Gold Player
  assert.ok(!ok(G('F'), a, P(2, 'silver', null), P(2, 'silver', null)));
  assert.ok(!ok(G(null), a, b, b));
  // 12. No approved Gold Player (a nominee stays inactive, so the school has none)
  assert.ok(!ok(null, a, b, b));
  // 13. Stage: no tickets in semifinals or final
  const players = [a, b, G('F')];
  assert.equal(validateLineup({ stage: 'group', category: 'women', players, p1: 1, p2: 2, goldOut: 2 }).length, 0);
  assert.ok(validateLineup({ stage: 'group', category: 'women', players, p1: 1, p2: 2, goldOut: 1 }).length, 'a direct request naming the lower-rated player is refused');
  assert.ok(validateLineup({ stage: 'semi', category: 'women', players, p1: 1, p2: 2, goldOut: 2 }).length);
  assert.ok(validateLineup({ stage: 'final', category: 'women', players, p1: 1, p2: 2, goldOut: 2 }).length);
});
