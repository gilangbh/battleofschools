import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { STATIONS, RESULTS_NEEDED, readAttempt, isBlank, summarize, fmtPoints, fieldsFromRaw } from '../src/activity.js';

const ctx = { playerIds: new Set([7]) };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} should equal ${b}`);
const rows = (station, scores) => scores.map((score, i) => ({ station, slot: station === 'on' ? 0 : i + 1, score }));

test('there are 21 official results per school: four stations over five showdowns, plus one On run', () => {
  assert.equal(RESULTS_NEEDED, 21);
  assert.deepEqual(STATIONS.map((s) => s.id), ['pin', 'satu', 'accuracy', 'on', 'red_bull']);
});

test('Pin the Cut: a whole number of correct labels from 0 to 5, with a registered player', () => {
  assert.equal(readAttempt('pin', { score: '4', player: '7' }, ctx).score, 4);
  assert.equal(readAttempt('pin', { score: '0', player: '7' }, ctx).score, 0);
  assert.ok(readAttempt('pin', { score: '6', player: '7' }, ctx).error);
  assert.ok(readAttempt('pin', { score: '3.5', player: '7' }, ctx).error);
  assert.ok(readAttempt('pin', { score: '3', player: '' }, ctx).error, 'needs a registered player');
  assert.ok(readAttempt('pin', { score: '3', player: '99' }, ctx).error, 'the player must be on this school\'s roster');
});

test('Satu Satu: half a point per Hopscotch achievement plus bowl points over 40 times 2.5, no rounding', () => {
  const f = { hop: '4', bowl: '24', hopper: 'Ani', scooper: 'Budi' };
  near(readAttempt('satu', f, ctx).score, 3.5);
  near(readAttempt('satu', { ...f, bowl: '1' }, ctx).score, 2.0625);
  near(readAttempt('satu', { ...f, hop: '5', bowl: '400' }, ctx).score, 5);
  assert.ok(readAttempt('satu', { ...f, scooper: ' ani ' }, ctx).error, 'two different people');
  assert.ok(readAttempt('satu', { ...f, hopper: '' }, ctx).error);
  assert.ok(readAttempt('satu', f, { ...ctx, usedPeople: new Set(['budi']) }).error, 'nobody returns in either role for the same school');
});

test('Accuracy: each attempt is capped at 5 before the five are averaged', () => {
  const shots = (total) => ({ s1: String(total), s2: '0', s3: '0', s4: '0', s5: '0', player: '7' });
  const scores = [50, 70, 100, 120, 0].map((t) => readAttempt('accuracy', shots(t), ctx).score);
  assert.deepEqual(scores, [2.5, 3.5, 5, 5, 0]);
  near(summarize(rows('accuracy', scores)).stations.accuracy.points, 3.2);
  assert.ok(readAttempt('accuracy', { s1: '20', s2: '30', s3: '', s4: '0', s5: '0', player: '7' }, ctx).error, 'a missing shot is not a miss');
});

test('On Running: one result for the whole event, half a point per completed length, never averaged', () => {
  assert.equal(readAttempt('on', { lengths: '7', runners: 'Citra' }, ctx).score, 3.5);
  assert.equal(readAttempt('on', { lengths: '14', runners: 'Citra and Dewi' }, ctx).score, 5);
  near(summarize(rows('on', [3.5])).stations.on.points, 3.5);
  assert.equal(summarize(rows('on', [3.5])).stations.on.complete, true);
});

test('Flip Cup: 1 for a relay completed within 30 seconds, 0 for one that was not, summed', () => {
  assert.equal(readAttempt('red_bull', { result: 'done', seconds: '27.4', player: '7' }, ctx).score, 1);
  assert.equal(readAttempt('red_bull', { result: 'not', seconds: '', player: '7' }, ctx).score, 0);
  assert.ok(readAttempt('red_bull', { result: 'done', seconds: '31', player: '7' }, ctx).error);
  assert.ok(readAttempt('red_bull', { result: '', seconds: '', player: '7' }, ctx).error);
  near(summarize(rows('red_bull', [1, 1, 0, 1, 1])).stations.red_bull.points, 4);
});

test('the organizer\'s complete example adds up to 17.8', () => {
  const all = [
    ...rows('pin', [3, 4, 5, 2, 4]), ...rows('satu', [2.5, 3, 3.5, 4, 4.5]), ...rows('accuracy', [2.5, 3.5, 5, 5, 0]),
    ...rows('on', [3.5]), ...rows('red_bull', [1, 1, 0, 1, 1]),
  ];
  const s = summarize(all);
  assert.deepEqual([s.entered, s.complete], [21, true]);
  near(s.stations.pin.points, 3.6);
  near(s.stations.satu.points, 3.5);
  near(s.total, 17.8);
  assert.equal(fmtPoints(s.total), '17.8');
});

test('a missing result stays pending: no total, no smaller denominator, no zero', () => {
  const s = summarize(rows('pin', [3, 4, 5, 2]));
  assert.equal(s.total, null);
  assert.equal(s.stations.pin.complete, false);
  near(s.stations.pin.points, 14 / 5); // what the four recorded attempts are worth, not 14 / 4
  assert.equal(summarize([]).total, null);
  assert.equal(summarize(rows('pin', [0, 0, 0, 0, 0])).stations.pin.complete, true, 'five real zeros are a complete zero');
});

test('an empty row is skipped and a stored result round-trips through the entry fields', () => {
  assert.equal(isBlank('satu', { hop: '', bowl: ' ', hopper: '', scooper: '' }), true);
  assert.equal(isBlank('pin', { score: '0', player: '' }), false);
  const r = readAttempt('accuracy', { s1: '20', s2: '30', s3: '50', s4: '0', s5: '20', player: '7' }, ctx);
  const again = readAttempt('accuracy', Object.fromEntries(Object.entries(fieldsFromRaw('accuracy', r.raw)).map(([k, v]) => [k, String(v)])), ctx);
  assert.deepEqual(again.raw, r.raw);
});

// When the organizer's reference module is present (it lives in the private, git-ignored references folder),
// check that this app scores every station exactly as the reference does.
const refPath = path.join(process.cwd(), 'references', 'BoS_2026_Gilang_Update_20261124', 'scoring-policy', 'reference', 'activity-policy.mjs');
test('scores match the organizer\'s reference module', { skip: !fs.existsSync(refPath) && 'reference module not present' }, async () => {
  const ref = await import(pathToFileURL(refPath).href);
  for (let hop = 0; hop <= 5; hop++) for (const bowl of [0, 1, 17, 24, 40, 55]) {
    const mine = readAttempt('satu', { hop: String(hop), bowl: String(bowl), hopper: 'A', scooper: 'B' }, ctx).score;
    const theirs = ref.scoreSatuComponents({ hopscotchAchievements: [0, 1, 2, 3, 4].map((i) => i < hop), blindScoopRawPoints: bowl, hopscotchTimerLimitSeconds: 45, blindScoopTimerLimitSeconds: 20 });
    assert.equal(mine, theirs);
  }
  for (const shots of [[20, 30, 50, 0, 20], [50, 50, 50, 50, 50], [0, 0, 0, 0, 0], [10, 0, 0, 0, 5]]) {
    const f = Object.fromEntries(shots.map((v, i) => [`s${i + 1}`, String(v)]));
    assert.equal(readAttempt('accuracy', { ...f, player: '7' }, ctx).score, ref.scoreAccuracy(shots));
  }
  for (const n of [0, 1, 7, 10, 13]) assert.equal(readAttempt('on', { lengths: String(n), runners: 'A' }, ctx).score, ref.scoreOnRun({ completed20mLengths: n, timerLimitSeconds: 60 }));
  assert.equal(readAttempt('red_bull', { result: 'done', seconds: '29.9', player: '7' }, ctx).score, ref.scoreRedBullRelay({ timerLimitSeconds: 30, successfulFlips: 4, finalFlipSeconds: 29.9 }));
  assert.equal(readAttempt('red_bull', { result: 'not', seconds: '', player: '7' }, ctx).score, ref.scoreRedBullRelay({ timerLimitSeconds: 30, successfulFlips: 2, finalFlipSeconds: null, deadlineObserved: true }));

  // The same day recorded in both: station contributions and the total agree.
  let state = ref.createActivityLedger('parity');
  const spectator = (id, role) => ({ id, classification: 'spectator', classificationVerified: true, ...(role ? { role } : {}) });
  const player = (id) => ({ id, classification: 'registered_player', classificationVerified: true });
  const sel = { status: 'verified', reference: 'booth-record' };
  const mine = [];
  let n = 0;
  const put = (stationId, showdown, participants, result, score) => {
    n++;
    state = ref.recordOfficialAttempt(state, { requestId: `r${n}`, attemptId: `a${n}`, schoolId: 's', stationId, ...(showdown ? { showdown } : {}), attempted: true, officialSelection: sel, participants, result: { status: 'scored', ...result } }).state;
    mine.push({ station: stationId, slot: showdown || 0, score });
  };
  [3, 4, 5, 2, 4].forEach((v, i) => put('pin', i + 1, [player('p1'), ...[1, 2, 3, 4].map((k) => spectator(`pin${i}${k}`))], { score: v }, v));
  [[2, 24], [5, 40], [0, 0], [3, 17], [4, 55]].forEach(([hop, bowl], i) => put('satu', i + 1, [spectator(`h${i}`, 'hopscotch'), spectator(`s${i}`, 'blind_scoop')],
    { components: { hopscotchAchievements: [0, 1, 2, 3, 4].map((k) => k < hop), blindScoopRawPoints: bowl, hopscotchTimerLimitSeconds: 45, blindScoopTimerLimitSeconds: 20 } },
    readAttempt('satu', { hop: String(hop), bowl: String(bowl), hopper: 'A', scooper: 'B' }, ctx).score));
  [[20, 30, 50, 0, 20], [50, 50, 50, 50, 50], [0, 0, 0, 0, 0], [10, 0, 0, 0, 5], [30, 30, 0, 0, 0]].forEach((shots, i) => put('accuracy', i + 1, [player('p1')], { shotPoints: shots }, Math.min(shots.reduce((a, b) => a + b, 0) / 20, 5)));
  put('on', 0, [spectator('run1')], { timerLimitSeconds: 60, completed20mLengths: 7 }, 3.5);
  [1, 1, 0, 1, 1].forEach((v, i) => put('red_bull', i + 1, [player('p1'), ...[1, 2, 3].map((k) => spectator(`rb${i}${k}`))],
    v ? { timerLimitSeconds: 30, successfulFlips: 4, finalFlipSeconds: 25 } : { timerLimitSeconds: 30, successfulFlips: 3, finalFlipSeconds: null, deadlineObserved: true }, v));
  const theirs = ref.summarizeTournamentActivities(state, 's');
  const ours = summarize(mine);
  assert.equal(ours.complete, true);
  const theirTotal = typeof theirs.total === 'number' ? theirs.total : theirs.total?.score ?? theirs.score;
  near(ours.total, theirTotal);
});

test('a final total typed into the overview table: 0 to 5, with each station\'s own steps', async () => {
  const { readFinal } = await import('../src/activity.js');
  assert.deepEqual(readFinal('pin', ''), { blank: true });
  assert.equal(readFinal('pin', '3.6').score, 3.6);
  assert.equal(readFinal('satu', '3,5').score, 3.5);
  assert.equal(readFinal('accuracy', '3.2').score, 3.2);
  assert.equal(readFinal('pin', '0').score, 0, 'a real zero is not blank');
  assert.ok(readFinal('pin', '5.1').error);
  assert.ok(readFinal('pin', 'x').error);
  assert.equal(readFinal('red_bull', '4').score, 4);
  assert.ok(readFinal('red_bull', '3.5').error, 'the Flip Cup sum is whole');
  assert.equal(readFinal('on', '3.5').score, 3.5);
  assert.ok(readFinal('on', '3.3').error);
});

test('a final total stands in for the station; the rest stay pending', () => {
  const r = summarize([{ station: 'pin', slot: 1, score: 5 }], { pin: 3.6, on: 4 });
  assert.equal(r.stations.pin.points, 3.6);
  assert.equal(r.stations.pin.final, true);
  assert.equal(r.stations.on.complete, true);
  assert.equal(r.stations.satu.complete, false);
  near(r.banked, 7.6);
  assert.equal(r.entered, 6, 'a final counts all five showdowns of its station, the On result counts one');
  assert.equal(r.total, null, 'not final until every station is in');
  const all = summarize([], { pin: 3.6, satu: 3.5, accuracy: 3.2, on: 3.5, red_bull: 4 });
  assert.equal(all.complete, true);
  near(all.total, 17.8);
});
