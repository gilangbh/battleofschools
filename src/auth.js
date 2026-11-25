import crypto from 'node:crypto';
import { get, run } from './db.js';

const COOKIE = 'bos_sid';
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
export const EMAIL_LINK_MS = 20 * 60 * 1000;
export const ADMIN_LINK_MS = 7 * 24 * 60 * 60 * 1000;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

export const isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);
export const mailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

export function createLoginToken(userId, ttl = EMAIL_LINK_MS) {
  const token = newToken();
  run('INSERT INTO login_tokens (hash, user_id, expires_at) VALUES (?, ?, ?)', sha(token), userId, Date.now() + ttl);
  return token;
}

export function peekLoginToken(token) {
  const row = get('SELECT * FROM login_tokens WHERE hash = ?', sha(token));
  if (!row || row.used || row.expires_at < Date.now()) return null;
  return row;
}

export function consumeLoginToken(token) {
  const row = peekLoginToken(token);
  if (!row) return null;
  run('UPDATE login_tokens SET used = 1 WHERE hash = ?', row.hash);
  return row.user_id;
}

export function startSession(req, res, userId) {
  const token = newToken();
  run('INSERT INTO sessions (hash, user_id, expires_at) VALUES (?, ?, ?)', sha(token), userId, Date.now() + SESSION_MS);
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure}`);
}

export function endSession(req, res) {
  const token = readCookie(req);
  if (token) run('DELETE FROM sessions WHERE hash = ?', sha(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function readCookie(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

/** Cancels every sign-in link and signs out every device except the one making the request. */
export function revokeAllAccess(req) {
  const mine = readCookie(req);
  const links = run('DELETE FROM login_tokens').changes;
  const sessions = run('DELETE FROM sessions WHERE hash != ?', mine ? sha(mine) : '').changes;
  return { links: Number(links), sessions: Number(sessions) };
}

/** Attach req.user when a valid session cookie is present. */
export function sessionMiddleware(req, res, next) {
  req.user = null;
  const token = readCookie(req);
  if (token) {
    const s = get('SELECT * FROM sessions WHERE hash = ?', sha(token));
    if (s && s.expires_at > Date.now()) req.user = get('SELECT * FROM users WHERE id = ?', s.user_id) || null;
  }
  next();
}

/** Reject state-changing requests that come from another site. */
export function sameOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch { /* malformed origin */ }
    if (host !== req.headers.host) return res.status(403).send('Cross-site request blocked.');
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    if (req.user.role === 'admin' || roles.includes(req.user.role)) return next();
    res.status(403).send('You do not have access to this page.');
  };
}

/** Send the login link by email through Resend when configured. Returns true if an email was sent. */
export async function sendLoginEmail(email, url) {
  if (!mailConfigured()) {
    console.log(`[login link for ${email}] ${url}`);
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to: [email],
      subject: 'Your Battle of Schools login link',
      text: `Open this link to sign in to Battle of Schools scores:\n\n${url}\n\nThe link works once and expires in 20 minutes. If you did not ask for it, ignore this email.`,
    }),
  });
  if (!res.ok) {
    console.error('Login email failed', res.status, await res.text());
    throw new Error('The login email could not be sent.');
  }
  console.log('Login email accepted by the mail service');
  return true;
}

// Small in-memory limiter for the login form.
const attempts = new Map();
export function rateLimited(key, max = 8, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  attempts.set(key, list);
  return list.length > max;
}
