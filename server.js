import express from 'express';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { all, get, run, tx, getSetting, setSetting } from './src/db.js';
import {
  seedIfEmpty, backfillPhotos, ensureAdmin, loadState, loadAmericano, generateFixtures, fillKnockout, resetResults, createShowdown,
} from './src/model.js';
import { loadDemo } from './src/demo.js';
import {
  sessionMiddleware, sameOrigin, requireRole, createLoginToken, peekLoginToken, consumeLoginToken,
  startSession, endSession, revokeAllAccess, sendLoginEmail, mailConfigured, rateLimited, isProd, ADMIN_LINK_MS,
} from './src/auth.js';
import {
  validateFinalScore, validateRunningScore, validateLineup, goldReplaceError, isKnockout, ticketBalance, GOLD_DEPLOYMENTS, GOLDEN_POINTS, STAGE_LABEL,
} from './src/rules.js';
import { STATIONS, FIELDS, slotsFor, isBlank, readAttempt, readQuick, fieldsFromRaw, personKey, BONUS_MAX, fmtPoints } from './src/activity.js';
import { publicPage, publicPartial, tvPage, tvPartial, loginPage, confirmLoginPage, holdingPage } from './src/views/public.js';
import { knockoutPage, knockoutPartial, summaryPage, summaryPartial } from './src/views/tv-stages.js';
import { captainPage } from './src/views/captain.js';
import { deskPage, deskShowdownPage } from './src/views/desk.js';
import { activityPage } from './src/views/activity.js';
import { awardPage, AWARD_STATIONS, AWARD_KINDS } from './src/views/award.js';
import { americanoPage, americanoPartial, americanoTvPage } from './src/views/americano.js';
import { schedule as amSchedule, validateScore as amValidate } from './src/americano.js';
import { adminPage } from './src/views/admin.js';

const PORT = Number(process.env.PORT) || 3000;
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false, limit: '200kb', parameterLimit: 5000 }));
// Portraits uploaded by an admin live with the data (so they survive a deploy) and are looked up first.
const PHOTO_DIR = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'players');
fs.mkdirSync(PHOTO_DIR, { recursive: true });
app.use('/assets/players', express.static(PHOTO_DIR, { maxAge: isProd ? '1h' : 0 }));
app.use(express.static(path.join(process.cwd(), 'public'), { maxAge: isProd ? '1h' : 0 }));
app.use(sessionMiddleware);
app.use(sameOrigin);

// ---------- Who may see the tournament ----------
// 'staff': admin and desk only (private staging). 'captains': captains as well. 'public': everyone.
const VISIBILITY = ['staff', 'captains', 'public'];
const visibility = () => { const v = getSetting('visibility', 'staff'); return VISIBILITY.includes(v) ? v : 'staff'; };

app.get('/healthz', (req, res) => res.json({ ok: true }));
// The event address is /bos2026; the app itself lives at the root of the domain.
app.all(['/bos2026', '/bos2026/*'], (req, res) => res.redirect(302, req.originalUrl.replace(/^\/bos2026\/?/, '/')));

