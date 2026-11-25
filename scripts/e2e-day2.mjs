// End-to-end checks for booth conflicts, review holds, the social bonus, the School Yard Champion ledger and the
// Gold Americano. Run only against a throwaway local server: it wipes results.
// Usage: node scripts/e2e-day2.mjs http://localhost:3111 <path to that server's bos.db>
// Needs the local test sessions testadmin / testdesk / testcap in that database.
import { DatabaseSync } from 'node:sqlite';

const base = process.argv[2];
const db = new DatabaseSync(process.argv[3]);
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(base || '')) throw new Error('Local servers only.');
const origin = new URL(base).origin;
let pass = 0; let fail = 0;
const ok = (c, l) => { if (c) pass++; else { fail++; console.log('FAIL', l); } };
const post = (url, body, cookie = 'testdesk') => fetch(base + url, { method: 'POST', redirect: 'manual', headers: { Cookie: `bos_sid=${cookie}`, Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
const loc = (res) => decodeURIComponent(res.headers.get('location') || '');
const pageOf = async (url) => (await fetch(base + url, { headers: { Cookie: 'bos_sid=testdesk' } })).text();

await post('/admin/reset', { confirm: 'RESET', lineups: 'on', yard: 'on' }, 'testadmin');
db.exec('DELETE FROM award; DELETE FROM award_log; DELETE FROM am_matches; DELETE FROM am_players;');
const team = db.prepare('SELECT id FROM teams ORDER BY sort LIMIT 1').get().id;
const other = db.prepare('SELECT id FROM teams ORDER BY sort LIMIT 1 OFFSET 1').get().id;
const player = db.prepare('SELECT id FROM players WHERE team_id = ? AND active = 1 AND is_gold = 0 LIMIT 1').get(team).id;
const row = (st, slot) => db.prepare('SELECT * FROM activity WHERE team_id = ? AND station = ? AND slot = ?').get(team, st, slot);

// --- Two booths on the same school ---
// Both booths open the page while Pin showdown 1 is empty (version 0).
let res = await post(`/desk/activity/${team}`, { v_pin_1: '0', a_pin_1_score: '4', a_pin_1_player: String(player), a_pin_1_ref: 'P-01' });
ok(res.status === 303, 'booth A records Pin showdown 1');
ok(JSON.parse(row('pin', 1).raw).ref === 'P-01', 'the booth sheet number is stored with the result');
res = await post(`/desk/activity/${team}`, { v_pin_1: '0', a_pin_1_score: '2', a_pin_1_player: String(player) });
ok(res.status === 422 && row('pin', 1).score === 4, 'booth B, still on the old page, cannot overwrite it');
ok((await res.text()).includes('saved from another device'), 'booth B is told why');
res = await post(`/desk/activity/${team}`, { v_pin_1: '0', v_on_0: '0', a_on_0_lengths: '6', a_on_0_runners: 'Runner' });
ok(res.status === 303 && row('pin', 1).score === 4 && row('on', 0).score === 3, 'a stale page can still add a different result without disturbing the first');
const logs = () => db.prepare('SELECT COUNT(*) n FROM activity_log WHERE team_id = ?').get(team).n;
const before = logs();
res = await post(`/desk/activity/${team}`, { v_on_0: '0', a_on_0_lengths: '6', a_on_0_runners: 'Runner' });
ok(/Nothing had changed/.test(loc(res)) && logs() === before, 'a retried save is not a second attempt and adds no history line');
res = await post(`/desk/activity/${team}`, { v_pin_1: String(row('pin', 1).updated_at), a_pin_1_score: '3', a_pin_1_player: String(player), a_pin_1_ref: 'P-01' });
const pinLog = db.prepare("SELECT action, score FROM activity_log WHERE team_id = ? AND station = 'pin' ORDER BY id").all(team);
ok(res.status === 303 && row('pin', 1).score === 3 && pinLog[0].score === 4 && pinLog[1].action === 'corrected', 'a deliberate correction is saved and the first entry stays in the history');
res = await post(`/desk/activity/${team}`, { v_pin_1: '0', del_pin_1: 'on' });
ok(res.status === 422 && Boolean(row('pin', 1)), 'a stale page cannot remove a result');
// Truly simultaneous saves of the same empty slot: exactly one wins.
const both = await Promise.all([1, 2].map((n) => post(`/desk/activity/${team}`, { v_satu_1: '0', a_satu_1_hop: String(n), a_satu_1_bowl: '10', a_satu_1_hopper: `H${n}`, a_satu_1_scooper: `S${n}` })));
ok(both.filter((r) => r.status === 303).length === 1 && both.filter((r) => r.status === 422).length === 1, 'two saves of the same slot at the same moment: one is kept, the other is refused');

// --- Held for committee review ---
res = await post(`/desk/activity/${team}`, { v_red_bull_1: '0', a_red_bull_1_result: 'done', a_red_bull_1_player: String(player), hold_red_bull_1: 'on' });
ok(res.status === 303 && row('red_bull', 1).held === 1, 'a late attempt can be recorded and held');
let page = await pageOf(`/desk/activity?team=${team}`);
ok(page.includes('3 of 21 results in') && page.includes('1 held for review'), 'a held result is on record but not counted');
res = await post(`/desk/activity/${team}`, { v_red_bull_1: String(row('red_bull', 1).updated_at), a_red_bull_1_result: 'done', a_red_bull_1_player: String(player) });
ok(row('red_bull', 1).held === 0 && db.prepare("SELECT action FROM activity_log WHERE station = 'red_bull' ORDER BY id DESC").get().action === 'released', 'releasing it counts it and is in the history');

// --- Starting points from the pre-event social challenge ---
res = await post('/admin/bonus', { [`b_${team}`]: '3.5', [`b_${other}`]: '0' }, 'testadmin');
ok(res.status === 303 && db.prepare('SELECT points FROM bonus WHERE team_id = ?').get(team).points === 3.5 && db.prepare('SELECT points FROM bonus WHERE team_id = ?').get(other).points === 0, 'an admin sets starting points per school, including an explicit zero');
res = await post('/admin/bonus', { [`b_${team}`]: '5.5' }, 'testadmin');
ok(/err=/.test(loc(res)) && db.prepare('SELECT points FROM bonus WHERE team_id = ?').get(team).points === 3.5, 'more than 5 is refused');
res = await post('/admin/bonus', { [`b_${team}`]: '2.3' }, 'testadmin');
ok(/err=/.test(loc(res)), 'only half-point steps are accepted');
res = await post('/admin/bonus', { [`b_${team}`]: '4' }, 'testdesk');
ok(res.status === 403, 'the desk cannot change starting points');
ok((await pageOf('/partial/public')).includes('3.5'), 'the starting points show in the standings');

// --- School Yard Champion ledger ---
res = await post(`/desk/award/${team}`, { p_0: 'Ani Wijaya', id_0: '', k_0: 'spectator', r_0_pin: '3', r_0_accuracy: '70', ref_0: 'A4-1 row 1', p_1: 'Gold Person', k_1: 'gold', r_1_accuracy: '90' });
ok(res.status === 303 && db.prepare('SELECT COUNT(*) n FROM award').get().n === 3, 'three raw records saved');
ok(db.prepare('SELECT COUNT(*) n FROM award WHERE credit IS NOT NULL').get().n === 0, 'credit stays empty, which means pending');
ok(db.prepare("SELECT kind FROM award WHERE person = 'Gold Person'").get().kind === 'gold', 'a Gold Player keeps their true classification in the award ledger');
res = await post(`/desk/award/${other}`, { p_0: 'ani  wijaya', k_0: 'spectator', r_0_pin: '5' });
ok(res.status === 422 && db.prepare('SELECT COUNT(*) n FROM award').get().n === 3, 'the same person cannot get a second Pin record, even under another school');
res = await post(`/desk/award/${other}`, { p_0: 'Ani Wijaya', k_0: 'spectator', r_0_satu: '2.5 + 20' });
ok(res.status === 303, 'the same person may still be recorded at a station they have not done');
res = await post(`/desk/award/${team}`, { p_0: 'Budi', k_0: 'spectator', r_0_on: '7' }, 'testcap');
ok(res.status === 403, 'a captain cannot write to the ledger');
page = await pageOf(`/desk/award?team=${team}`);
ok(page.includes('>Pending<'), 'the page shows the credit as pending');
const pub = await pageOf('/partial/public');
ok(!pub.includes('Ani Wijaya') && !pub.includes('Gold Person'), 'ledger names never reach the public page');
ok(db.prepare('SELECT COUNT(*) n FROM activity WHERE team_id = ?').get(team).n === 4, 'the award ledger adds nothing to the official results');

// --- Gold Americano ---
const rosterBefore = db.prepare('SELECT COUNT(*) n FROM players').get().n;
const goldActive = db.prepare('SELECT COUNT(*) n FROM players WHERE is_gold = 1 AND active = 1').get().n;
for (const [name, label] of [['Player One', 'ACS'], ['Player Two', 'BSJ'], ['Player Three', 'JIS'], ['Player Four', 'Free agent']]) await post('/admin/americano/players', { name_new: name, label_new: label }, 'testadmin');
res = await post('/admin/americano/generate', {}, 'testadmin');
ok(/err=/.test(loc(res)) && db.prepare('SELECT COUNT(*) n FROM am_matches').get().n === 0, 'four players get no rounds unless the draft format is confirmed');
await post('/admin/americano/players', { name_new: 'Player Five', label_new: 'TBC' }, 'testadmin');
res = await post('/admin/americano/generate', {}, 'testdesk');
ok(res.status === 403, 'only an admin can create the rounds');
await post('/admin/americano/generate', {}, 'testadmin');
const ms = db.prepare('SELECT * FROM am_matches ORDER BY round').all();
ok(ms.length === 5 && new Set(ms.map((m) => m.bye)).size === 5, 'five players get five rounds with a different player sitting out each time');
res = await post('/desk/americano/scores', { [`a_${ms[0].id}`]: '10', [`b_${ms[0].id}`]: '150' });
ok(/err=/.test(loc(res)) && db.prepare('SELECT status FROM am_matches WHERE id = ?').get(ms[0].id).status === 'scheduled', 'a typing-mistake score is refused');
const scores = [[10, 6], [8, 8], [17, 4], [9, 7], [11, 13]];
res = await post('/desk/americano/scores', Object.fromEntries(ms.flatMap((m, i) => [[`a_${m.id}`, scores[i][0]], [`b_${m.id}`, scores[i][1]]])));
ok(res.status === 303 && db.prepare("SELECT COUNT(*) n FROM am_matches WHERE status = 'done'").get().n === 5, 'all five matches saved, including an 8–8 draw');
const tvp = await pageOf('/partial/tv-americano');
ok(tvp.includes('Player One') && tvp.includes('Round 5'), 'the TV screen shows the table and the rounds');
ok(db.prepare("SELECT COUNT(*) n FROM matches WHERE status != 'scheduled'").get().n === 0 && db.prepare('SELECT COUNT(*) n FROM tickets').get().n === 0 && db.prepare('SELECT COUNT(*) n FROM lineups').get().n === 0, 'the Americano touches no school match, ticket or lineup');
ok(db.prepare('SELECT COUNT(*) n FROM players').get().n === rosterBefore && db.prepare('SELECT COUNT(*) n FROM players WHERE is_gold = 1 AND active = 1').get().n === goldActive, 'Americano players are not added to a school roster and no Gold Player is activated');
const st = await pageOf('/partial/public');
ok(!st.includes('Player One'), 'the Americano does not appear in the school standings page');
ok((await fetch(`${base}/tv/americano`, { redirect: 'manual' })).status === 302 && (await fetch(`${base}/desk/award`, { redirect: 'manual' })).status === 302, 'the new pages are private when signed out');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
