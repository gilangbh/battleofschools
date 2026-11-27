import { h, raw, layout, teamMark, categoryTag, pairNames, showdownTitle, ICON, flash } from './ui.js';
import { CATEGORY_LABEL, STAGE_LABEL, matchWinner, isKnockout } from '../rules.js';
import { fmtPoints } from '../activity.js';

const PLACE_LABEL = { qualified: 'Semifinal place', provisional: 'Top two for now', tied: 'Level on points: committee decides' };
const SHORT_CAT = { men: 'Men’s', women: 'Women’s', open: 'Open' };
const courtNumber = (court) => (String(court).match(/\d+/) || [''])[0];
const pairLine = (names) => (names ? h`<small class="ls-pair">${names.join(' / ')}</small>` : '');

// ---------- Live scores page (phones and desktops) ----------

/** One school-v-school card: the two schools with the running total, then the three category matches. */
export function fixtureCard(state, sd, title = null) {
  const s = sd.summary;
  const ko = isKnockout(sd.stage);
  const totalA = ko ? s.catsA : s.gamesA;
  const totalB = ko ? s.catsB : s.gamesB;
  const status = s.live ? 'live' : s.complete ? 'done' : s.done ? 'part' : 'next';
  const chip = { live: 'Live', done: 'Final', part: 'In progress', next: sd.start_time || 'Upcoming' }[status];
  const lead = totalA === totalB ? null : totalA > totalB ? 'a' : 'b';
  const side = (team, key) => h`<div class="ls-fx-team${s.done && lead === key ? ' is-lead' : ''}${ko && s.winner === key ? ' is-winner' : ''}">${teamMark(team)}<strong>${team ? team.name : 'To be decided'}</strong></div>`;
  const cell = (m, key) => {
    const score = key === 'a' ? m.score_a : m.score_b;
    const tb = key === 'a' ? m.tb_a : m.tb_b;
    return h`<td class="${matchWinner(m) === key ? 'is-lead' : ''}"><span class="ls-num"${m.status === 'live' ? raw(` data-k="f${m.id}${key}"`) : ''}>${score == null ? '–' : score}${tb != null ? h`<sup>${tb}</sup>` : ''}</span>${pairLine(pairNames(state, m, key))}</td>`;
  };
  const meta = [title, status === 'next' ? null : sd.start_time, sd.courtText].filter(Boolean);
  const own = (m) => (ko || m.court !== sd.court || m.time !== sd.start_time ? [m.time, m.court].filter(Boolean).join(' · ') : '');
  return h`<li class="ls-fx is-${status}" data-teams="${[sd.team_a, sd.team_b].filter(Boolean).join(' ')}">
  <header class="ls-fx-head"><span>${meta.join(' · ') || 'Time and court to be confirmed'}</span><span class="ls-chip is-${status}">${chip}</span></header>
  <div class="ls-fx-top">
    ${side(sd.a, 'a')}
    <div class="ls-fx-total">${s.done ? h`<b class="${lead === 'a' ? 'is-lead' : ''}">${totalA}</b><i>–</i><b class="${lead === 'b' ? 'is-lead' : ''}">${totalB}</b>` : h`<i class="ls-v">v</i>`}<small>${s.done ? (ko ? 'Categories' : s.complete ? 'Games' : 'Games so far') : ''}</small></div>
    ${side(sd.b, 'b')}
  </div>
  <table class="ls-fx-cats">
    <caption class="visually-hidden">${sd.a ? sd.a.name : 'To be decided'} v ${sd.b ? sd.b.name : 'To be decided'}, by category</caption>
    <tbody>${sd.matches.map((m) => h`<tr class="${m.status === 'live' ? 'is-live' : ''}">
      ${cell(m, 'a')}
      <th scope="row"><span class="ls-cat"><span class="tournament-sport-mark" aria-hidden="true">${ICON[m.category]}</span>${CATEGORY_LABEL[m.category]}</span>${m.status === 'scheduled' && own(m) ? h`<span class="ls-when">${own(m)}</span>` : ''}${m.status === 'live' ? h`<span class="ls-oncourt">On court${m.court ? h` · ${m.court}` : ''}</span>` : ''}</th>
      ${cell(m, 'b')}
    </tr>`)}</tbody>
  </table>
  ${ko && s.winner ? h`<p class="ls-fx-foot">Winner: <b>${(s.winner === 'a' ? sd.a : sd.b)?.name}</b> · games ${s.gamesA}–${s.gamesB}</p>` : ''}
</li>`;
}