app.use((req, res, next) => {
  const v = visibility();
  if (v === 'public') return next();
  const p = req.path;
  if (p === '/login' || p === '/logout' || p.startsWith('/auth/')) return next();
  const role = req.user?.role;
  if (role === 'admin' || role === 'desk') return next();
  if (role === 'captain' && v === 'captains') return next();
  res.set('Cache-Control', 'no-store');
  if (role === 'captain') return res.status(403).send(holdingPage(req.user));
  if (req.method === 'GET' && !p.startsWith('/partial/') && p !== '/events') return res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
  res.status(401).send('Sign in first.');
});

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
// Sign-in links and the QR code use the main address when one is set, whichever host the request came in on.
const linkBase = (req) => (getSetting('public_url') || process.env.PUBLIC_URL || origin(req)).replace(/\/+$/, '');
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
const tvScreen = (page) => async (req, res, next) => {
  try {
    const url = publicUrl(req);
    const qr = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#0D2B55', light: '#0000' } });
    noStore(res);
    res.send(page(loadState(), qr, url, { secret: req.query.secret === '1', am: loadAmericano() }));
  } catch (e) { next(e); }
};
app.get('/tv/knockout', tvScreen(knockoutPage));
app.get('/tv/summary', tvScreen(summaryPage));
app.get('/tv/americano', tvScreen(americanoTvPage));
app.get('/partial/tv-americano', (req, res) => { noStore(res); res.send(String(americanoPartial(loadAmericano()))); });
app.get('/partial/tv-knockout', (req, res) => { noStore(res); res.send(String(knockoutPartial(loadState()))); });
app.get('/partial/tv-summary', (req, res) => { noStore(res); res.send(String(summaryPartial(loadState(), { secret: req.query.secret === '1' }))); });

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
    const url = `${linkBase(req)}/auth/${token}${next ? `?next=${encodeURIComponent(next)}` : ''}`;
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
    goldUsedElsewhere: teamTickets.filter((t) => t.type === 'gold_player' && !isOwnStart(t)).length,
    goldenPointHere: m.tickets.some((t) => t.team_id === team.id && t.type === 'golden_point'),
  });
  if (errors.length) return errors;
  if (byDesk) {
    const kept = m.tickets.find((t) => t.team_id === team.id && t.type === 'gold_player' && (t.player_out === p1 || t.player_out === p2));
    if (kept) {
      const byId = new Map(team.players.map((p) => [p.id, p]));
      const why = goldReplaceError(team.gold, byId.get(p1), byId.get(p2), byId.get(kept.player_out));
      if (why) return [`This pair no longer fits the Gold Player ticket recorded for this match. ${why} Remove the ticket first if the pair really changed.`];
    }
  }
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
  const bal = ticketBalance(state.ticketsByTeam.get(team.id) || []);
  const here = m.tickets.filter((t) => t.team_id === team.id);
  const use = String(req.body.use || '');
  if (use === 'point') {
    if (bal.pointLeft <= 0) return deskBack(res, ctx, 'err', `${team.name} has already used its ${GOLDEN_POINTS} Golden Points.`);
    if (here.some((t) => t.type === 'gold_player')) return deskBack(res, ctx, 'err', `${team.name} has a Gold Player in this match. The two tickets cannot be combined in one match.`);
    run("INSERT INTO tickets (team_id, match_id, type, created_at) VALUES (?, ?, 'golden_point', ?)", team.id, m.id, Date.now());
    return deskBack(res, ctx, 'msg', `Golden Point recorded for ${team.name}.`);
  }
  if (!use.startsWith('out:')) return deskBack(res, ctx, 'err', 'Choose Golden Point or the player the Gold Player replaces.');
  if (bal.goldLeft <= 0) return deskBack(res, ctx, 'err', `${team.name} has already used its ${GOLD_DEPLOYMENTS} Gold Player deployments.`);
  if (!team.gold) return deskBack(res, ctx, 'err', `${team.name} has no approved Gold Player on its roster.`);
  if (here.some((t) => t.type === 'golden_point')) return deskBack(res, ctx, 'err', `${team.name} used a Golden Point in this match. The two tickets cannot be combined in one match.`);
  const out = Number(use.slice(4));
  const timing = req.body.timing === 'after_g2' ? 'after_g2' : 'start';
  const side = m.sd.team_a === team.id ? 'a' : 'b';
  const l = m.lineup[side];
  if (!l) return deskBack(res, ctx, 'err', `Enter ${team.name}’s lineup before recording a Gold Player.`);
  if (out !== l.p1 && out !== l.p2) return deskBack(res, ctx, 'err', `Choose which ${team.name} player the Gold Player replaced.`);
  if (m.tickets.some((t) => t.team_id === team.id && t.type === 'gold_player')) return deskBack(res, ctx, 'err', `${team.name} already has a Gold Player in this match.`);
  const why = goldReplaceError(team.gold, l.player1, l.player2, state.playerById.get(out));
  if (why) return deskBack(res, ctx, 'err', why);
  run("INSERT INTO tickets (team_id, match_id, type, player_out, timing, created_at) VALUES (?, ?, 'gold_player', ?, ?, ?)", team.id, m.id, out, timing, Date.now());
  deskBack(res, ctx, 'msg', `Gold Player recorded for ${team.name}.`);
});

app.post('/desk/ticket/:id/delete', requireRole('desk'), (req, res) => {
  const t = get('SELECT t.*, m.showdown_id FROM tickets t JOIN matches m ON m.id = t.match_id WHERE t.id = ?', Number(req.params.id));
  if (!t) return res.status(404).send('Ticket not found.');
  run('DELETE FROM tickets WHERE id = ?', t.id);
  back(res, `/desk/showdown/${t.showdown_id}#match-${t.match_id}`, 'msg', 'Golden Ticket removed.');
});

// ---------- School Yard activities ----------
const activityUrl = (teamId) => `/desk/activity?team=${teamId}`;
app.get('/desk/challenge', requireRole('desk'), (req, res) => res.redirect(302, '/desk/activity'));

app.get('/desk/activity', requireRole('desk'), (req, res) => {
  const state = loadState();
  const team = state.teamById.get(req.query.team) || null;
  noStore(res);
  res.send(activityPage(state, req.user, { team, query: req.query, log: team ? activityLog(team.id) : [] }));
});

const activityLog = (teamId) => all('SELECT * FROM activity_log WHERE team_id = ? ORDER BY id DESC LIMIT 40', teamId);

