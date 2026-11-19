import express from 'express';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { all, get, run, tx, getSetting, setSetting } from './src/db.js';
import {
  seedIfEmpty, ensureAdmin, loadState, generateFixtures, fillKnockout, resetResults, createShowdown,
} from './src/model.js';
import { loadDemo } from './src/demo.js';
import {
  sessionMiddleware, sameOrigin, requireRole, createLoginToken, peekLoginToken, consumeLoginToken,
  startSession, endSession, sendLoginEmail, mailConfigured, rateLimited, isProd, ADMIN_LINK_MS,
} from './src/auth.js';
import {
  validateFinalScore, validateRunningScore, validateLineup, isKnockout, TICKETS_PER_TEAM, STAGE_LABEL,
} from './src/rules.js';
import { publicPage, publicPartial, tvPage, tvPartial, loginPage, confirmLoginPage } from './src/views/public.js';
import { captainPage } from './src/views/captain.js';
import { deskPage, deskShowdownPage, challengePage } from './src/views/desk.js';
import { adminPage } from './src/views/admin.js';

const PORT = Number(process.env.PORT) || 3000;
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false, limit: '200kb', parameterLimit: 5000 }));
app.use(express.static(path.join(process.cwd(), 'public'), { maxAge: isProd ? '1h' : 0 }));
app.use(sessionMiddleware);
app.use(sameOrigin);

// ---------- Live updates (server-sent events) ----------
const clients = new Set();
function broadcast() {
  for (const res of clients) res.write('data: update\n\n');
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

// Any successful change tells every open scoreboard to refresh.
app.use((req, res, next) => {
  if (req.method === 'POST') res.on('finish', () => { if (res.statusCode < 400) broadcast(); });
  next();
});

// ---------- Helpers ----------
const back = (res, url, kind, text) => {
  const [base, hash] = url.split('#');
  res.redirect(303, `${base}${base.includes('?') ? '&' : '?'}${kind}=${encodeURIComponent(text)}${hash ? `#${hash}` : ''}`);
};
const origin = (req) => `${req.protocol}://${req.get('host')}`;
const intOrNull = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : Number(v));
const safeNext = (n) => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : null);

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}

/** Address spectators should open; used for the QR code. */
function publicUrl(req) {
  const set = getSetting('public_url') || process.env.PUBLIC_URL;
  if (set) return set.replace(/\/$/, '') + '/';
  const host = req.get('host') || `localhost:${PORT}`;
  if (/^(localhost|127\.0\.0\.1)(:|$)/.test(host)) {
    const ip = lanAddress();
    if (ip) return `http://${ip}:${host.split(':')[1] || PORT}/`;
  }
  return `${origin(req)}/`;
}

const noStore = (res) => res.set('Cache-Control', 'no-store');

// ---------- Public ----------
app.get('/', (req, res) => { noStore(res); res.send(publicPage(loadState(), req.user)); });
app.get('/partial/public', (req, res) => { noStore(res); res.send(String(publicPartial(loadState()))); });
app.get('/partial/tv', (req, res) => { noStore(res); res.send(String(tvPartial(loadState()))); });
app.get('/tv', async (req, res, next) => {
  try {
    const url = publicUrl(req);
    const qr = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0D2B55', light: '#0000' } });
    noStore(res);
    res.send(tvPage(loadState(), qr, url));
  } catch (e) { next(e); }
});
app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------- Sign in ----------
app.get('/login', (req, res) => {
  if (req.user) return res.redirect(homeFor(req.user));
  res.send(loginPage({ query: req.query }));
});

app.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const next = safeNext(req.body.next);
  if (!email || rateLimited(`${req.ip}`)) return back(res, '/login', 'err', 'Too many attempts or no email entered. Wait a few minutes and try again.');
  const user = get('SELECT * FROM users WHERE email = ?', email);
  let devLink = null;
  if (user) {
    const token = createLoginToken(user.id);
    const url = `${origin(req)}/auth/${token}${next ? `?next=${encodeURIComponent(next)}` : ''}`;
    try {
      const sent = await sendLoginEmail(email, url);
      if (!sent && !isProd) devLink = url;
    } catch {
      return back(res, '/login', 'err', 'The email could not be sent. Ask the organizer for a sign-in link.');
    }
  }
  res.send(loginPage({ query: {}, sentTo: email, devLink }));
});

