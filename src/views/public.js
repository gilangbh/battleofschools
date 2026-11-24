import { h, raw, layout, teamMark, categoryTag, pairNames, showdownTitle, ICON, flash } from './ui.js';
import { CATEGORY_LABEL, STAGE_LABEL, matchWinner, isKnockout } from '../rules.js';

const PLACE_LABEL = { qualified: 'Semifinal place', provisional: 'In the top two for now', tied: 'Level on points: committee decides' };
const pairLine = (names) => (names ? h`<small class="pair">${names.join(' / ')}</small>` : '');

function scoreCell(state, m, side) {
  const score = side === 'a' ? m.score_a : m.score_b;
  const tb = side === 'a' ? m.tb_a : m.tb_b;
  const lead = matchWinner(m) === side;
  const value = score == null ? '–' : score;
  return h`<td class="${lead ? 'tournament-leading' : ''}"><span class="score-num">${value}${tb != null ? h`<sup>${tb}</sup>` : ''}</span>${pairLine(pairNames(state, m, side))}</td>`;
}

function fixtureMeta(sd) {
  const bits = [sd.start_time, sd.court].filter(Boolean);
  return bits.length ? h`<p class="fixture-meta">${bits.join(' · ')}</p>` : '';
}

/** One school-v-school card, in the same table layout as the 2025 results on battleofschools.id. */
export function fixtureCard(state, sd) {
  const s = sd.summary;
  const ko = isKnockout(sd.stage);
  const teamHead = (team) => h`<span class="tournament-fixture-team">${teamMark(team)}<span>${team ? team.name : 'To be decided'}</span></span>`;
  const totalA = ko ? s.catsA : s.gamesA;
  const totalB = ko ? s.catsB : s.gamesB;
  return h`<li class="tournament-fixture" data-teams="${[sd.team_a, sd.team_b].filter(Boolean).join(' ')}">
  ${fixtureMeta(sd)}
  <table class="tournament-fixture-score">
    <thead><tr>
      <th scope="col">${teamHead(sd.a)}</th>
      <th scope="col">${ko ? 'Games' : 'Games won'}</th>
      <th scope="col">${teamHead(sd.b)}</th>
    </tr></thead>
    <tbody>
      ${sd.matches.map((m) => h`<tr class="${m.status === 'live' ? 'is-live' : ''}">
        ${scoreCell(state, m, 'a')}
        <th scope="row">${categoryTag(m.category)}${m.status === 'live' ? h`<span class="live-pill">On court${m.court ? h` · ${m.court}` : ''}</span>` : ''}</th>
        ${scoreCell(state, m, 'b')}
      </tr>`)}
    </tbody>
    ${s.done > 0 ? h`<tfoot><tr>
      <td class="${totalA > totalB ? 'tournament-leading' : ''}">${totalA}</td>
      <th scope="row">${ko ? h`Categories won<small class="ko-games">Games ${s.gamesA}–${s.gamesB}</small>${s.complete ? h`<small class="ko-games">${s.winner ? `Winner: ${(s.winner === 'a' ? sd.a : sd.b)?.name}` : 'Result to be confirmed'}</small>` : ''}` : s.complete ? 'Total' : 'Total so far'}</th>
      <td class="${totalB > totalA ? 'tournament-leading' : ''}">${totalB}</td>
    </tr></tfoot>` : ''}
  </table>
</li>`;
}

function liveCard(state, m) {
  const sd = m.sd;
  const side = (team, s) => {
    const score = s === 'a' ? m.score_a : m.score_b;
    return h`<div class="live-side">${teamMark(team)}<div class="live-team"><strong>${team ? team.name : 'TBD'}</strong>${pairLine(pairNames(state, m, s))}</div><span class="live-score" data-k="m${m.id}${s}">${score == null ? 0 : score}</span></div>`;
  };
  return h`<li class="live-card">
  <p class="live-card-head"><span class="live-court">${m.court || 'Court to be confirmed'}</span><span>${showdownTitle(sd)}</span></p>
  <p class="live-card-cat">${categoryTag(m.category)}</p>
  ${side(sd.a, 'a')}${side(sd.b, 'b')}
</li>`;
}