// Quick entry from the overview table: points per showdown typed straight into the cells of one row.
// A result recorded in detail (players, spectators, booth sheet) is never replaced from here, and a cell whose
// version is out of date is refused so a second booth cannot be overwritten.
app.post('/desk/activity-quick/:team', requireRole('desk'), (req, res) => {
  const state = loadState();
  const team = state.teamById.get(req.params.team);
  if (!team) return res.status(404).send('School not found.');
  const cur = state.teamById.has(req.body.cur) ? req.body.cur : team.id;
  const stored = new Map(state.activityRows.filter((r) => r.team_id === team.id).map((r) => [`${r.station}:${r.slot}`, r]));
  const errors = [];
  const writes = [];
  for (const st of STATIONS) for (const slot of slotsFor(st)) {
    const field = `q_${st.id}_${slot}`;
    if (req.body[field] === undefined) continue; // a locked cell sends nothing
    const had = stored.get(`${st.id}:${slot}`);
    if (had && (had.held || !had.raw?.quick)) continue;
    const q = readQuick(st.id, req.body[field]);
    if (q.error) { errors.push(slot ? `${q.error} (showdown ${slot})` : q.error); continue; }
    if (q.blank && !had) continue;
    if (!q.blank && had && had.score === q.score) continue;
    if (String(had ? had.updated_at : 0) !== String(req.body[`qv_${st.id}_${slot}`] ?? '0')) {
      errors.push(`${st.name}${slot ? ` showdown ${slot}` : ''} was saved from another device while this page was open. Reload to see it.`);
      continue;
    }
    writes.push(q.blank ? { st, slot, action: 'removed' } : { st, slot, action: had ? 'corrected' : 'recorded', score: q.score, raw: JSON.stringify(q.raw) });
  }
  // Starting points are an admin's to set.
  let bonus;
  let bonusChanged = false;
  const hadBonus = state.bonusByTeam.has(team.id) ? state.bonusByTeam.get(team.id) : null;
  if (req.user.role === 'admin' && req.body.q_bonus !== undefined) {
    const v = String(req.body.q_bonus).trim().replace(',', '.');
    if (v === '') bonus = null;
    else if (!/^\d+(\.\d+)?$/.test(v) || Number(v) > BONUS_MAX || !Number.isInteger(Number(v) * 2)) errors.push(`Starting points: 0 to ${BONUS_MAX} in steps of 0.5.`);
    else bonus = Number(v);
    bonusChanged = bonus !== undefined && bonus !== hadBonus;
  }
  if (errors.length) return back(res, `/desk/activity?team=${cur}#yard-all`, 'err', `${team.name}: nothing was saved. ${errors.join(' ')}`);
  const now = Date.now();
  const log = (station, slot, action, score, rawJson) => run('INSERT INTO activity_log (team_id, station, slot, action, score, raw, by_user, by_email, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', team.id, station, slot, action, score, rawJson, req.user.id, req.user.email, now);
  tx(() => {
    for (const w of writes) {
      if (w.action === 'removed') { run('DELETE FROM activity WHERE team_id = ? AND station = ? AND slot = ?', team.id, w.st.id, w.slot); log(w.st.id, w.slot, 'removed', null, null); continue; }
      run('INSERT INTO activity (team_id, station, slot, score, raw, held, by_user, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?) ON CONFLICT(team_id, station, slot) DO UPDATE SET score = excluded.score, raw = excluded.raw, by_user = excluded.by_user, updated_at = excluded.updated_at', team.id, w.st.id, w.slot, w.score, w.raw, req.user.id, now, now);
      log(w.st.id, w.slot, w.action, w.score, w.raw);
    }
    if (bonusChanged) {
      if (bonus === null) run('DELETE FROM bonus WHERE team_id = ?', team.id);
      else run('INSERT INTO bonus (team_id, points, by_user, at) VALUES (?, ?, ?, ?) ON CONFLICT(team_id) DO UPDATE SET points = excluded.points, by_user = excluded.by_user, at = excluded.at', team.id, bonus, req.user.id, now);
      log('bonus', 0, bonus === null ? 'removed' : hadBonus === null ? 'recorded' : 'corrected', bonus, null);
    }
  });
  const n = writes.length + (bonusChanged ? 1 : 0);
  const fresh = loadState().yardByTeam.get(team.id);
  back(res, `/desk/activity?team=${cur}#yard-all`, 'msg', n ? `${team.name}: saved ${n} change${n === 1 ? '' : 's'}. School Yard so far ${fmtPoints(fresh.banked)} from ${fresh.entered} of ${fresh.needed} results.` : `${team.name}: nothing had changed.`);
});