// The link opens a confirmation page; signing in happens on the button press so that
// email scanners that pre-open links cannot use up the one-time token.
app.get('/auth/:token', (req, res) => {
  if (!peekLoginToken(req.params.token)) return back(res, '/login', 'err', 'That sign-in link has expired or was already used. Request a new one.');
  res.send(confirmLoginPage(req.params.token, safeNext(req.query.next)));
});

app.post('/auth/:token', (req, res) => {
  const userId = consumeLoginToken(req.params.token);
  if (!userId) return back(res, '/login', 'err', 'That sign-in link has expired or was already used. Request a new one.');
  startSession(req, res, userId);
  const user = get('SELECT * FROM users WHERE id = ?', userId);
  res.redirect(303, safeNext(req.body.next) || homeFor(user));
});

app.post('/logout', (req, res) => { endSession(req, res); res.redirect(303, '/'); });

const homeFor = (user) => (user.role === 'admin' ? '/admin' : user.role === 'desk' ? '/desk' : '/captain');

// ---------- Lineups (shared by captain and desk) ----------
function saveLineup(state, m, team, body, userId, { byDesk = false } = {}) {
  const sd = m.sd;
  const side = sd.team_a === team.id ? 'a' : sd.team_b === team.id ? 'b' : null;
  if (!side) return ['That match does not involve this school.'];
  if (!byDesk) {
    if (m.status === 'done') return ['This match is finished.'];
    if (m.revealed) return ['Both lineups are in and locked. Ask the scoring desk to change it.'];
  }
  const p1 = intOrNull(body.p1);
  const p2 = intOrNull(body.p2);
  const goldOut = body.gold === 'p1' ? p1 : body.gold === 'p2' ? p2 : null;
  const teamTickets = state.ticketsByTeam.get(team.id) || [];
  const isOwnStart = (t) => t.match_id === m.id && t.type === 'gold_player' && t.timing === 'start';
  const errors = validateLineup({
    stage: sd.stage,
    category: m.category,
    players: team.players,
    p1, p2, goldOut,
    otherLineups: sd.matches.filter((x) => x.id !== m.id && x.lineup[side]).map((x) => ({ category: x.category, p1: x.lineup[side].p1, p2: x.lineup[side].p2 })),
    ticketsUsedElsewhere: teamTickets.filter((t) => !isOwnStart(t)).length,
  });
  if (errors.length) return errors;
  tx(() => {
    run(
      'INSERT INTO lineups (match_id, team_id, p1, p2, submitted_at, by_user) VALUES (?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(match_id, team_id) DO UPDATE SET p1 = excluded.p1, p2 = excluded.p2, submitted_at = excluded.submitted_at, by_user = excluded.by_user',
      m.id, team.id, p1, p2, Date.now(), userId,
    );
    if (byDesk) {
      // Keep recorded Gold Player tickets only while the replaced player is still in the pair.
      run("DELETE FROM tickets WHERE match_id = ? AND team_id = ? AND type = 'gold_player' AND player_out NOT IN (?, ?)", m.id, team.id, p1, p2);
    } else {
      run("DELETE FROM tickets WHERE match_id = ? AND team_id = ? AND type = 'gold_player' AND timing = 'start'", m.id, team.id);
      if (goldOut != null) {
        run("INSERT INTO tickets (team_id, match_id, type, player_out, timing, created_at) VALUES (?, ?, 'gold_player', ?, 'start', ?)", team.id, m.id, goldOut, Date.now());
      }
    }
  });
  return [];
}

// ---------- Captain ----------
function captainTeam(req, state) {
  if (req.user.role === 'admin') {
    const id = req.params.team || req.query.team || state.teams[0]?.id;
    return state.teamById.get(id) || null;
  }
  if (req.params.team) return null; // captains cannot act for another school
  return state.teamById.get(req.user.team_id) || null;
}
const captainBase = (req, team) => (req.user.role === 'admin' ? `/captain?team=${team.id}` : '/captain');

app.get('/captain', requireRole('captain'), (req, res) => {
  const state = loadState();
  const team = captainTeam(req, state);
  if (!team) return res.status(403).send('This login is not linked to a school. Ask the organizer.');
  noStore(res);
  res.send(captainPage(state, req.user, team, req.query));
});