function liveCard(state, m) {
  const sd = m.sd;
  const a = m.score_a ?? 0;
  const b = m.score_b ?? 0;
  const lead = a === b ? null : a > b ? 'a' : 'b';
  const side = (team, key) => h`<div class="ls-live-side${lead === key ? ' is-lead' : ''}">${teamMark(team)}
    <div class="ls-live-team"><strong>${team ? team.name : 'To be decided'}</strong>${pairLine(pairNames(state, m, key))}</div>
    <span class="ls-live-score" data-k="m${m.id}${key}">${key === 'a' ? a : b}</span></div>`;
  return h`<li class="ls-live" data-teams="${[sd.team_a, sd.team_b].filter(Boolean).join(' ')}">
  <header class="ls-live-head"><span class="ls-live-num">${courtNumber(m.court) || '–'}</span>
    <div><b>${m.court || 'Court to be confirmed'}</b><span>${SHORT_CAT[m.category]} doubles · ${showdownTitle(sd)}</span></div>
    <span class="ls-chip is-live">Live</span></header>
  ${side(sd.a, 'a')}${side(sd.b, 'b')}
</li>`;
}

/** The next showdowns that have not started, earliest round first. Shown when no court is in play. */
function upNext(state) {
  const waiting = state.showdowns.filter((sd) => sd.a && sd.b && !sd.summary.done && !sd.summary.live);
  if (!waiting.length) return [];
  const round = waiting[0].round;
  return waiting.filter((sd) => sd.round === round);
}

function nextCard(sd) {
  return h`<li class="ls-next" data-teams="${sd.team_a} ${sd.team_b}">
  <p class="ls-next-meta"><b>${sd.start_time || 'Time to be confirmed'}</b><span>${sd.courtText || 'Court to be confirmed'}</span></p>
  <p class="ls-next-teams">${teamMark(sd.a)}<strong>${sd.a.name}</strong><i>v</i>${teamMark(sd.b)}<strong>${sd.b.name}</strong></p>
</li>`;
}

function standingsTable(group, rows, showActivities) {
  const started = rows.some((r) => r.played > 0 || r.total > 0);
  return h`<div class="ls-group"><table class="ls-table">
  <caption><span>Group ${group}</span></caption>
  <thead><tr>
    <th scope="col" class="ls-rank"><span class="visually-hidden">Rank</span></th><th scope="col">School</th><th scope="col">W–L</th><th scope="col">Games</th>
    ${showActivities ? h`<th scope="col">Activities</th>` : ''}<th scope="col">Points</th>
  </tr></thead>
  <tbody>${rows.map((r) => h`<tr class="${r.place === 'qualified' || r.place === 'provisional' ? 'is-q' : r.place === 'tied' ? 'is-tied' : ''}" data-teams="${r.team.id}">
    <td class="ls-rank">${started ? r.rank : '–'}</td>
    <th scope="row"><span class="ls-school">${teamMark(r.team)}<span>${r.team.name}${r.place ? h`<small>${PLACE_LABEL[r.place]}</small>` : ''}</span></span></th>
    <td>${r.won}–${r.lost}</td><td>${r.games}</td>
    ${showActivities ? h`<td>${fmtPoints(r.yard + r.bonus)}${r.pending ? h`<small class="ls-pending">${r.yardIn}/21${r.bonusIn ? '' : ' · no bonus yet'}</small>` : ''}</td>` : ''}<td class="ls-total" data-k="t${r.team.id}">${fmtPoints(r.total)}</td>
  </tr>`)}</tbody>
</table></div>`;
}