// One save for the whole school: every attempt that was typed in, plus the School Spirit bonus.
// Rows left empty stay pending. Nothing is saved unless every typed row is valid.
app.post('/desk/activity/:team', requireRole('desk'), (req, res) => {
  const state = loadState();
  const team = state.teamById.get(req.params.team);
  if (!team) return res.status(404).send('School not found.');
  const mine = state.activityRows.filter((r) => r.team_id === team.id);
  const stored = new Map(mine.map((r) => [`${r.station}:${r.slot}`, r]));
  const playerIds = new Set(team.regulars.map((p) => p.id));
  const fieldsOf = (st, slot) => Object.fromEntries(FIELDS[st.id].map((k) => [k, req.body[`a_${st.id}_${slot}_${k}`]]));
  const errors = [];
  const writes = [];
  // Satu Satu: nobody may take a second official turn for the same school, in either role.
  const satuPeople = new Map();
  const satu = STATIONS.find((st) => st.id === 'satu');
  for (const slot of slotsFor(satu)) {
    const f = fieldsOf(satu, slot);
    const removing = Boolean(req.body[`del_satu_${slot}`]);
    const src = removing ? null : !isBlank('satu', f) ? f : stored.get(`satu:${slot}`)?.raw;
    if (src) satuPeople.set(slot, [personKey(src.hopper), personKey(src.scooper)].filter(Boolean));
  }
  for (const st of STATIONS) for (const slot of slotsFor(st)) {
    const key = `${st.id}:${slot}`;
    const had = stored.get(key);
    // Each row carries the version this device last saw. If another device saved the slot since, this save must not
    // overwrite it: the desk reloads, sees the other entry, and corrects it on purpose if it really is wrong.
    const seen = String(req.body[`v_${st.id}_${slot}`] ?? '0');
    const stale = String(had ? had.updated_at : 0) !== seen;
    const clash = () => errors.push(`${st.name}${slot ? ` showdown ${slot}` : ''} was saved from another device while this page was open. Reload the page to see that entry before changing it.`);
    if (req.body[`del_${st.id}_${slot}`]) { if (had) { if (stale) clash(); else writes.push({ st, slot, action: 'removed', had }); } continue; }
    const f = fieldsOf(st, slot);
    if (isBlank(st.id, f)) continue;
    const hold = req.body[`hold_${st.id}_${slot}`] ? 1 : 0;
    // A recorded row sends its stored values back untouched: that is not a correction.
    if (had) {
      const was = fieldsFromRaw(st.id, had.raw);
      if ((had.held || 0) === hold && FIELDS[st.id].every((k) => String(f[k] ?? '').trim() === String(was[k] ?? ''))) continue;
    }
    if (stale) { clash(); continue; }
    const usedPeople = new Set([...satuPeople].filter(([other]) => other !== slot).flatMap(([, names]) => names));
    const r = readAttempt(st.id, f, { playerIds, usedPeople });
    if (r.error) { errors.push(slot ? `Showdown ${slot}. ${r.error}` : r.error); continue; }
    const raw = JSON.stringify(r.raw);
    if (had && JSON.stringify(had.raw) === raw && (had.held || 0) === hold) continue;
    writes.push({ st, slot, action: had ? (had.held && !hold ? 'released' : !had.held && hold ? 'held' : 'corrected') : hold ? 'recorded, held' : 'recorded', had, score: r.score, raw, hold });
  }
  if (errors.length) {
    noStore(res);
    return res.status(422).send(activityPage(state, req.user, { team, query: { err: `Nothing was saved. ${errors.join(' ')}` }, log: activityLog(team.id), draft: req.body }));
  }
  const now = Date.now();
  const log = (station, slot, action, score, raw) => run('INSERT INTO activity_log (team_id, station, slot, action, score, raw, by_user, by_email, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', team.id, station, slot, action, score, raw, req.user.id, req.user.email, now);
  tx(() => {
    for (const w of writes) {
      if (w.action === 'removed') {
        run('DELETE FROM activity WHERE team_id = ? AND station = ? AND slot = ?', team.id, w.st.id, w.slot);
        log(w.st.id, w.slot, 'removed', null, null);
      } else {
        run('INSERT INTO activity (team_id, station, slot, score, raw, held, by_user, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(team_id, station, slot) DO UPDATE SET score = excluded.score, raw = excluded.raw, held = excluded.held, by_user = excluded.by_user, updated_at = excluded.updated_at',
        team.id, w.st.id, w.slot, w.score, w.raw, w.hold, req.user.id, now, now);
        log(w.st.id, w.slot, w.action, w.score, w.raw);
      }
    }
  });
  const n = writes.length;
  const fresh = loadState().yardByTeam.get(team.id);
  back(res, activityUrl(team.id), 'msg', n
    ? `Saved ${n} change${n === 1 ? '' : 's'} for ${team.name}. School Yard so far: ${fmtPoints(fresh.banked)} points from ${fresh.entered} of ${fresh.needed} results.`
    : 'Nothing had changed.');
});

// ---------- School Yard Champion ledger ----------
const awardKey = (name, id) => (id ? `id:${id.toLowerCase().replace(/\s+/g, '')}` : `name:${personKey(name)}`);
function awardContext(teamId) {
  const counts = new Map();
  for (const r of all('SELECT team_id, COUNT(DISTINCT person_key) AS people, COUNT(*) AS records FROM award GROUP BY team_id')) counts.set(r.team_id, r);
  return {
    counts,
    records: teamId ? all('SELECT * FROM award WHERE team_id = ? ORDER BY person, id', teamId) : [],
    log: teamId ? all('SELECT * FROM award_log WHERE team_id = ? ORDER BY id DESC LIMIT 60', teamId) : [],
  };
}
app.get('/desk/award', requireRole('desk'), (req, res) => {
  const state = loadState();
  const team = state.teamById.get(req.query.team) || null;
  noStore(res);
  res.send(awardPage(state, req.user, { team, query: req.query, ...awardContext(team?.id) }));
});