app.post(['/captain/lineup/:mid', '/captain/:team/lineup/:mid'], requireRole('captain'), (req, res) => {
  const state = loadState();
  const team = captainTeam(req, state);
  const m = state.matchById.get(Number(req.params.mid));
  if (!team || !m) return res.status(404).send('Not found.');
  const errors = saveLineup(state, m, team, req.body, req.user.id);
  if (errors.length) return back(res, captainBase(req, team), 'err', errors.join(' '));
  const fresh = loadState().matchById.get(m.id);
  back(res, captainBase(req, team), 'msg', fresh.revealed ? 'Lineup submitted. Both lineups are in, so they are now shown and locked.' : 'Lineup submitted. It stays hidden until your opponent submits theirs.');
});

app.post(['/captain/lineup/:mid/withdraw', '/captain/:team/lineup/:mid/withdraw'], requireRole('captain'), (req, res) => {
  const state = loadState();
  const team = captainTeam(req, state);
  const m = state.matchById.get(Number(req.params.mid));
  if (!team || !m) return res.status(404).send('Not found.');
  if (m.revealed || m.status === 'done') return back(res, captainBase(req, team), 'err', 'This lineup is locked. Ask the scoring desk to change it.');
  tx(() => {
    run('DELETE FROM lineups WHERE match_id = ? AND team_id = ?', m.id, team.id);
    run("DELETE FROM tickets WHERE match_id = ? AND team_id = ? AND type = 'gold_player' AND timing = 'start'", m.id, team.id);
  });
  back(res, captainBase(req, team), 'msg', 'Lineup withdrawn.');
});

app.post(['/captain/genders', '/captain/:team/genders'], requireRole('captain'), (req, res) => {
  const state = loadState();
  const team = captainTeam(req, state);
  if (!team) return res.status(404).send('Not found.');
  let n = 0;
  for (const p of team.players) {
    const g = req.body[`gender_${p.id}`];
    if (!p.gender && (g === 'M' || g === 'F')) { run('UPDATE players SET gender = ? WHERE id = ?', g, p.id); n++; }
  }
  back(res, captainBase(req, team), 'msg', n ? `Saved for ${n} player${n === 1 ? '' : 's'}.` : 'Nothing to save.');
});

// ---------- Scoring desk ----------
app.get('/desk', requireRole('desk'), (req, res) => { noStore(res); res.send(deskPage(loadState(), req.user, req.query)); });

app.get('/desk/showdown/:id', requireRole('desk'), (req, res) => {
  const state = loadState();
  const sd = state.sdById.get(Number(req.params.id));
  if (!sd) return res.status(404).send('Showdown not found.');
  noStore(res);
  res.send(deskShowdownPage(state, req.user, sd, req.query));
});

function deskMatch(req, res) {
  const state = loadState();
  const m = state.matchById.get(Number(req.params.id));
  if (!m) { res.status(404).send('Match not found.'); return {}; }
  return { state, m, url: `/desk/showdown/${m.sd.id}#match-${m.id}`, json: (req.get('accept') || '').includes('application/json') };
}
// The live-score steppers save in the background and want a short JSON answer instead of a page.
const deskBack = (res, ctx, kind, text) => (ctx.json ? res.status(kind === 'err' ? 422 : 200).json({ ok: kind !== 'err', text }) : back(res, ctx.url, kind, text));

app.post('/desk/match/:id/court', requireRole('desk'), (req, res) => {
  const ctx = deskMatch(req, res);
  if (!ctx.m) return;
  const { m, state } = ctx;
  const court = String(req.body.court || '').trim().slice(0, 40) || null;
  const go = req.body.go;
  if (go === 'live') {
    if (!m.sd.a || !m.sd.b) return deskBack(res, ctx, 'err', 'Set both schools first.');
    const busy = court && state.live.find((x) => x.court === court && x.id !== m.id);
    if (busy) return deskBack(res, ctx, 'err', `${court} still shows ${busy.sd.a?.name} v ${busy.sd.b?.name} on court. Save that score first, or pick another court.`);
    run("UPDATE matches SET court = ?, status = 'live', started_at = ? WHERE id = ?", court, Date.now(), m.id);
    return deskBack(res, ctx, 'msg', `On court${court ? ` at ${court}` : ''}. It now shows on the scoreboards.`);
  }
  if (go === 'scheduled' && m.status === 'live') {
    run("UPDATE matches SET court = ?, status = 'scheduled', started_at = NULL WHERE id = ?", court, m.id);
    return deskBack(res, ctx, 'msg', 'Taken off court.');
  }
  run('UPDATE matches SET court = ? WHERE id = ?', court, m.id);
  deskBack(res, ctx, 'msg', 'Court saved.');
});

