import { CATEGORY_LABEL, STAGE_LABEL } from '../rules.js';

// ---------- Escaping template helper ----------
export class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s));
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const render = (v) => {
  if (v == null || v === false || v === true) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
};
/** Tagged template: every interpolated value is HTML-escaped unless it is already Raw. */
export function h(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += render(vals[i]); });
  return new Raw(out);
}

// ---------- Icons (same paths as battleofschools.id) ----------
const svg = (inner) => raw(`<svg class="school-sport-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`);
const racket = '<path d="m3 20 5.1-5.1m-.1-.1c-1.7-1.7-1.5-4.7.5-6.7s4.9-2.2 6.6-.5c1.7 1.7 1.5 4.7-.5 6.7-2 2-4.9 2.2-6.6.5Z"/><path d="M10 12h.01m2.3-2.3h.01"/>';
export const ICON = {
  men: svg(`${racket}<circle cx="18" cy="7" r="2.8"/><path d="m20 5 2-2m-3 0h3v3"/>`),
  women: svg(`${racket}<circle cx="18.6" cy="12" r="2.8"/><path d="M18.6 15v6m-2-2h4"/>`),
  open: svg(`${racket}<circle cx="19.2" cy="5" r="2.5"/><path d="M17.7 3.5c1.8.3 2.6 1.2 2.9 3"/>`),
  trophy: svg('<path d="M7 4h10v5a5 5 0 0 1-10 0V4Zm0 2H3v2a4 4 0 0 0 4.6 4M17 6h4v2a4 4 0 0 1-4.6 4M12 14v5m-4 1h8"/>'),
  captain: svg('<path d="M5 21V4m0 1h13l-3 4 3 4H5"/><path d="m8.5 9 1.4 1.4 2.6-2.6"/>'),
};

export const LEVEL_LABEL = { silver: 'Silver', bronze: 'Bronze', lower_bronze: 'Lower Bronze', gold: 'Gold' };

export const teamMark = (team) => h`<span class="tournament-team-mark" aria-hidden="true">${
  team ? h`<img class="school-team-mark" src="/assets/crests/${team.id}.svg" width="40" height="40" alt="" decoding="async">` : h`<span>?</span>`
}</span>`;

export const categoryTag = (category) => h`<span class="tournament-fixture-category"><span class="tournament-sport-mark" aria-hidden="true">${ICON[category]}</span><span>${CATEGORY_LABEL[category]}</span></span>`;

export function showdownTitle(sd) {
  if (sd.stage === 'group') return `Round ${sd.round}`;
  if (sd.stage === 'semi') return `Semifinal ${sd.slot + 1}`;
  return STAGE_LABEL[sd.stage] || sd.stage;
}

/** Names of the pair one school fielded, including any Gold Player substitution. Null until both lineups are in. */
export function pairNames(state, m, side) {
  const l = m.lineup[side];
  if (!l || !m.revealed) return null;
  const teamId = side === 'a' ? m.sd.team_a : m.sd.team_b;
  const gold = state.teamById.get(teamId)?.gold;
  const sub = m.tickets.find((t) => t.team_id === teamId && t.type === 'gold_player');
  const goldName = `${gold ? gold.name : 'Gold Player'} ★`;
  return [l.player1, l.player2].map((p) => {
    if (!p) return '?';
    if (sub && sub.player_out === p.id) return sub.timing === 'start' ? goldName : `${p.name} → ${goldName}`;
    return p.name;
  });
}

export function scoreText(m) {
  if (m.score_a == null || m.score_b == null) return null;
  const tb = m.tb_a != null && m.tb_b != null ? ` (${m.tb_a}–${m.tb_b})` : '';
  return `${m.score_a}–${m.score_b}${tb}`;
}

// ---------- Page shell ----------
// Changes on every start, so a new deploy is never served with a browser-cached script or stylesheet.
const ASSET_VERSION = Date.now().toString(36);
export function layout({ title, body, user = null, bodyClass = '', scripts = [], styles = [], bare = false, active = '' }) {
  const nav = [
    ['/', 'Live scores', 'scores'],
    user && (user.role === 'captain' || user.role === 'admin') ? ['/captain', 'Lineups', 'captain'] : null,
    user && (user.role === 'desk' || user.role === 'admin') ? ['/desk', 'Scoring desk', 'desk'] : null,
    user && user.role === 'admin' ? ['/admin', 'Admin', 'admin'] : null,
  ].filter(Boolean);
  const header = bare ? '' : h`
<a class="skip" href="#main">Skip to content</a>
<header class="header">
  <a class="brand" href="/" aria-label="Battle of Schools live scores"><img src="/assets/logo.svg" alt="Battle of Schools" width="280" height="52"></a>
  <nav class="desktop-nav" aria-label="Main navigation">
    ${nav.map(([href, label, key]) => h`<a href="${href}"${active === key ? raw(' aria-current="page"') : ''}>${label}</a>`)}
    ${user
      ? h`<form method="post" action="/logout" class="inline-form"><button class="button small outline" type="submit">Sign out</button></form>`
      : h`<a class="button small lime" href="/login">Team sign in</a>`}
  </nav>
</header>`;
  const footer = bare ? '' : h`
<footer class="footer wrap">
  <div class="footer-top"><img src="/assets/logo.svg" alt="" width="200" height="38" class="footer-logo"><span class="eyebrow">Compete. Connect. Celebrate.</span></div>
  <div class="footer-links"><a href="https://battleofschools.id/">battleofschools.id</a><a href="https://battleofschools.id/homecoming/games/">How the games work</a><a href="/tv">TV scoreboard</a></div>
  <p class="footnote">An event by Cornerstone Collective. Scores are entered by the scoring desk after each match and may be corrected.</p>
</footer>`;
  return String(h`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0D2B55">
<title>${title} | Battle of Schools</title>
<link rel="icon" href="/assets/icon.png">
<link rel="apple-touch-icon" href="/assets/icon.png">
<link rel="preload" href="/assets/poppins-black.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/tournament.css?v=${ASSET_VERSION}">
<link rel="stylesheet" href="/css/app.css?v=${ASSET_VERSION}">
${styles.map((s) => h`<link rel="stylesheet" href="${s}?v=${ASSET_VERSION}">`)}
${scripts.map((s) => h`<script src="${s}?v=${ASSET_VERSION}" defer></script>`)}
</head>
<body class="${bodyClass}">
${header}
${body}
${footer}
</body>
</html>`);
}

export function flash(query) {
  if (query.err) return h`<p class="flash flash-error" role="alert">${query.err}</p>`;
  if (query.msg) return h`<p class="flash flash-ok" role="status">${query.msg}</p>`;
  return '';
}
