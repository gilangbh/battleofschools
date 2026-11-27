// End-to-end checks for booth conflicts, review holds, the social bonus, the School Yard Champion ledger and the
// Gold Americano. Run only against a throwaway local server: it wipes results.
// Usage: node scripts/e2e-day2.mjs http://localhost:3111 <path to that server's bos.db>
// Needs the local test sessions testadmin / testdesk / testcap / testcapjis in that database.
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


// --- Final points typed into the overview table ---
await post('/admin/reset', { confirm: 'RESET', lineups: 'on', yard: 'on' }, 'testadmin');
const q = (body, cookie = 'testdesk') => post(`/desk/activity-quick/${team}`, { cur: team, ...body }, cookie);
const fin = (st) => db.prepare('SELECT * FROM station_final WHERE team_id = ? AND station = ?').get(team, st);
res = await q({ f_pin: '3.6', fv_pin: '0', f_red_bull: '4', fv_red_bull: '0', f_on: '3.5', fv_on: '0' });
ok(res.status === 303 && fin('pin').points === 3.6 && fin('red_bull').points === 4 && fin('on').points === 3.5, 'final points typed into the boxes are saved');
page = await pageOf(`/desk/activity?team=${team}`);
ok(page.includes('11 of 21 results in') && page.includes('<b>11.1</b>'), 'the school total counts the three finals (11.1 points, 11 of 21 results)');
res = await q({ f_satu: '6', fv_satu: '0', f_accuracy: '2', fv_accuracy: '0' });
ok(/err=/.test(loc(res)) && !fin('accuracy') && !fin('satu'), 'one bad box saves nothing from that row');
res = await q({ f_red_bull: '2.5', fv_red_bull: String(fin('red_bull').at) });
ok(/err=/.test(loc(res)) && fin('red_bull').points === 4, 'a Flip Cup sum must be whole');
res = await q({ f_pin: '2', fv_pin: '0' });
ok(/err=/.test(loc(res)) && fin('pin').points === 3.6, 'a stale box cannot overwrite another device');
res = await q({ f_pin: '2', fv_pin: String(fin('pin').at) });
ok(fin('pin').points === 2 && db.prepare("SELECT COUNT(*) n FROM activity_log WHERE station = 'pin'").get().n === 2, 'a correction is saved and logged');
res = await post(`/desk/activity/${team}`, { v_pin_1: '0', a_pin_1_score: '5', a_pin_1_player: String(player) });
page = await pageOf(`/desk/activity?team=${team}`);
ok(page.includes('<b>9.5</b>'), 'showdown results stay on record but are not added on top of a final');
res = await q({ f_pin: '', fv_pin: String(fin('pin').at) });
ok(!fin('pin'), 'emptying a box removes the final');
res = await q({ q_bonus: '4' });
ok(!db.prepare('SELECT 1 x FROM bonus WHERE team_id = ?').get(team), 'the desk cannot set starting points from the table');
res = await q({ q_bonus: '4' }, 'testadmin');
ok(db.prepare('SELECT points FROM bonus WHERE team_id = ?').get(team)?.points === 4, 'an admin can');
ok((await pageOf(`/desk/activity?team=${team}`)).includes('name="f_pin"'), 'the overview table has one box per station');
res = await q({ f_pin: '2' }, 'testcap');
ok(res.status === 403, 'a captain cannot use it');