function champion(state) {
  const final = state.showdowns.find((s) => s.stage === 'final');
  if (!final || !final.summary.winner) return '';
  const win = final.summary.winner === 'a' ? final.a : final.b;
  const lose = final.summary.winner === 'a' ? final.b : final.a;
  return h`<section class="ls-champion" aria-label="Champion">
  <div class="ls-champion-main">${teamMark(win)}<div><p class="ls-champion-label"><span class="tournament-sport-mark">${ICON.trophy}</span>2026 Champion</p><strong>${win.name}</strong><small>${win.school}</small></div></div>
  <div class="ls-champion-second">${teamMark(lose)}<div><p class="ls-champion-label">Runner-up</p><strong>${lose.name}</strong></div></div>
</section>`;
}

/** The part of the public page that is swapped in place whenever a score changes. */
export function publicPartial(state) {
  const showActivities = state.yardStarted;
  const group = state.showdowns.filter((s) => s.stage === 'group');
  const groupRounds = [...new Set(group.map((s) => s.round))];
  const anyResults = state.allMatches.some((m) => m.status !== 'scheduled');
  const groupMatches = group.flatMap((s) => s.matches);
  const finished = groupMatches.filter((m) => m.status === 'done').length;
  // Open the round that is in play; before the first score, open round 1.
  const activeRound = groupRounds.find((r) => group.some((s) => s.round === r && !s.summary.complete)) ?? groupRounds[groupRounds.length - 1];
  const next = state.live.length ? [] : upNext(state);
  const stage = state.knockout.some((sd) => sd.a && sd.b && (sd.summary.done || sd.summary.live))
    ? 'Finals' : groupRounds.length ? (finished === groupMatches.length && finished ? 'Group stage finished' : `Round ${activeRound} of ${groupRounds.length}`) : 'Before the draw';
  const semis = state.knockout.filter((sd) => sd.stage === 'semi');
  const final = state.knockout.find((sd) => sd.stage === 'final');
  const pct = groupMatches.length ? Math.round((finished / groupMatches.length) * 100) : 0;

  return h`
<div class="ls-pulse" aria-label="Tournament progress">
  <div class="ls-stat${state.live.length ? ' is-live' : ''}"><b data-k="s-live">${state.live.length}</b><span>on court now</span></div>
  <div class="ls-stat"><b>${stage}</b><span>${state.settings.event_date}</span></div>
  <div class="ls-stat is-bar"><b data-k="s-done">${finished}<small> of ${groupMatches.length || 75}</small></b><span>group matches finished</span><i class="ls-bar" aria-hidden="true"><i style="width:${pct}%"></i></i></div>
</div>

${champion(state)}

<section id="live" aria-labelledby="live-h">
  <h2 id="live-h" class="ls-h"><span>${state.live.length ? 'On court now' : next.length ? 'Up next' : 'On court'}</span>${!state.live.length && next.length ? h`<small>${showdownTitle(next[0])}</small>` : ''}</h2>
  ${state.live.length
    ? h`<ul class="ls-live-grid" role="list">${state.live.map((m) => liveCard(state, m))}</ul>`
    : next.length
      ? h`<ul class="ls-next-grid" role="list">${next.map(nextCard)}</ul>`
      : h`<p class="quiet-note">${anyResults ? 'No matches are on court right now.' : `Matches start on ${state.settings.event_date} at ${state.settings.venue}. Scores appear here as they happen.`}</p>`}
</section>

<section id="standings" aria-labelledby="standings-h">
  <h2 id="standings-h" class="ls-h"><span>Group standings</span></h2>
  ${state.groupsSet
    ? h`<div class="ls-groups">${['A', 'B'].filter((g) => state.standings[g]).map((g) => standingsTable(g, state.standings[g], showActivities))}</div>
      <p class="footnote ls-note"><span class="ls-key"></span>Top two in each group reach the semifinals. One point per game won, plus School Yard activity points and the School Spirit bonus. Places are confirmed when the group matches and all activity results are in.</p>`
    : h`<p class="quiet-note">Groups are set at the live matchup draw on 25 November.</p>
      <ul class="school-chips" role="list">${state.teams.map((t) => h`<li>${teamMark(t)}<span>${t.name}</span></li>`)}</ul>`}
</section>

${groupRounds.length ? h`<section id="matches" aria-labelledby="matches-h">
  <h2 id="matches-h" class="ls-h"><span>Group matches</span></h2>
  <div class="ls-rounds">
    ${groupRounds.map((r) => {
      const sds = group.filter((s) => s.round === r);
      const done = sds.filter((s) => s.summary.complete).length;
      const live = sds.some((s) => s.summary.live);
      return h`<details class="ls-round" data-key="round-${r}"${r === activeRound ? raw(' open') : ''}>
        <summary><b>Round ${r}</b><span>${sds[0].start_time || ''}</span>${live ? h`<span class="ls-chip is-live">Live</span>` : ''}<em>${done === sds.length ? 'Finished' : `${done} of ${sds.length} finished`}</em></summary>
        <ul class="ls-fixtures" role="list">${sds.map((sd) => fixtureCard(state, sd))}</ul>
      </details>`;
    })}
  </div>
</section>` : ''}

${state.knockout.length ? h`<section id="knockout" aria-labelledby="knockout-h">
  <h2 id="knockout-h" class="ls-h"><span>Semifinals and final</span></h2>
  <p class="footnote ls-note">The first school to win two categories wins. Each category is first to six games, with a tiebreak at 5–5. Small numbers show tiebreak points.</p>
  <div class="ls-bracket">
    <ul class="ls-fixtures ls-semis" role="list">${semis.map((sd) => fixtureCard(state, sd, `${showdownTitle(sd)} · ${sd.slot === 0 ? 'A1 v A2' : 'B1 v B2'}`))}</ul>
    ${final ? h`<ul class="ls-fixtures ls-final" role="list">${fixtureCard(state, final, 'Final')}</ul>` : ''}
  </div>
</section>` : ''}
`;
}