function standingsTable(group, rows, showChallenge) {
  return h`<table class="tournament-table">
  <caption>Group ${group}</caption>
  <thead><tr>
    <th scope="col">School</th><th scope="col">W–L</th><th scope="col">Games</th>
    ${showChallenge ? h`<th scope="col">Challenge</th>` : ''}<th scope="col">Total</th>
  </tr></thead>
  <tbody>${rows.map((r) => h`<tr class="${r.place === 'qualified' || r.place === 'provisional' ? 'tournament-qualified' : r.place === 'tied' ? 'is-tied' : ''}" data-teams="${r.team.id}">
    <th scope="row"><span class="tournament-table-team">${teamMark(r.team)}<span>${r.team.name}${r.place ? h`<small>${PLACE_LABEL[r.place]}</small>` : ''}</span></span></th>
    <td>${r.won}–${r.lost}</td><td>${r.games}</td>
    ${showChallenge ? h`<td>${r.challenge.toFixed(1)}</td>` : ''}<td><strong>${showChallenge ? r.total.toFixed(1) : r.total}</strong></td>
  </tr>`)}</tbody>
</table>`;
}

function champion(state) {
  const final = state.showdowns.find((s) => s.stage === 'final');
  if (!final || !final.summary.winner || !final.summary.complete) return '';
  const win = final.summary.winner === 'a' ? final.a : final.b;
  const lose = final.summary.winner === 'a' ? final.b : final.a;
  return h`<ol class="tournament-podium champion-podium">
  <li><div class="tournament-place place-1"><span class="tournament-place-top"><span class="tournament-place-number">1</span>${teamMark(win)}</span><span class="tournament-place-label"><span class="tournament-sport-mark">${ICON.trophy}</span>2026 Champion</span><strong>${win.name}</strong><small>${win.school}</small></div></li>
  <li><div class="tournament-place place-2"><span class="tournament-place-top"><span class="tournament-place-number">2</span>${teamMark(lose)}</span><span class="tournament-place-label">Runner-up</span><strong>${lose.name}</strong><small>${lose.school}</small></div></li>
</ol>`;
}