app.post('/desk/match/:id/score', requireRole('desk'), (req, res) => {
  const ctx = deskMatch(req, res);
  if (!ctx.m) return;
  const { m } = ctx;
  if (!m.sd.a || !m.sd.b) return deskBack(res, ctx, 'err', 'Set both schools first.');
  const stage = m.sd.stage;
  const a = intOrNull(req.body.a);
  const b = intOrNull(req.body.b);
  const ko = isKnockout(stage);
  const tbA = ko ? intOrNull(req.body.tba) : null;
  const tbB = ko ? intOrNull(req.body.tbb) : null;
  if (req.body.mode === 'running') {
    const err = validateRunningScore(stage, a, b);
    if (err) return deskBack(res, ctx, 'err', err);
    run("UPDATE matches SET score_a = ?, score_b = ?, status = 'live', started_at = COALESCE(started_at, ?) WHERE id = ?", a, b, Date.now(), m.id);
    return deskBack(res, ctx, 'msg', `Live score ${a}–${b} is on the scoreboards.`);
  }
  const err = validateFinalScore(stage, a, b, tbA, tbB);
  if (err) return deskBack(res, ctx, 'err', err);
  run("UPDATE matches SET score_a = ?, score_b = ?, tb_a = ?, tb_b = ?, status = 'done', finished_at = COALESCE(finished_at, ?) WHERE id = ?", a, b, tbA, tbB, Date.now(), m.id);
  deskBack(res, ctx, 'msg', `Final score ${a}–${b} saved. Standings are updated.`);
});

app.post('/desk/match/:id/reopen', requireRole('desk'), (req, res) => {
  const ctx = deskMatch(req, res);
  if (!ctx.m) return;
  run("UPDATE matches SET status = 'scheduled', score_a = NULL, score_b = NULL, tb_a = NULL, tb_b = NULL, started_at = NULL, finished_at = NULL WHERE id = ?", ctx.m.id);
  deskBack(res, ctx, 'msg', 'Match reopened and score removed.');
});

app.post('/desk/match/:id/lineup/:side', requireRole('desk'), (req, res) => {
  const ctx = deskMatch(req, res);
  if (!ctx.m) return;
  const team = req.params.side === 'a' ? ctx.m.sd.a : ctx.m.sd.b;
  if (!team) return deskBack(res, ctx, 'err', 'Set both schools first.');
  const errors = saveLineup(ctx.state, ctx.m, team, req.body, req.user.id, { byDesk: true });
  if (errors.length) return deskBack(res, ctx, 'err', errors.join(' '));
  deskBack(res, ctx, 'msg', `Lineup saved for ${team.name}.`);
});

app.post('/desk/match/:id/lineup/:side/clear', requireRole('desk'), (req, res) => {
  const ctx = deskMatch(req, res);
  if (!ctx.m) return;
  const team = req.params.side === 'a' ? ctx.m.sd.a : ctx.m.sd.b;
  if (!team) return deskBack(res, ctx, 'err', 'Set both schools first.');
  tx(() => {
    run('DELETE FROM lineups WHERE match_id = ? AND team_id = ?', ctx.m.id, team.id);
    run("DELETE FROM tickets WHERE match_id = ? AND team_id = ? AND type = 'gold_player'", ctx.m.id, team.id);
  });
  deskBack(res, ctx, 'msg', `Lineup cleared for ${team.name}. Their captain can submit again.`);
});