// --- Gold exhibition: four players, three rounds ---
const rosterBefore = db.prepare('SELECT COUNT(*) n FROM players').get().n;
const goldActive = db.prepare('SELECT COUNT(*) n FROM players WHERE is_gold = 1 AND active = 1').get().n;
const addAm = (name, label) => post('/admin/americano/players', { name_new: name, label_new: label }, 'testadmin');
for (const [name, label] of [['Player One', 'ACS'], ['Player Two', 'BSJ'], ['Player Three', 'JIS'], ['Player Four', 'Free'], ['Player Five', 'TBC']]) await addAm(name, label);
res = await post('/admin/americano/generate', {}, 'testadmin');
ok(/err=/.test(loc(res)) && db.prepare('SELECT COUNT(*) n FROM am_matches').get().n === 0, 'five players get no rounds');
const idOf = (name) => db.prepare('SELECT id FROM am_players WHERE name = ?').get(name).id;
await post('/admin/americano/players', { [`del_${idOf('Player Five')}`]: 'on' }, 'testadmin');
res = await post('/admin/americano/generate', {}, 'testdesk');
ok(res.status === 403, 'only an admin can create the rounds');
await post('/admin/americano/generate', {}, 'testadmin');
let ms = db.prepare('SELECT * FROM am_matches ORDER BY round').all();
ok(ms.length === 3, 'four players get three rounds');
// Safe replacement while nothing is scored: removing a player who is in the rounds clears them, in the same save as adding another.
res = await post('/admin/americano/players', { [`del_${idOf('Player Four')}`]: 'on', name_new: 'Player Six', label_new: 'NZSJ' }, 'testadmin');
ok(res.status === 303 && !/err=/.test(loc(res)) && db.prepare('SELECT COUNT(*) n FROM am_players').get().n === 4 && db.prepare('SELECT COUNT(*) n FROM am_matches').get().n === 0, 'a player can be swapped before any score, and the old rounds are cleared');
await post('/admin/americano/generate', {}, 'testadmin');
ms = db.prepare('SELECT * FROM am_matches ORDER BY round').all();
res = await post('/desk/americano/scores', { [`a_${ms[0].id}`]: '4', [`b_${ms[0].id}`]: '3' });
ok(/err=/.test(loc(res)) && db.prepare('SELECT status FROM am_matches WHERE id = ?').get(ms[0].id).status === 'scheduled', '4–3 without its tiebreak is refused');
res = await post('/desk/americano/scores', { [`a_${ms[0].id}`]: '4', [`b_${ms[0].id}`]: '3', [`ta_${ms[0].id}`]: '5', [`tb_${ms[0].id}`]: '4', [`a_${ms[1].id}`]: '4', [`b_${ms[1].id}`]: '1', [`a_${ms[2].id}`]: '4', [`b_${ms[2].id}`]: '0' });
ok(res.status === 303 && db.prepare("SELECT COUNT(*) n FROM am_matches WHERE status = 'done'").get().n === 3, 'three rounds saved with the tiebreak recorded');
res = await post('/admin/americano/players', { [`del_${idOf('Player Six')}`]: 'on' }, 'testadmin');
ok(/err=/.test(loc(res)) && db.prepare('SELECT COUNT(*) n FROM am_players').get().n === 4, 'once a round is scored, a player in it cannot be removed');
const tvp = await pageOf('/partial/tv-americano');
ok(tvp.includes('Player One') && tvp.includes('Round 3') && tvp.includes('Tiebreak 5–4') && !/rally|share/i.test(tvp), 'the TV shows games and the tiebreak, with no rally or shared-place wording');
ok(db.prepare("SELECT COUNT(*) n FROM matches WHERE status != 'scheduled'").get().n === 0 && db.prepare('SELECT COUNT(*) n FROM tickets').get().n === 0 && db.prepare('SELECT COUNT(*) n FROM lineups').get().n === 0, 'the exhibition touches no school match, ticket or lineup');
ok(db.prepare('SELECT COUNT(*) n FROM players').get().n === rosterBefore && db.prepare('SELECT COUNT(*) n FROM players WHERE is_gold = 1 AND active = 1').get().n === goldActive, 'no roster or Gold Player status changes');

// --- Category courts and times ---
const sd = db.prepare("SELECT * FROM showdowns WHERE stage = 'group' ORDER BY round, slot LIMIT 1").get();
const cats = () => db.prepare("SELECT * FROM matches WHERE showdown_id = ? ORDER BY CASE category WHEN 'men' THEN 0 WHEN 'women' THEN 1 ELSE 2 END").all(sd.id);
const women = cats()[1];
const otherCourt = sd.court === 'Court 2' ? 'Court 5' : 'Court 2';
const sdFields = { [`team_a_${sd.id}`]: sd.team_a, [`team_b_${sd.id}`]: sd.team_b, [`time_${sd.id}`]: sd.start_time || '09:05', [`court_${sd.id}`]: sd.court || 'Court 1' };
await post(`/desk/match/${women.id}/court`, { court: otherCourt, go: 'save' });
ok(cats()[1].court === otherCourt && cats()[1].status === 'scheduled', 'the desk can save a court without starting the match');
await post('/admin/reset', { confirm: 'RESET', lineups: 'on', yard: 'on' }, 'testadmin');
db.prepare('UPDATE showdowns SET team_a = ?, team_b = ? WHERE id = ?').run(sd.team_a, sd.team_b, sd.id);
ok(cats().every((m) => m.court === null), 'reset drops every court the desk had set');
db.prepare('UPDATE matches SET court = ? WHERE id = ?').run(otherCourt, women.id);
await post('/admin/showdowns', { ...sdFields, [`court_${sd.id}`]: 'Court 6' }, 'testadmin');
ok(cats().every((m) => m.court === null), 'changing the showdown court drops stale category courts');
await post('/admin/showdowns', { ...sdFields, [`court_${sd.id}`]: 'Court 6', [`mt_${women.id}`]: '15:45', [`mc_${women.id}`]: 'Court 2' }, 'testadmin');
ok(cats()[1].plan_time === '15:45' && cats()[1].plan_court === 'Court 2' && cats()[0].plan_court === null, 'an admin can set one category its own court and time');
let desk = await pageOf(`/desk/showdown/${sd.id}`);
ok(desk.includes('Scheduled 15:45 · Court 2') && desk.includes('Court 6'), 'the desk shows each category its own schedule');
await post('/admin/reset', { confirm: 'RESET', lineups: 'on', yard: 'on' }, 'testadmin');
ok(cats()[1].plan_court === 'Court 2', 'reset keeps the planned category courts');
db.prepare('UPDATE matches SET plan_court = NULL, plan_time = NULL WHERE showdown_id = ?').run(sd.id);