function sponsorStrip() {
  return h`<section class="score-sponsors" aria-label="Event sponsors">
      <div class="sponsor-unit sponsor-unit-gold"><span class="sponsor-role">Gold Sponsor</span><div class="gold-mark-pair" aria-label="JAPFA Food and TOKUSEN, one Gold partner"><img class="sponsor-japfa-logo" src="/assets/sponsors/japfa-food-navy.png" alt="JAPFA Food" width="120" height="36"><img class="sponsor-tokusen-logo" src="/assets/sponsors/tokusen-navy.svg" alt="TOKUSEN" width="144" height="44"></div></div>
      <div class="sponsor-unit sponsor-unit-silver"><span class="sponsor-role">Silver Sponsor</span><img class="sponsor-silver-logo" src="/assets/sponsors/sucor-sekuritas-navy.png" alt="Sucor Sekuritas" width="190" height="38"></div>
    </section>`;
}

export function publicPage(state, user) {
  const body = h`
<main id="main" class="tournament-results ls">
  <div class="ls-hero">
    <div class="wrap ls-hero-in">
      <div>
        <p class="eyebrow">${state.settings.event_title} · ${state.settings.venue}</p>
        <h1>Live <span>scores</span></h1>
      </div>
      <span class="conn ls-conn" id="conn" data-state="connecting">Connecting…</span>
    </div>
  </div>
  <nav class="tournament-nav ls-nav" aria-label="Sections"><div class="wrap">
    <a href="#live">On court</a><a href="#standings">Standings</a><a href="#matches">Matches</a><a href="#knockout">Finals</a>
    <label class="ls-follow" for="team-filter"><span>Follow</span><select id="team-filter"><option value="">All schools</option>${state.teams.map((t) => h`<option value="${t.id}">${t.name}</option>`)}</select></label>
  </div></nav>
  <div class="wrap tournament-body">
    ${sponsorStrip()}
    <div id="live-region" data-src="/partial/public">${publicPartial(state)}</div>
  </div>
</main>`;
  return layout({ title: 'Live scores', body, user, scripts: ['/js/live.js'], styles: ['/css/sponsors.css', '/css/scores.css'], active: 'scores', mediaCredit: true });
}

// ---------- TV scoreboard ----------