app.post('/desk/match/:id/ticket', requireRole('desk'), (req, res) => {
  const ctx = deskMatch(req, res);
  if (!ctx.m) return;
  const { m, state } = ctx;
  if (isKnockout(m.sd.stage)) return deskBack(res, ctx, 'err', 'Golden Tickets can only be used in the group stage.');
  const team = [m.sd.a, m.sd.b].find((t) => t && t.id === req.body.team);
  if (!team) return deskBack(res, ctx, 'err', 'Choose the school that used the ticket.');
  const used = state.ticketsByTeam.get(team.id) || [];
  if (used.length >= TICKETS_PER_TEAM) return deskBack(res, ctx, 'err', `${team.name} has already used its ${TICKETS_PER_TEAM} Golden Tickets.`);
  const use = String(req.body.use || '');
  if (use === 'point') {
    run("INSERT INTO tickets (team_id, match_id, type, created_at) VALUES (?, ?, 'golden_point', ?)", team.id, m.id, Date.now());
    return deskBack(res, ctx, 'msg', `Golden Point recorded for ${team.name}.`);
  }
  if (!use.startsWith('out:')) return deskBack(res, ctx, 'err', 'Choose Golden Point or the player the Gold Player replaces.');
  const out = Number(use.slice(4));
  const timing = req.body.timing === 'after_g2' ? 'after_g2' : 'start';
  const side = m.sd.team_a === team.id ? 'a' : 'b';
  const l = m.lineup[side];
  if (!l) return deskBack(res, ctx, 'err', `Enter ${team.name}’s lineup before recording a Gold Player.`);
  if (out !== l.p1 && out !== l.p2) return deskBack(res, ctx, 'err', `Choose which ${team.name} player the Gold Player replaced.`);
  if (m.tickets.some((t) => t.team_id === team.id && t.type === 'gold_player')) return deskBack(res, ctx, 'err', `${team.name} already has a Gold Player in this match.`);
  const outP = state.playerById.get(out);
  if (team.gold && team.gold.gender && outP.gender && team.gold.gender !== outP.gender) return deskBack(res, ctx, 'err', 'The Gold Player can only replace a player of the same gender.');
  run("INSERT INTO tickets (team_id, match_id, type, player_out, timing, created_at) VALUES (?, ?, 'gold_player', ?, ?, ?)", team.id, m.id, out, timing, Date.now());
  deskBack(res, ctx, 'msg', `Gold Player recorded for ${team.name}.`);
});

app.post('/desk/ticket/:id/delete', requireRole('desk'), (req, res) => {
  const t = get('SELECT t.*, m.showdown_id FROM tickets t JOIN matches m ON m.id = t.match_id WHERE t.id = ?', Number(req.params.id));
  if (!t) return res.status(404).send('Ticket not found.');
  run('DELETE FROM tickets WHERE id = ?', t.id);
  back(res, `/desk/showdown/${t.showdown_id}#match-${t.match_id}`, 'msg', 'Golden Ticket removed.');
});

app.get('/desk/challenge', requireRole('desk'), (req, res) => { noStore(res); res.send(challengePage(loadState(), req.user, req.query)); });

app.post('/desk/challenge', requireRole('desk'), (req, res) => {
  const state = loadState();
  for (const t of state.teams) for (const st of state.stations) {
    const v = req.body[`c_${t.id}_${st.id}`];
    const n = v === undefined || String(v).trim() === '' ? null : Number(v);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1000)) return back(res, '/desk/challenge', 'err', `The points for ${t.name} at ${st.name} are not a valid number.`);
  }
  tx(() => {
    for (const t of state.teams) for (const st of state.stations) {
      const v = req.body[`c_${t.id}_${st.id}`];
      if (v === undefined) continue;
      if (String(v).trim() === '') run('DELETE FROM challenge WHERE team_id = ? AND station_id = ?', t.id, st.id);
      else run('INSERT INTO challenge (team_id, station_id, points) VALUES (?, ?, ?) ON CONFLICT(team_id, station_id) DO UPDATE SET points = excluded.points', t.id, st.id, Number(v));
    }
  });
  back(res, '/desk/challenge', 'msg', 'Challenge points saved. Standings are updated.');
});

// ---------- Admin ----------
const admin = requireRole('admin');

app.get('/admin', admin, (req, res) => {
  noStore(res);
  res.send(adminPage(loadState(), req.user, { tab: req.query.tab, users: all('SELECT * FROM users ORDER BY role, team_id, email'), origin: origin(req), query: req.query }));
});