/** The part of the public page that is swapped in place whenever a score changes. */
export function publicPartial(state) {
  const showChallenge = state.stations.length > 0;
  const groupRounds = [...new Set(state.showdowns.filter((s) => s.stage === 'group').map((s) => s.round))];
  const koWithTeams = state.knockout.filter((sd) => sd.a && sd.b);
  const anyResults = state.allMatches.some((m) => m.status !== 'scheduled');
  // Open the round that is in play; before the first score, open round 1.
  const activeRound = (() => {
    for (const r of groupRounds) {
      const sds = state.showdowns.filter((s) => s.stage === 'group' && s.round === r);
      if (sds.some((s) => !s.summary.complete)) return r;
    }
    return groupRounds[groupRounds.length - 1];
  })();

  return h`
${champion(state)}
<section id="live" aria-labelledby="live-h">
  <h2 id="live-h">On court now</h2>
  ${state.live.length
    ? h`<ul class="live-grid" role="list">${state.live.map((m) => liveCard(state, m))}</ul>`
    : h`<p class="quiet-note">${anyResults ? 'No matches are on court right now.' : `Matches start on ${state.settings.event_date} at ${state.settings.venue}. Scores appear here as each match finishes.`}</p>`}
</section>

<section id="standings" aria-labelledby="standings-h">
  <h2 id="standings-h">Group standings</h2>
  ${state.groupsSet
    ? h`<p class="footnote">One point per game won${showChallenge ? ', plus Festival Challenge points' : ''}. Top two in each group reach the semifinals. Places are confirmed when the group stage ends.</p>
      <div class="tournament-groups">${['A', 'B'].filter((g) => state.standings[g]).map((g) => standingsTable(g, state.standings[g], showChallenge))}</div>`
    : h`<p class="quiet-note">Groups are set at the live matchup draw on 25 November.</p>
      <ul class="school-chips" role="list">${state.teams.map((t) => h`<li>${teamMark(t)}<span>${t.name}</span></li>`)}</ul>`}
</section>

${groupRounds.length ? h`<section id="matches" aria-labelledby="matches-h">
  <h2 id="matches-h">Group matches</h2>
  <div class="tournament-rounds">
    ${groupRounds.map((r) => {
      const sds = state.showdowns.filter((s) => s.stage === 'group' && s.round === r);
      const done = sds.filter((s) => s.summary.complete).length;
      return h`<details class="tournament-round" data-key="round-${r}"${r === activeRound ? raw(' open') : ''}>
        <summary>Round ${r} <span class="round-count">${done}/${sds.length} finished</span></summary>
        <ul class="tournament-fixtures" role="list">${sds.map((sd) => fixtureCard(state, sd))}</ul>
      </details>`;
    })}
  </div>
</section>` : ''}

${koWithTeams.length ? h`<section id="knockout" aria-labelledby="knockout-h">
  <h2 id="knockout-h">Semifinals and final</h2>
  <p>First pair to six games in each category, with a tiebreak at 5–5. Small numbers show tiebreak points.</p>
  ${koWithTeams.map((sd) => h`<h3 class="ko-title">${showdownTitle(sd)}</h3><ul class="tournament-fixtures ko-fixtures" role="list">${fixtureCard(state, sd)}</ul>`)}
</section>` : state.knockout.length ? h`<section id="knockout" aria-labelledby="knockout-h">
  <h2 id="knockout-h">Semifinals and final</h2>
  <p class="quiet-note">The top two schools in each group meet in the semifinals once the group stage is finished.</p>
</section>` : ''}
`;
}

function sponsorStrip() {
  return h`<section class="score-sponsors" aria-label="Event sponsors">
      <div class="sponsor-unit sponsor-unit-gold"><span class="sponsor-role">Gold Sponsor</span><div class="gold-mark-pair" aria-label="JAPFA Food and TOKUSEN, one Gold partner"><img class="sponsor-japfa-logo" src="/assets/sponsors/japfa-food-navy.png" alt="JAPFA Food" width="120" height="36"><img class="sponsor-tokusen-logo" src="/assets/sponsors/tokusen-navy.png" alt="TOKUSEN" width="144" height="44"></div></div>
      <div class="sponsor-unit sponsor-unit-silver"><span class="sponsor-role">Silver Sponsor</span><img class="sponsor-silver-logo" src="/assets/sponsors/sucor-sekuritas-navy.png" alt="Sucor Sekuritas" width="190" height="38"></div>
    </section>`;
}

export function publicPage(state, user) {
  const body = h`
<main id="main" class="tournament-results">
  <div class="tournament-hero">
    <div class="wrap">
      <p class="eyebrow">${state.settings.event_title} · ${state.settings.event_date} · ${state.settings.venue}</p>
      <div class="tournament-heading"><h1>Live scores</h1><span class="conn" id="conn" data-state="connecting">Connecting…</span></div>
    </div>
  </div>
  <nav class="tournament-nav" aria-label="Sections"><div class="wrap">
    <a href="#live">On court</a><a href="#standings">Standings</a><a href="#matches">Matches</a><a href="#knockout">Finals</a>
  </div></nav>
  <div class="wrap tournament-body">
    ${sponsorStrip()}
    <div class="follow"><label for="team-filter">Follow</label><select id="team-filter"><option value="">All schools</option>${state.teams.map((t) => h`<option value="${t.id}">${t.name}</option>`)}</select></div>
    <div id="live-region" data-src="/partial/public">${publicPartial(state)}</div>
  </div>
</main>`;
  return layout({ title: 'Live scores', body, user, scripts: ['/js/live.js'], styles: ['/css/sponsors.css'], active: 'scores', mediaCredit: true });
}