/** The two people on court for one side, with portraits. Null until both lineups are in. */
export function onCourt(state, m, side) {
  const l = m.lineup[side];
  if (!l || !m.revealed) return null;
  const team = side === 'a' ? m.sd.a : m.sd.b;
  const sub = m.tickets.find((t) => t.team_id === team.id && t.type === 'gold_player' && t.timing === 'start');
  return [l.player1, l.player2].filter(Boolean).map((p) => {
    if (sub && sub.player_out === p.id) return { name: sub.gold ? sub.gold.name : 'Gold Player', photo: sub.gold?.photo || null, gold: true };
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
      .sort((x, y) => x.sd.round - y.sd.round || String(x.time).localeCompare(String(y.time)) || x.id - y.id)[0];
    if (!next) return h`<article class="sb-court is-free"><header class="sb-court-head">${badge}<div class="sb-court-title"><b>${court}</b><span>No match right now</span></div></header><p class="sb-ghost" aria-hidden="true">${num}</p></article>`;
    return h`<article class="sb-court is-next">
      <header class="sb-court-head">${badge}<div class="sb-court-title"><b>${court}</b><span>${SHORT_CAT[next.category]} doubles</span></div><span class="sb-chip">Next${next.time ? h` · ${next.time}` : ''}</span></header>
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

export function tvStandings(state, group) {
  const rows = state.standings[group] || [];
  return h`<table class="sb-table">
    <caption><span>Group ${group}</span></caption>
    <thead><tr><th></th><th scope="col">School</th><th scope="col">Games</th><th scope="col">Points</th></tr></thead>
    <tbody>${rows.map((r) => h`<tr class="${r.place === 'qualified' || r.place === 'provisional' ? 'is-q' : r.place === 'tied' ? 'is-tied' : ''}"><td class="sb-rank">${r.rank}</td><th scope="row"><span class="sb-name">${teamMark(r.team)}<span>${r.team.name}</span></span></th><td>${r.games}</td><td class="sb-total">${fmtPoints(r.total)}</td></tr>`)}</tbody>
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

/** The shared TV frame: top bar with clock and QR code, the live region, and the sponsor rail. */
export function tvFrame(state, qrSvg, publicUrl, { title, words, src, inner, bodyClass = '' }) {
  const shown = publicUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const body = h`
<main class="sb sb-has-partners" id="main">
  <header class="sb-top">
    <img src="/assets/logo.svg" alt="Battle of Schools" class="sb-logo">
    <div class="sb-title"><p>${state.settings.event_title} · ${state.settings.venue}</p><h1>${words[0]} <span>${words[1]}</span></h1></div>
    <div class="sb-now"><div class="sb-clock" id="clock" aria-hidden="true"></div><span class="conn sb-conn" id="conn" data-state="connecting">Connecting…</span></div>
    <div class="sb-qr"><div class="sb-qr-code">${raw(qrSvg)}</div><div class="sb-qr-copy"><strong>Scores on your phone</strong><span>Scan, or open</span><b>${shown}</b></div></div>
  </header>
  <div id="live-region" class="sb-body ${bodyClass}" data-src="${src}">${inner}</div>
  <section class="sb-partners" aria-label="Event partners">
    <div class="sb-partner sb-partner-gold"><span>Gold Sponsor</span><div class="gold-mark-pair" aria-label="JAPFA Food and TOKUSEN, one Gold partner"><img class="sb-japfa-logo" src="/assets/sponsors/japfa-food-white.png" alt="JAPFA Food" width="104" height="34"><img class="sb-tokusen-logo" src="/assets/sponsors/tokusen-white.svg" alt="TOKUSEN" width="130" height="42"></div></div>
    <div class="sb-partner sb-partner-silver"><span>Silver Sponsor</span><img src="/assets/sponsors/sucor-sekuritas-white.png" alt="Sucor Sekuritas" width="190" height="32"></div>
    <div class="sb-partner sb-partner-media"><span>Media Partner</span><img src="/assets/sponsors/tatler-white.svg" alt="Tatler, Media Partner" width="94" height="50"></div>
  </section>
</main>`;
  return layout({ title, body, bare: true, bodyClass: 'sb-page', scripts: ['/js/live.js'], styles: ['/css/tv.css', '/css/sponsors.css', '/css/tv-stages.css'] });
}

export function tvPage(state, qrSvg, publicUrl) {
  return tvFrame(state, qrSvg, publicUrl, { title: 'TV scoreboard', words: ['Live', 'scoreboard'], src: '/partial/tv', inner: tvPartial(state) });
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