// Saves the typed lines of a school's person ledger. Each person may have one record at each station for the whole
// event, whichever school they are entered under, so a second record for the same person and station is refused.
app.post('/desk/award/:team', requireRole('desk'), (req, res) => {
  const state = loadState();
  const team = state.teamById.get(req.params.team);
  if (!team) return res.status(404).send('School not found.');
  const kinds = new Set(AWARD_KINDS.map(([k]) => k));
  const errors = [];
  const adds = [];
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    if (req.body[`p_${i}`] === undefined) break;
    const person = String(req.body[`p_${i}`] || '').trim().slice(0, 80);
    const id = String(req.body[`id_${i}`] || '').trim().slice(0, 40);
    const results = AWARD_STATIONS.map((st) => [st, String(req.body[`r_${i}_${st.id}`] || '').trim().slice(0, 40)]).filter(([, v]) => v);
    if (!person && !results.length) continue;
    if (!person) { errors.push(`Line ${i + 1} has a result but no name.`); continue; }
    if (!results.length) { errors.push(`Line ${i + 1} (${person}) has no station result.`); continue; }
    const kind = kinds.has(req.body[`k_${i}`]) ? req.body[`k_${i}`] : 'unverified';
    const key = awardKey(person, id);
    for (const [st, rawResult] of results) {
      const dup = `${key}|${st.id}`;
      const had = get('SELECT a.*, t.name AS team_name FROM award a JOIN teams t ON t.id = a.team_id WHERE a.person_key = ? AND a.station = ?', key, st.id);
      if (had) errors.push(`${person} already has a ${st.name} record (${had.raw}, entered under ${had.team_name}). A person is credited once per station.`);
      else if (seen.has(dup)) errors.push(`${person} appears twice for ${st.name} on this page.`);
      else adds.push({ person, key, kind, st, rawResult, ref: String(req.body[`ref_${i}`] || '').trim().slice(0, 40) || null });
      seen.add(dup);
    }
  }
  if (errors.length) {
    noStore(res);
    return res.status(422).send(awardPage(state, req.user, { team, query: { err: `Nothing was saved. ${errors.join(' ')}` }, ...awardContext(team.id), draft: req.body }));
  }
  const now = Date.now();
  tx(() => {
    for (const a of adds) {
      run('INSERT INTO award (team_id, person, person_key, kind, station, raw, ref, by_user, by_email, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', team.id, a.person, a.key, a.kind, a.st.id, a.rawResult, a.ref, req.user.id, req.user.email, now);
      run('INSERT INTO award_log (action, team_id, person, station, raw, by_email, at) VALUES (?, ?, ?, ?, ?, ?, ?)', 'Recorded', team.id, a.person, a.st.id, a.rawResult, req.user.email, now);
    }
  });
  back(res, `/desk/award?team=${team.id}`, 'msg', adds.length ? `Saved ${adds.length} record${adds.length === 1 ? '' : 's'} for ${team.name}. Credit stays pending.` : 'Nothing was typed in.');
});

app.post('/admin/award/:id/delete', requireRole('admin'), (req, res) => {
  const r = get('SELECT * FROM award WHERE id = ?', Number(req.params.id));
  if (!r) return res.status(404).send('Record not found.');
  tx(() => {
    run('DELETE FROM award WHERE id = ?', r.id);
    run('INSERT INTO award_log (action, team_id, person, station, raw, by_email, at) VALUES (?, ?, ?, ?, ?, ?, ?)', 'Removed', r.team_id, r.person, r.station, r.raw, req.user.email, Date.now());
  });
  back(res, `/desk/award?team=${r.team_id}`, 'msg', 'Record removed. It stays in the change list.');
});

// ---------- Gold Americano (separate individual event) ----------
app.get('/desk/americano', requireRole('desk'), (req, res) => { noStore(res); res.send(americanoPage(loadAmericano(), req.user, req.query)); });

app.post('/desk/americano/scores', requireRole('desk'), (req, res) => {
  const am = loadAmericano();
  const changes = [];
  for (const m of am.matches) {
    if (req.body[`a_${m.id}`] === undefined) continue;
    const ra = String(req.body[`a_${m.id}`] ?? '').trim();
    const rb = String(req.body[`b_${m.id}`] ?? '').trim();
    if (ra === '' && rb === '') { if (m.status === 'done') changes.push({ m, a: null, b: null }); continue; }
    const a = /^\d+$/.test(ra) ? Number(ra) : NaN;
    const b = /^\d+$/.test(rb) ? Number(rb) : NaN;
    const err = amValidate(a, b);
    if (err) return back(res, '/desk/americano', 'err', `Round ${m.round}: ${err} Nothing was saved.`);
    if (m.score_a !== a || m.score_b !== b) changes.push({ m, a, b });
  }
  const now = Date.now();
  tx(() => { for (const c of changes) run('UPDATE am_matches SET score_a = ?, score_b = ?, status = ?, updated_at = ? WHERE id = ?', c.a, c.b, c.a === null ? 'scheduled' : 'done', now, c.m.id); });
  back(res, '/desk/americano', 'msg', changes.length ? `Saved ${changes.length} match${changes.length === 1 ? '' : 'es'}.` : 'Nothing had changed.');
});