// ---------- TV scoreboard ----------

const SHORT_CAT = { men: 'Men’s', women: 'Women’s', open: 'Open' };
const courtNumber = (court) => (String(court).match(/\d+/) || [''])[0];

/** The two people on court for one side, with portraits. Null until both lineups are in. */
function onCourt(state, m, side) {
  const l = m.lineup[side];
  if (!l || !m.revealed) return null;
  const team = side === 'a' ? m.sd.a : m.sd.b;
  const sub = m.tickets.find((t) => t.team_id === team.id && t.type === 'gold_player' && t.timing === 'start');
  return [l.player1, l.player2].filter(Boolean).map((p) => {
    if (sub && sub.player_out === p.id) return { name: team.gold ? team.gold.name : 'Gold Player', photo: team.gold?.photo || null, gold: true };
    return { name: p.name, photo: p.photo || null, gold: false };
  });
}

function tvPortraits(team, people) {
  if (!people) return h`<div class="sb-photos is-unknown"><div class="sb-photo is-crest">${teamMark(team)}</div><div class="sb-photo is-crest">${teamMark(team)}</div></div>`;
  return h`<div class="sb-photos">${people.map((p) => h`<figure class="sb-photo${p.gold ? ' is-gold' : ''}">
    ${p.photo ? h`<img src="/assets/players/${p.photo}" alt="" width="480" height="600" decoding="async">` : h`<span class="sb-photo-none">${teamMark(team)}</span>`}
    <figcaption>${p.gold ? '★ ' : ''}${p.name}</figcaption></figure>`)}</div>`;
}

function tvCourt(state, court, live) {
  const m = live || state.live.find((x) => x.court === court);
  const num = courtNumber(court);
  const badge = h`<span class="sb-num">${num || '–'}</span>`;
  if (!m) {
    const next = state.allMatches
      .filter((x) => x.status === 'scheduled' && x.court === court && x.sd.a && x.sd.b)
      .sort((x, y) => x.sd.round - y.sd.round || String(x.sd.start_time || '').localeCompare(String(y.sd.start_time || '')) || x.id - y.id)[0];
    if (!next) return h`<article class="sb-court is-free"><header class="sb-court-head">${badge}<div class="sb-court-title"><b>${court}</b><span>No match right now</span></div></header><p class="sb-ghost" aria-hidden="true">${num}</p></article>`;
    return h`<article class="sb-court is-next">
      <header class="sb-court-head">${badge}<div class="sb-court-title"><b>${court}</b><span>${SHORT_CAT[next.category]} doubles</span></div><span class="sb-chip">Up next${next.sd.start_time ? h` · ${next.sd.start_time}` : ''}</span></header>
      <div class="sb-versus">
        <div class="sb-versus-team">${teamMark(next.sd.a)}<strong>${next.sd.a.name}</strong></div>
        <span class="sb-v">v</span>
        <div class="sb-versus-team">${teamMark(next.sd.b)}<strong>${next.sd.b.name}</strong></div>
      </div>
    </article>`;
  }
  const lead = (m.score_a ?? 0) === (m.score_b ?? 0) ? null : (m.score_a ?? 0) > (m.score_b ?? 0) ? 'a' : 'b';
  const row = (team, side) => {
    const score = side === 'a' ? m.score_a : m.score_b;
    return h`<div class="sb-team${lead === side ? ' is-lead' : ''}">
      ${tvPortraits(team, onCourt(state, m, side))}
      <div class="sb-team-info"><p class="sb-team-name">${teamMark(team)}<strong>${team ? team.name : 'To be decided'}</strong></p>
        <span class="sb-score" data-k="m${m.id}${side}">${score == null ? 0 : score}</span></div>
    </div>`;
  };
  return h`<article class="sb-court is-live">
    <header class="sb-court-head">${badge}<div class="sb-court-title"><b>${court}</b><span>${SHORT_CAT[m.category]} doubles</span></div><span class="sb-chip is-live">Live</span></header>
    ${row(m.sd.a, 'a')}${row(m.sd.b, 'b')}
  </article>`;
}