app.post('/admin/groups', admin, (req, res) => {
  const teams = all('SELECT id FROM teams');
  tx(() => {
    for (const t of teams) {
      const g = req.body[`grp_${t.id}`];
      run('UPDATE teams SET grp = ? WHERE id = ?', g === 'A' || g === 'B' ? g : null, t.id);
    }
  });
  const count = (g) => get('SELECT COUNT(*) AS n FROM teams WHERE grp = ?', g).n;
  back(res, '/admin?tab=setup', 'msg', `Groups saved: ${count('A')} in Group A, ${count('B')} in Group B.`);
});

app.post('/admin/fixtures/generate', admin, (req, res) => {
  try { generateFixtures(); } catch (e) { return back(res, '/admin?tab=setup', 'err', e.message); }
  back(res, '/admin?tab=setup', 'msg', 'Fixtures generated. Check each round against the draw, then add times and courts.');
});

app.post('/admin/showdown', admin, (req, res) => {
  const stage = Object.keys(STAGE_LABEL).includes(req.body.stage) ? req.body.stage : 'group';
  const round = Math.min(20, Math.max(1, Number(req.body.round) || 1));
  createShowdown(stage, round);
  back(res, '/admin?tab=setup', 'msg', 'Showdown added. Set its schools in the table.');
});

// The whole fixtures table is saved in one go.
app.post('/admin/showdowns', admin, (req, res) => {
  const valid = new Set(all('SELECT id FROM teams').map((t) => t.id));
  const rows = all('SELECT * FROM showdowns');
  const next = [];
  for (const sd of rows) {
    if (req.body[`team_a_${sd.id}`] === undefined) continue;
    const a = valid.has(req.body[`team_a_${sd.id}`]) ? req.body[`team_a_${sd.id}`] : null;
    const b = valid.has(req.body[`team_b_${sd.id}`]) ? req.body[`team_b_${sd.id}`] : null;
    if (a && a === b) return back(res, '/admin?tab=setup', 'err', 'A school cannot play itself. Nothing was saved.');
    const t = req.body[`time_${sd.id}`] || '';
    const time = /^\d{2}:\d{2}$/.test(t) ? t : null;
    const court = String(req.body[`court_${sd.id}`] || '').trim().slice(0, 40) || null;
    if (sd.team_a !== a || sd.team_b !== b || sd.start_time !== time || sd.court !== court) next.push({ sd, a, b, time, court });
  }
  tx(() => {
    for (const { sd, a, b, time, court } of next) {
      if (sd.team_a !== a || sd.team_b !== b) {
        // Lineups belong to the schools that were removed, so they cannot carry over.
        run('DELETE FROM lineups WHERE match_id IN (SELECT id FROM matches WHERE showdown_id = ?) AND team_id NOT IN (?, ?)', sd.id, a || '', b || '');
        run('DELETE FROM tickets WHERE match_id IN (SELECT id FROM matches WHERE showdown_id = ?) AND team_id NOT IN (?, ?)', sd.id, a || '', b || '');
      }
      run('UPDATE showdowns SET team_a = ?, team_b = ?, start_time = ?, court = ? WHERE id = ?', a, b, time, court, sd.id);
    }
  });
  back(res, '/admin?tab=setup#fixtures', 'msg', next.length ? `Saved ${next.length} showdown${next.length === 1 ? '' : 's'}.` : 'Nothing had changed.');
});

app.post('/admin/showdown/:id/delete', admin, (req, res) => {
  run('DELETE FROM showdowns WHERE id = ?', Number(req.params.id));
  back(res, '/admin?tab=setup#fixtures', 'msg', 'Showdown deleted.');
});

app.post('/admin/knockout/fill', admin, (req, res) => {
  const notes = fillKnockout();
  back(res, '/admin?tab=setup', notes.length ? 'msg' : 'err', notes.length ? notes.join('. ') : 'Nothing to fill yet. Set groups and generate fixtures first.');
});

app.post('/admin/users', admin, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const role = ['captain', 'desk', 'admin'].includes(req.body.role) ? req.body.role : 'captain';
  const team = role === 'captain' ? (get('SELECT id FROM teams WHERE id = ?', req.body.team_id || '')?.id || null) : null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return back(res, '/admin?tab=people', 'err', 'Enter a valid email address.');
  if (role === 'captain' && !team) return back(res, '/admin?tab=people', 'err', 'Choose the captain’s school.');
  if (get('SELECT 1 AS x FROM users WHERE email = ?', email)) return back(res, '/admin?tab=people', 'err', 'That email already has a login.');
  run('INSERT INTO users (email, name, role, team_id) VALUES (?, ?, ?, ?)', email, String(req.body.name || '').trim().slice(0, 80), role, team);
  back(res, '/admin?tab=people', 'msg', `Login added for ${email}.`);
});