app.post('/admin/americano/players', requireRole('admin'), (req, res) => {
  const teams = new Set(all('SELECT id FROM teams').map((t) => t.id));
  const inRounds = new Set(all('SELECT a1, a2, b1, b2, bye FROM am_matches').flatMap((m) => [m.a1, m.a2, m.b1, m.b2, m.bye]));
  const read = (id) => ({ name: String(req.body[`name_${id}`] || '').trim().slice(0, 60), label: String(req.body[`label_${id}`] || '').trim().slice(0, 40) || null, team: teams.has(req.body[`team_${id}`]) ? req.body[`team_${id}`] : null });
  const players = all('SELECT * FROM am_players');
  for (const p of players) if (req.body[`del_${p.id}`] && inRounds.has(p.id)) return back(res, '/desk/americano', 'err', `${p.name} is in the rounds. Create the rounds again without them first, or just rename this player. Nothing was saved.`);
  tx(() => {
    for (const p of players) {
      if (req.body[`del_${p.id}`]) { run('DELETE FROM am_players WHERE id = ?', p.id); continue; }
      const v = read(p.id);
      if (v.name) run('UPDATE am_players SET name = ?, label = ?, team_id = ? WHERE id = ?', v.name, v.label, v.team, p.id);
    }
    const n = read('new');
    if (n.name) run('INSERT INTO am_players (name, label, team_id, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM am_players))', n.name, n.label, n.team);
  });
  back(res, '/desk/americano', 'msg', 'Players saved.');
});

app.post('/admin/americano/generate', requireRole('admin'), (req, res) => {
  const ids = all('SELECT id FROM am_players ORDER BY sort, id').map((p) => p.id);
  if (ids.length === 4 && !req.body.four) return back(res, '/desk/americano', 'err', 'With four players the format is only a draft. Tick the box to confirm the committee agreed to it.');
  const rounds = amSchedule(ids);
  if (!rounds) return back(res, '/desk/americano', 'err', 'The event needs five players, or four for the draft format.');
  tx(() => {
    run('DELETE FROM am_matches');
    for (const r of rounds) run('INSERT INTO am_matches (round, a1, a2, b1, b2, bye) VALUES (?, ?, ?, ?, ?, ?)', r.round, r.a[0], r.a[1], r.b[0], r.b[1], r.bye);
    setSetting('am_winner', '');
    setSetting('am_runner', '');
  });
  back(res, '/desk/americano', 'msg', `${rounds.length} rounds created.`);
});

app.post('/admin/americano/placing', requireRole('admin'), (req, res) => {
  const am = loadAmericano();
  if (!am.board.finished) return back(res, '/desk/americano', 'err', 'Enter every match first.');
  const w = Number(req.body.winner) || null;
  const r = Number(req.body.runner) || null;
  if (!w && !r) { setSetting('am_winner', ''); setSetting('am_runner', ''); return back(res, '/desk/americano', 'msg', 'Back to the placing from the table.'); }
  if (!am.byId.has(w) || !am.byId.has(r) || w === r) return back(res, '/desk/americano', 'err', 'Choose two different players as winner and runner-up.');
  setSetting('am_winner', w);
  setSetting('am_runner', r);
  back(res, '/desk/americano', 'msg', `Confirmed: ${am.byId.get(w).name} wins, ${am.byId.get(r).name} is runner-up.`);
});

// ---------- Admin ----------
const admin = requireRole('admin');