// --- Captain privacy and locking ---
db.prepare("UPDATE settings SET value = 'captains' WHERE key = 'visibility'").run();
const acs = db.prepare("SELECT * FROM showdowns WHERE stage = 'group' AND (team_a = 'acs' OR team_b = 'acs') ORDER BY round LIMIT 1").get()
  || (db.prepare("UPDATE showdowns SET team_a = 'acs', team_b = 'jis' WHERE id = ?").run(sd.id), db.prepare('SELECT * FROM showdowns WHERE id = ?').get(sd.id));
db.prepare("UPDATE showdowns SET team_a = 'acs', team_b = 'jis' WHERE id = ?").run(acs.id);
const open = db.prepare("SELECT * FROM matches WHERE showdown_id = ? AND category = 'open'").get(acs.id);
const two = (team) => db.prepare("SELECT id, name FROM players WHERE team_id = ? AND active = 1 AND is_gold = 0 AND level != 'silver' ORDER BY id LIMIT 2").all(team);
const [a1, a2] = two('acs'); const [j1, j2] = two('jis');
const seeAs = async (cookie, url) => { const r = await fetch(base + url, { redirect: 'manual', headers: { Cookie: `bos_sid=${cookie}` } }); return { status: r.status, body: await r.text() }; };
await post(`/captain/lineup/${open.id}`, { p1: String(j1.id), p2: String(j2.id) }, 'testcapjis');
const pairShown = (body) => body.includes(`${j1.name} / ${j2.name}`);
let v = await seeAs('testcap', '/captain');
let board = await seeAs('testcap', '/partial/public');
let tvb = await seeAs('testcap', '/partial/tv');
ok(!pairShown(v.body) && !pairShown(board.body) && !pairShown(tvb.body), 'the opponent cannot see a submitted pair on the captain page, live scores or TV');
res = await post(`/captain/jis/lineup/${open.id}`, { p1: String(j1.id), p2: String(j2.id) }, 'testcap');
ok(res.status === 404, 'a captain cannot act for another school');
ok((await seeAs('testcap', '/admin')).status === 403 && (await seeAs('testcap', '/desk')).status === 403 && (await seeAs('testcap', '/admin/export.json')).status === 403, 'a captain cannot open admin, the desk or the export');
await post(`/captain/lineup/${open.id}`, { p1: String(a1.id), p2: String(a2.id) }, 'testcap');
v = await seeAs('testcap', '/captain');
ok(pairShown(v.body), 'both pairs are revealed once both captains have submitted');
const stored = () => JSON.stringify(db.prepare('SELECT team_id, p1, p2 FROM lineups WHERE match_id = ? ORDER BY team_id').all(open.id));
const locked = stored();
res = await post(`/captain/lineup/${open.id}`, { p1: String(a2.id), p2: String(a1.id) }, 'testcap');
ok(/err=/.test(loc(res)) && stored() === locked, 'a revealed category is locked against change');
res = await post(`/captain/lineup/${open.id}/withdraw`, {}, 'testcapjis');
ok(/err=/.test(loc(res)) && stored() === locked, 'and cannot be withdrawn');
const signedOut = await fetch(`${base}/partial/public`);
ok(signedOut.status === 401, 'the public still sees nothing');
db.prepare("UPDATE settings SET value = 'staff' WHERE key = 'visibility'").run();
await post('/admin/reset', { confirm: 'RESET', lineups: 'on', yard: 'on' }, 'testadmin');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