// Desk and captain logins that do not exist yet. The addresses are placeholders that cannot receive mail;
// replace each with the real person's email once the organizer provides it.
app.post('/admin/users/seed', admin, (req, res) => {
  let n = 0;
  if (!get("SELECT 1 AS x FROM users WHERE role = 'desk'")) { run("INSERT INTO users (email, name, role) VALUES ('desk@bos.local', 'Scoring desk', 'desk')"); n++; }
  for (const t of all('SELECT id, name FROM teams ORDER BY sort')) {
    if (get("SELECT 1 AS x FROM users WHERE role = 'captain' AND team_id = ?", t.id)) continue;
    run("INSERT INTO users (email, name, role, team_id) VALUES (?, ?, 'captain', ?)", `captain.${t.id}@bos.local`, `${t.name} captain`, t.id);
    n++;
  }
  back(res, '/admin?tab=people', 'msg', n ? `Added ${n} login${n === 1 ? '' : 's'}.` : 'Every school already has a captain login, and there is a desk login.');
});

app.post('/admin/users/links', admin, (req, res) => {
  const users = all('SELECT * FROM users ORDER BY role, team_id, email');
  const links = users.map((u) => ({ user: u, url: `${origin(req)}/auth/${createLoginToken(u.id, ADMIN_LINK_MS)}` }));
  noStore(res);
  res.send(adminPage(loadState(), req.user, { tab: 'people', users, origin: origin(req), query: {}, links }));
});

app.post('/admin/users/:id/link', admin, (req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!u) return res.status(404).send('Not found.');
  const token = createLoginToken(u.id, ADMIN_LINK_MS);
  res.redirect(303, `/admin?tab=people&link=${encodeURIComponent(`${origin(req)}/auth/${token}`)}&msg=${encodeURIComponent(`Link created for ${u.email}.`)}`);
});

app.post('/admin/users/:id/delete', admin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return back(res, '/admin?tab=people', 'err', 'You cannot remove your own login.');
  run('DELETE FROM users WHERE id = ?', id);
  back(res, '/admin?tab=people', 'msg', 'Login removed.');
});

app.post('/admin/players/:team', admin, (req, res) => {
  const team = get('SELECT * FROM teams WHERE id = ?', req.params.team);
  if (!team) return res.status(404).send('Not found.');
  const levels = ['silver', 'bronze', 'lower_bronze'];
  const read = (id) => ({
    name: String(req.body[`name_${id}`] || '').trim().slice(0, 60),
    level: levels.includes(req.body[`level_${id}`]) ? req.body[`level_${id}`] : 'bronze',
    pending: req.body[`pending_${id}`] ? 1 : 0,
    gender: ['M', 'F'].includes(req.body[`gender_${id}`]) ? req.body[`gender_${id}`] : null,
    captain: req.body[`captain_${id}`] ? 1 : 0,
    gold: req.body[`gold_${id}`] ? 1 : 0,
    active: req.body[`active_${id}`] ? 1 : 0,
  });
  tx(() => {
    for (const p of all('SELECT id FROM players WHERE team_id = ?', team.id)) {
      const v = read(p.id);
      if (!v.name) continue;
      run('UPDATE players SET name = ?, level = ?, level_pending = ?, gender = ?, is_captain = ?, is_gold = ?, active = ? WHERE id = ?', v.name, v.level, v.pending, v.gender, v.captain, v.gold, v.active, p.id);
    }
    const n = read('new');
    if (n.name) run('INSERT INTO players (team_id, name, level, level_pending, gender, is_captain, is_gold, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)', team.id, n.name, n.level, n.pending, n.gender, n.captain, n.gold);
  });
  back(res, `/admin?tab=players&team=${team.id}`, 'msg', `${team.name} saved.`);
});