function tvStandings(state, group) {
  const rows = state.standings[group] || [];
  const showChallenge = state.stations.length > 0;
  return h`<table class="sb-table">
    <caption><span>Group ${group}</span></caption>
    <thead><tr><th></th><th scope="col">School</th><th scope="col">Games</th><th scope="col">${showChallenge ? 'Total' : 'Points'}</th></tr></thead>
    <tbody>${rows.map((r) => h`<tr class="${r.place === 'qualified' || r.place === 'provisional' ? 'is-q' : r.place === 'tied' ? 'is-tied' : ''}"><td class="sb-rank">${r.rank}</td><th scope="row"><span class="sb-name">${teamMark(r.team)}<span>${r.team.name}</span></span></th><td>${r.games}</td><td class="sb-total">${showChallenge ? r.total.toFixed(1) : r.total}</td></tr>`)}</tbody>
  </table>`;
}

function tvKnockout(state) {
  const sds = state.knockout.filter((sd) => sd.a && sd.b);
  if (!sds.length) return '';
  return h`<div class="sb-ko">${sds.map((sd) => {
    const s = sd.summary;
    return h`<div class="sb-ko-card"><p class="sb-ko-title">${showdownTitle(sd)}</p>
      <p class="sb-ko-line ${s.winner === 'a' ? 'is-w' : ''}">${teamMark(sd.a)}<span>${sd.a.name}</span><b>${s.catsA}</b></p>
      <p class="sb-ko-line ${s.winner === 'b' ? 'is-w' : ''}">${teamMark(sd.b)}<span>${sd.b.name}</span><b>${s.catsB}</b></p></div>`;
  })}</div>`;
}

export function tvPartial(state) {
  // Courts in the configured order, plus any live match on a court that is not in the list or has none.
  const stray = state.live.filter((m) => !m.court || !state.courts.includes(m.court));
  const latest = state.recent.slice(0, 10);
  const koActive = state.knockout.some((sd) => sd.a && sd.b);
  const result = (m) => h`<span class="sb-result"><b class="${m.score_a > m.score_b ? 'is-w' : ''}">${m.sd.a?.name} ${m.score_a}</b><i>–</i><b class="${m.score_b > m.score_a ? 'is-w' : ''}">${m.score_b} ${m.sd.b?.name}</b><em>${SHORT_CAT[m.category]}</em></span>`;
  return h`
<section class="sb-courts" data-count="${state.courts.length + stray.length}" aria-label="Courts">
  ${state.courts.map((c) => tvCourt(state, c))}
  ${stray.map((m) => tvCourt(state, m.court || 'Court to be confirmed', m))}
</section>
<aside class="sb-side${koActive ? ' is-compact' : ''}">
  ${koActive ? tvKnockout(state) : ''}
  ${state.groupsSet ? h`${tvStandings(state, 'A')}${tvStandings(state, 'B')}` : h`<p class="sb-wait">Groups are set at the live draw on 25 November.</p>`}
</aside>
<footer class="sb-ticker" aria-label="Latest results">
  <span class="sb-ticker-label">Latest results</span>
  <div class="sb-ticker-track">${latest.length
    ? h`<div class="sb-ticker-items${latest.length > 3 ? ' is-moving' : ''}">${latest.map(result)}${latest.length > 3 ? latest.map(result) : ''}</div>`
    : h`<div class="sb-ticker-items"><span class="sb-result">Results appear here as matches finish.</span></div>`}</div>
</footer>`;
}