app.get('/admin', admin, (req, res) => {
  noStore(res);
  res.send(adminPage(loadState(), req.user, { tab: req.query.tab, users: all('SELECT * FROM users ORDER BY role, team_id, email'), origin: linkBase(req), query: req.query, visibility: visibility() }));
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

// Starting points from the pre-event social challenge: one number per school, set before match day.
app.post('/admin/bonus', admin, (req, res) => {
  const teams = all('SELECT id, name FROM teams ORDER BY sort');
  const next = [];
  for (const t of teams) {
    if (req.body[`b_${t.id}`] === undefined) continue;
    const v = String(req.body[`b_${t.id}`]).trim().replace(',', '.');
    if (v === '') { next.push([t, null]); continue; }
    const n = Number(v);
    if (!/^\d+(\.\d+)?$/.test(v) || n > BONUS_MAX || !Number.isInteger(n * 2)) return back(res, '/admin?tab=setup#bonus', 'err', `${t.name}: enter 0 to ${BONUS_MAX} in steps of 0.5, or leave it empty. Nothing was saved.`);
    next.push([t, n]);
  }
  const had = new Map(all('SELECT team_id, points FROM bonus').map((b) => [b.team_id, b.points]));
  const now = Date.now();
  let changed = 0;
  tx(() => {
    for (const [t, n] of next) {
      const was = had.has(t.id) ? had.get(t.id) : null;
      if (was === n) continue;
      changed++;
      if (n === null) run('DELETE FROM bonus WHERE team_id = ?', t.id);
      else run('INSERT INTO bonus (team_id, points, by_user, at) VALUES (?, ?, ?, ?) ON CONFLICT(team_id) DO UPDATE SET points = excluded.points, by_user = excluded.by_user, at = excluded.at', t.id, n, req.user.id, now);
      run('INSERT INTO activity_log (team_id, station, slot, action, score, raw, by_user, by_email, at) VALUES (?, ?, 0, ?, ?, NULL, ?, ?, ?)', t.id, 'bonus', n === null ? 'removed' : was === null ? 'recorded' : 'corrected', n, req.user.id, req.user.email, now);
    }
  });
  back(res, '/admin?tab=setup#bonus', 'msg', changed ? `Starting points saved for ${changed} school${changed === 1 ? '' : 's'}. Standings are updated.` : 'Nothing had changed.');
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
  back(res, '/admin?tab=setup#knockout', notes.length ? 'msg' : 'err', notes.length ? `${notes.join('. ')}.` : 'Nothing to fill yet. Set groups and generate fixtures first.');
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
  const links = users.map((u) => ({ user: u, url: `${linkBase(req)}/auth/${createLoginToken(u.id, ADMIN_LINK_MS)}` }));
  noStore(res);
  res.send(adminPage(loadState(), req.user, { tab: 'people', users, origin: linkBase(req), query: {}, links, visibility: visibility() }));
});

app.post('/admin/security/revoke', admin, (req, res) => {
  const n = revokeAllAccess(req);
  back(res, '/admin?tab=people', 'msg', `Cancelled ${n.links} sign-in link${n.links === 1 ? '' : 's'} and signed out ${n.sessions} device${n.sessions === 1 ? '' : 's'}. Only this device is still signed in.`);
});

// A full copy of the tournament data for backup. Logins, links and sessions are left out.
app.get('/admin/export.json', admin, (req, res) => {
  noStore(res);
  res.set('Content-Disposition', `attachment; filename="bos-scores-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json"`);
  const tables = ['settings', 'teams', 'players', 'showdowns', 'matches', 'lineups', 'tickets', 'activity', 'activity_log', 'bonus', 'award', 'award_log', 'am_players', 'am_matches'];
  res.json({ exported_at: new Date().toISOString(), ...Object.fromEntries(tables.map((t) => [t, all(`SELECT * FROM ${t}`)])) });
});

app.post('/admin/users/:id/link', admin, (req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!u) return res.status(404).send('Not found.');
  const token = createLoginToken(u.id, ADMIN_LINK_MS);
  res.redirect(303, `/admin?tab=people&link=${encodeURIComponent(`${linkBase(req)}/auth/${token}`)}&msg=${encodeURIComponent(`Link created for ${u.email}.`)}`);
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

// Brings the regular players in line with a registration snapshot. Players are matched by their stable registration
// ID, then by portrait file, then by name within the school. Nobody is deleted: a regular who is no longer in the
// snapshot is switched off so past lineups keep their history. Gold Players are left alone. The answer is a change
// report keyed by registration ID.
app.post('/admin/roster/import', admin, express.json({ limit: '1mb' }), (req, res) => {
  const incoming = Array.isArray(req.body?.players) ? req.body.players : null;
  if (!incoming || !incoming.length) return res.status(400).json({ ok: false, error: 'Send { players: [...] }.' });
  const teams = new Set(all('SELECT id FROM teams').map((t) => t.id));
  const levels = ['silver', 'bronze', 'lower_bronze'];
  const clean = [];
  for (const p of incoming) {
    const row = {
      reg_id: String(p.reg_id || '').trim(), team: String(p.team || ''), name: String(p.name || '').trim().slice(0, 60),
      full_name: String(p.full_name || '').trim().slice(0, 120) || null, jersey_name: String(p.jersey_name || '').trim().slice(0, 60) || null,
      gender: p.gender === 'M' || p.gender === 'F' ? p.gender : null, level: p.level, level_pending: p.level_pending ? 1 : 0,
      is_captain: p.is_captain ? 1 : 0, photo: p.photo ? String(p.photo).slice(0, 80) : null,
    };
    if (!row.reg_id || !teams.has(row.team) || !row.name || !levels.includes(row.level)) return res.status(400).json({ ok: false, error: `Record not usable: ${row.reg_id || row.name || '?'}. Nothing was changed.` });
    clean.push(row);
  }
  if (new Set(clean.map((p) => p.reg_id)).size !== clean.length) return res.status(400).json({ ok: false, error: 'The same registration ID appears twice. Nothing was changed.' });
  const report = [];
  tx(() => {
    for (const team of teams) {
      const want = clean.filter((p) => p.team === team);
      if (!want.length) continue;
      const have = all('SELECT * FROM players WHERE team_id = ? AND is_gold = 0 ORDER BY id', team);
      const taken = new Set();
      const find = (test) => have.find((x) => !taken.has(x.id) && test(x));
      const pairs = want.map((p) => [p, find((x) => x.reg_id === p.reg_id)]);
      for (const pr of pairs) if (pr[1]) taken.add(pr[1].id);
      for (const pr of pairs) if (!pr[1] && pr[0].photo) { pr[1] = find((x) => !x.reg_id && x.photo === pr[0].photo) || null; if (pr[1]) taken.add(pr[1].id); }
      for (const pr of pairs) if (!pr[1]) { pr[1] = find((x) => !x.reg_id && x.name.toLowerCase() === pr[0].name.toLowerCase()) || null; if (pr[1]) taken.add(pr[1].id); }
      for (const [p, x] of pairs) {
        if (!x) {
          run('INSERT INTO players (team_id, name, level, level_pending, gender, is_captain, is_gold, active, reg_id, full_name, jersey_name) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)', team, p.name, p.level, p.level_pending, p.gender, p.is_captain, p.reg_id, p.full_name, p.jersey_name);
          report.push({ reg_id: p.reg_id, team, name: p.name, action: 'added', changes: {} });
          continue;
        }
        const next = { name: p.name, level: p.level, level_pending: p.level_pending, gender: p.gender, is_captain: p.is_captain, active: 1, reg_id: p.reg_id, full_name: p.full_name, jersey_name: p.jersey_name };
        const changes = Object.fromEntries(Object.entries(next).filter(([k, v]) => (x[k] ?? null) !== (v ?? null)).map(([k, v]) => [k, { from: x[k] ?? null, to: v ?? null }]));
        if (Object.keys(changes).length) run('UPDATE players SET name = ?, level = ?, level_pending = ?, gender = ?, is_captain = ?, active = 1, reg_id = ?, full_name = ?, jersey_name = ? WHERE id = ?', p.name, p.level, p.level_pending, p.gender, p.is_captain, p.reg_id, p.full_name, p.jersey_name, x.id);
        report.push({ reg_id: p.reg_id, team, name: p.name, action: Object.keys(changes).length ? 'updated' : 'unchanged', changes });
      }
      for (const x of have) {
        if (taken.has(x.id) || !x.active) continue;
        run('UPDATE players SET active = 0 WHERE id = ?', x.id);
        report.push({ reg_id: x.reg_id || null, team, name: x.name, action: 'switched_off', changes: { active: { from: 1, to: 0 } } });
      }
    }
  });
  const count = (a) => report.filter((r) => r.action === a).length;
  res.json({ ok: true, imported_at: new Date().toISOString(), summary: { received: clean.length, unchanged: count('unchanged'), updated: count('updated'), added: count('added'), switched_off: count('switched_off') }, report });
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
  if (VISIBILITY.includes(req.body.visibility)) setSetting('visibility', req.body.visibility);
  back(res, '/admin?tab=settings', 'msg', 'Settings saved.');
});

app.post('/admin/demo', admin, (req, res) => {
  loadDemo();
  back(res, '/admin?tab=settings', 'msg', 'Demo data loaded. Open Live scores or the TV scoreboard to see it.');
});

// Resetting scores needs the word RESET typed in, so it cannot happen from one stray click.
app.post('/admin/reset', admin, (req, res) => {
  if (String(req.body.confirm || '').trim().toUpperCase() !== 'RESET') return back(res, '/admin?tab=settings#reset', 'err', 'Nothing was reset. Type RESET in the box to confirm.');
  const lineups = Boolean(req.body.lineups);
  const yard = Boolean(req.body.yard);
  resetResults({ lineups, yard });
  back(res, '/admin?tab=settings#reset', 'msg', `All match scores were reset${lineups ? ', and lineups and tickets removed' : ''}${yard ? ', and School Yard results and bonuses removed' : ''}.`);
});

// A player's portrait. The browser shrinks the picture to 480 x 600 before sending it.
app.post('/admin/player/:id/photo', admin, express.json({ limit: '2mb' }), (req, res) => {
  const p = get('SELECT * FROM players WHERE id = ?', Number(req.params.id));
  if (!p) return res.status(404).json({ ok: false, text: 'Player not found.' });
  const mine = (name) => name && fs.existsSync(path.join(PHOTO_DIR, path.basename(name)));
  if (req.body?.remove) {
    if (mine(p.photo)) fs.rmSync(path.join(PHOTO_DIR, path.basename(p.photo)), { force: true });
    run('UPDATE players SET photo = NULL WHERE id = ?', p.id);
    return res.json({ ok: true, photo: null, text: 'Photo removed.' });
  }
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.image || ''));
  const buf = m ? Buffer.from(m[1], 'base64') : null;
  if (!buf || buf.length < 500 || buf.length > 900 * 1024 || buf[0] !== 0xff || buf[1] !== 0xd8) return res.status(422).json({ ok: false, text: 'That file could not be used. Choose a JPEG or PNG photo.' });
  const name = `p${p.id}-${Date.now().toString(36)}.jpg`;
  fs.writeFileSync(path.join(PHOTO_DIR, name), buf);
  if (mine(p.photo)) fs.rmSync(path.join(PHOTO_DIR, path.basename(p.photo)), { force: true });
  run('UPDATE players SET photo = ? WHERE id = ?', name, p.id);
  res.json({ ok: true, photo: `/assets/players/${name}`, text: 'Photo saved.' });
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
backfillPhotos();
// Existing databases start private: the organizer opens the site from Admin > Settings.
if (!getSetting('visibility')) setSetting('visibility', 'staff');
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
  if (isProd && !mailConfigured()) console.log('Email is not configured (RESEND_API_KEY and MAIL_FROM). Sign-in links can only be created by an admin.');
});