app.post('/admin/settings', admin, (req, res) => {
  const courts = String(req.body.courts || '').split(',').map((s) => s.trim().slice(0, 40)).filter(Boolean);
  if (!courts.length) return back(res, '/admin?tab=settings', 'err', 'List at least one court.');
  let url = String(req.body.public_url || '').trim();
  if (url && !/^https?:\/\/[^\s]+$/.test(url)) return back(res, '/admin?tab=settings', 'err', 'The public address must start with http:// or https://');
  setSetting('event_title', String(req.body.event_title || '').trim().slice(0, 80) || 'Homecoming 2026');
  setSetting('event_date', String(req.body.event_date || '').trim().slice(0, 60));
  setSetting('venue', String(req.body.venue || '').trim().slice(0, 80));
  setSetting('courts', courts.join(', '));
  setSetting('public_url', url);
  back(res, '/admin?tab=settings', 'msg', 'Settings saved.');
});

app.post('/admin/stations', admin, (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  if (!name) return back(res, '/admin?tab=settings', 'err', 'Enter a station name.');
  run('INSERT INTO stations (name, sort) VALUES (?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM stations))', name);
  back(res, '/admin?tab=settings', 'msg', `${name} added.`);
});

app.post('/admin/stations/:id/delete', admin, (req, res) => {
  run('DELETE FROM stations WHERE id = ?', Number(req.params.id));
  back(res, '/admin?tab=settings', 'msg', 'Station removed.');
});

app.post('/admin/demo', admin, (req, res) => {
  loadDemo();
  back(res, '/admin?tab=settings', 'msg', 'Demo data loaded. Open Live scores or the TV scoreboard to see it.');
});

app.post('/admin/reset', admin, (req, res) => {
  resetResults();
  back(res, '/admin?tab=settings', 'msg', 'All scores, lineups, tickets and challenge points removed.');
});

// ---------- Errors ----------
app.use((req, res) => res.status(404).send('Page not found.'));
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).send('Something went wrong. Go back and try again.');
});

// ---------- Start ----------
const seeded = seedIfEmpty();
if (seeded) console.log('Loaded schools and players from seed/schools.json');
ensureAdmin(process.env.ADMIN_EMAIL);
// Placeholder logins use @bos.local; rename the ones first created under another ending.
run("UPDATE users SET email = replace(email, '@bos.invalid', '@bos.local') WHERE email LIKE '%@bos.invalid' AND replace(email, '@bos.invalid', '@bos.local') NOT IN (SELECT email FROM users)");
// The venue has six courts; move databases still holding the first four-court default.
if (getSetting('courts') === 'Court 1, Court 2, Court 3, Court 4') setSetting('courts', 'Court 1, Court 2, Court 3, Court 4, Court 5, Court 6');

if (!isProd) {
  // Local test logins. Never created in production.
  for (const [email, name, role, team] of [
    ['admin@bos.local', 'Local admin', 'admin', null],
    ['desk@bos.local', 'Local scoring desk', 'desk', null],
    ['captain.acs@bos.local', 'Ken (test)', 'captain', 'acs'],
    ['captain.jis@bos.local', 'Kristin (test)', 'captain', 'jis'],
  ]) {
    if (!get('SELECT 1 AS x FROM users WHERE email = ?', email)) run('INSERT INTO users (email, name, role, team_id) VALUES (?, ?, ?, ?)', email, name, role, team);
  }
  if (process.env.DEMO === '1' && get('SELECT COUNT(*) AS n FROM showdowns').n === 0) { loadDemo(); console.log('Loaded demo fixtures and scores'); }
}

app.listen(PORT, () => {
  console.log(`Battle of Schools scores running at http://localhost:${PORT}`);
  if (!isProd) console.log('Local test logins: admin@bos.local, desk@bos.local, captain.acs@bos.local, captain.jis@bos.local (the sign-in link is shown on the login page)');
  if (isProd && !mailConfigured() && process.env.ADMIN_EMAIL) {
    // Without an email service the first admin has no way in, so print a sign-in link to the server log.
    const adminUser = get('SELECT id FROM users WHERE email = ?', process.env.ADMIN_EMAIL.trim().toLowerCase());
    const base = process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
    if (adminUser && base) console.log(`Admin sign-in link (valid 7 days): ${base.replace(/\/$/, '')}/auth/${createLoginToken(adminUser.id, ADMIN_LINK_MS)}`);
  }
  if (isProd && !mailConfigured()) console.log('Email is not configured (RESEND_API_KEY and MAIL_FROM). Sign-in links can only be created by an admin.');
});