export function tvPage(state, qrSvg, publicUrl) {
  const shown = publicUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const body = h`
<main class="sb sb-has-partners" id="main">
  <header class="sb-top">
    <img src="/assets/logo.svg" alt="Battle of Schools" class="sb-logo">
    <div class="sb-title"><p>${state.settings.event_title} · ${state.settings.venue}</p><h1>Live <span>scoreboard</span></h1></div>
    <div class="sb-now"><div class="sb-clock" id="clock" aria-hidden="true"></div><span class="conn sb-conn" id="conn" data-state="connecting">Connecting…</span></div>
    <div class="sb-qr"><div class="sb-qr-code">${raw(qrSvg)}</div><div class="sb-qr-copy"><strong>Scores on your phone</strong><span>Scan, or open</span><b>${shown}</b></div></div>
  </header>
  <div id="live-region" class="sb-body" data-src="/partial/tv">${tvPartial(state)}</div>
  <section class="sb-partners" aria-label="Event partners">
    <div class="sb-partner sb-partner-gold"><span>Gold Sponsor</span><div class="gold-mark-pair" aria-label="JAPFA Food and TOKUSEN, one Gold partner"><img class="sb-japfa-logo" src="/assets/sponsors/japfa-food-white.png" alt="JAPFA Food" width="104" height="34"><img class="sb-tokusen-logo" src="/assets/sponsors/tokusen-white.png" alt="TOKUSEN" width="130" height="42"></div></div>
    <div class="sb-partner sb-partner-silver"><span>Silver Sponsor</span><img src="/assets/sponsors/sucor-sekuritas-white.png" alt="Sucor Sekuritas" width="190" height="32"></div>
    <div class="sb-partner sb-partner-media"><span>Media Partner</span><img src="/assets/sponsors/tatler-white.png" alt="Tatler" width="68" height="40"></div>
  </section>
</main>`;
  return layout({ title: 'TV scoreboard', body, bare: true, bodyClass: 'sb-page', scripts: ['/js/live.js'], styles: ['/css/tv.css', '/css/sponsors.css'] });
}

// ---------- Login ----------

export function loginPage({ query, sentTo = null, devLink = null }) {
  const body = h`
<main id="main" class="wrap narrow page">
  <p class="eyebrow">Captains and tournament staff</p>
  <h1 class="page-title">Team sign in</h1>
  ${flash(query)}
  ${sentTo
    ? h`<p class="flash flash-ok" role="status">If ${sentTo} is registered, a sign-in link is on its way. It works once and expires in 20 minutes.</p>
        ${devLink ? h`<p class="dev-note">Email is not configured on this server, so here is the link directly: <a href="${devLink}">${devLink}</a></p>` : ''}`
    : ''}
  <form method="post" action="/login" class="stack-form">
    <input type="hidden" name="next" value="${query.next || ''}">
    <label for="email">Email address</label>
    <input id="email" name="email" type="email" autocomplete="email" required placeholder="you@example.com">
    <button class="button" type="submit">Email me a sign-in link <span aria-hidden="true">→</span></button>
  </form>
  <p class="footnote">No password needed. Use the email your organizer registered for you. Spectators do not need to sign in once live scores are open.</p>
</main>`;
  return layout({ title: 'Sign in', body });
}

/** Shown to a signed-in captain while the matchups are still under wraps. */
export function holdingPage(user) {
  const body = h`
<main id="main" class="wrap narrow page">
  <p class="eyebrow">You are signed in</p>
  <h1 class="page-title">Matchups are revealed at the captain briefing</h1>
  <p style="margin-top:1rem">Your login works. Groups, fixtures and lineups open here once the organizer has revealed the matchups. Come back to this page after the briefing.</p>
  <form method="post" action="/logout" class="stack-form"><button class="button ghost" type="submit">Sign out</button></form>
</main>`;
  return layout({ title: 'Not open yet', body });
}

export function confirmLoginPage(token, next) {
  const body = h`
<main id="main" class="wrap narrow page">
  <p class="eyebrow">Almost there</p>
  <h1 class="page-title">Finish signing in</h1>
  <form method="post" action="/auth/${token}" class="stack-form">
    <input type="hidden" name="next" value="${next || ''}">
    <button class="button lime" type="submit">Continue <span aria-hidden="true">→</span></button>
  </form>
</main>`;
  return layout({ title: 'Sign in', body });
}

export { STAGE_LABEL };
