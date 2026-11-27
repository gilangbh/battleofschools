// The two extra TV screens: the knockout bracket, and the summary shown once the tournament is over.
import { h, raw, teamMark, ICON } from './ui.js';
import { matchWinner } from '../rules.js';
import { fmtPoints } from '../activity.js';
import { tvFrame, tvStandings, onCourt } from './public.js';

const CAT = { men: 'Men’s', women: 'Women’s', open: 'Open' };
const tieTitle = (sd) => (sd.stage === 'semi' ? `Semifinal ${sd.slot + 1}` : sd.stage === 'final' ? 'Final' : 'Third place');
const winnerOf = (sd) => (sd.summary.winner === 'a' ? sd.a : sd.summary.winner === 'b' ? sd.b : null);
const loserOf = (sd) => (sd.summary.winner === 'a' ? sd.b : sd.summary.winner === 'b' ? sd.a : null);

// ---------- Knockout bracket ----------

function faces(team, people) {
  if (!people) return '';
  return h`<span class="kb-faces">${people.map((p) => h`<span class="kb-face${p.gold ? ' is-gold' : ''}">${p.photo ? h`<img src="/assets/players/${p.photo}" alt="" width="96" height="120" decoding="async">` : teamMark(team)}</span>`)}</span>`;
}

function categoryRow(state, m) {
  const sd = m.sd;
  const w = matchWinner(m);
  const cell = (key) => {
    const people = onCourt(state, m, key);
    const score = key === 'a' ? m.score_a : m.score_b;
    const tb = key === 'a' ? m.tb_a : m.tb_b;
    return h`<div class="kb-cat-side is-${key}${w === key ? ' is-w' : ''}">
      ${faces(key === 'a' ? sd.a : sd.b, people)}
      <span class="kb-names">${people ? people.map((p) => `${p.gold ? '★ ' : ''}${p.name}`).join(' / ') : m.status === 'scheduled' && sd.a && sd.b ? (sd.summary.winner ? 'Not needed' : 'Lineup to come') : ''}</span>
      <b class="kb-cat-score" data-k="k${m.id}${key}">${score == null ? '–' : score}${tb != null ? h`<sup>${tb}</sup>` : ''}</b>
    </div>`;
  };
  return h`<div class="kb-cat is-${m.status}">
    ${cell('a')}
    <div class="kb-cat-mid"><span>${CAT[m.category]}</span>${m.status === 'live' ? h`<i class="sb-chip is-live">Live${m.court ? ` · ${m.court.replace(/^court\s*/i, 'Ct ')}` : ''}</i>` : m.status === 'done' ? h`<i>Final</i>` : h`<i>${[m.time, m.court ? m.court.replace(/^court\s*/i, 'Ct ') : ''].filter(Boolean).join(' · ')}</i>`}</div>
    ${cell('b')}
  </div>`;
}

function tie(state, sd, seedA, seedB) {
  const s = sd.summary;
  const state_ = s.winner ? 'done' : s.live ? 'live' : s.done ? 'part' : 'next';
  const chip = { done: 'Finished', live: 'Live', part: 'In play', next: sd.start_time ? `Starts ${sd.start_time}` : 'Up next' }[state_];
  const school = (team, key, seed) => h`<div class="kb-school${s.winner === key ? ' is-w' : s.winner ? ' is-l' : ''}">
    ${teamMark(team)}
    <div class="kb-school-name"><small>${seed}</small><strong>${team ? team.name : 'To be decided'}</strong>${s.winner === key ? h`<em>${sd.stage === 'final' ? 'Champion' : 'Into the final'}</em>` : ''}</div>
    <b class="kb-cats-won${team ? '' : ' is-none'}" data-k="c${sd.id}${key}">${team ? (key === 'a' ? s.catsA : s.catsB) : '–'}</b>
  </div>`;
  return h`<article class="kb-tie is-${sd.stage} is-${state_}">
    <header class="kb-head"><div><b>${tieTitle(sd)}</b><span>${[sd.courtText, sd.stage === 'final' ? 'Championship court' : null].filter(Boolean).join(' · ') || 'Court to be confirmed'}</span></div><span class="sb-chip${state_ === 'live' ? ' is-live' : ''}">${chip}</span></header>
    <div class="kb-schools">${school(sd.a, 'a', seedA)}<span class="kb-v">v</span>${school(sd.b, 'b', seedB)}</div>
    <p class="kb-rule">Categories won · first to two</p>
    <div class="kb-catlist">${sd.matches.map((m) => categoryRow(state, m))}</div>
  </article>`;
}

function ticker(state) {
  const latest = state.recent.slice(0, 10);
  const result = (m) => h`<span class="sb-result"><b class="${m.score_a > m.score_b ? 'is-w' : ''}">${m.sd.a?.name} ${m.score_a}</b><i>–</i><b class="${m.score_b > m.score_a ? 'is-w' : ''}">${m.score_b} ${m.sd.b?.name}</b><em>${CAT[m.category]}</em></span>`;
  return h`<footer class="sb-ticker" aria-label="Latest results">
  <span class="sb-ticker-label">Latest results</span>
  <div class="sb-ticker-track">${latest.length
    ? h`<div class="sb-ticker-items${latest.length > 3 ? ' is-moving' : ''}">${latest.map(result)}${latest.length > 3 ? latest.map(result) : ''}</div>`
    : h`<div class="sb-ticker-items"><span class="sb-result">Results appear here as matches finish.</span></div>`}</div>
</footer>`;
}

export function knockoutPartial(state) {
  const semis = state.knockout.filter((sd) => sd.stage === 'semi');
  const final = state.knockout.find((sd) => sd.stage === 'final');
  if (!semis.length && !final) return h`<p class="kb-empty">The semifinals and final appear here once the fixtures are generated.</p>${ticker(state)}`;
  const champ = final ? winnerOf(final) : null;
  return h`
<section class="kb" aria-label="Knockout stage">
  ${semis[0] ? tie(state, semis[0], 'Group A · 1st', 'Group A · 2nd') : ''}
  ${final ? h`<div class="kb-centre">
    ${champ ? h`<div class="kb-champ"><span class="tournament-sport-mark">${ICON.trophy}</span><div><small>2026 Champion</small><strong>${champ.name}</strong></div>${teamMark(champ)}</div>`
      : h`<div class="kb-road"><span class="tournament-sport-mark">${ICON.trophy}</span><div><small>Road to the title</small><strong>Two semifinals, one final</strong></div></div>`}
    ${tie(state, final, 'Winner semifinal 1', 'Winner semifinal 2')}
  </div>` : ''}
  ${semis[1] ? tie(state, semis[1], 'Group B · 1st', 'Group B · 2nd') : ''}
</section>
${ticker(state)}`;
}

export function knockoutPage(state, qrSvg, publicUrl) {
  return tvFrame(state, qrSvg, publicUrl, { title: 'TV knockout stage', words: ['Knockout', 'stage'], src: '/partial/tv-knockout', inner: knockoutPartial(state), bodyClass: 'kb-body' });
}

// ---------- Final summary ----------

/** Matches won and games won per player, over every finished category match they played in. */
export function playerStats(state) {
  const rows = new Map();
  const add = (p, team, won, games) => {
    if (!p) return;
    const r = rows.get(p.id) || { player: p, team, played: 0, wins: 0, games: 0 };
    r.played++; r.wins += won ? 1 : 0; r.games += games;
    rows.set(p.id, r);
  };
  for (const m of state.allMatches) {
    if (m.status !== 'done') continue;
    const w = matchWinner(m);
    for (const key of ['a', 'b']) {
      const l = m.lineup[key];
      const team = key === 'a' ? m.sd.a : m.sd.b;
      if (!l || !team) continue;
      const games = key === 'a' ? m.score_a : m.score_b;
      const sub = m.tickets.find((t) => t.team_id === team.id && t.type === 'gold_player');
      for (const p of [l.player1, l.player2]) {
        // A Gold Player who started the match takes the credit; one who came in after game 2 shares it.
        if (sub && p && sub.player_out === p.id && sub.gold) {
          // A pool player is counted once per school they played for, apart from the roster's player ids.
          add(sub.free_gold_id ? { ...sub.gold, id: `pool-${sub.free_gold_id}-${team.id}`, is_gold: 1 } : sub.gold, team, w === key, games);
          if (sub.timing === 'start') continue;
        }
        add(p, team, w === key, games);
      }
    }
  }
  const list = [...rows.values()];
  const by = (k, k2) => [...list].sort((x, y) => y[k] - x[k] || y[k2] - x[k2] || x.played - y.played || x.player.name.localeCompare(y.player.name)).slice(0, 10);
  return { wins: by('wins', 'games'), games: by('games', 'wins') };
}

function playerTable(title, unit, rows, key) {
  return h`<table class="sm-players">
    <caption><span>${title}</span></caption>
    <tbody>${rows.length ? rows.map((r, i) => h`<tr><td class="sm-pos">${i + 1}</td>
      <th scope="row"><span class="sm-player"><span class="sm-face">${r.player.photo ? h`<img src="/assets/players/${r.player.photo}" alt="" width="96" height="120" decoding="async">` : teamMark(r.team)}</span><span><b>${r.player.is_gold ? '★ ' : ''}${r.player.name}</b><small>${r.team.name} · ${r.played} played</small></span></span></th>
      <td class="sm-num">${r[key]}<small>${unit}</small></td></tr>`) : h`<tr><td class="sm-none">No finished matches with lineups yet.</td></tr>`}</tbody>
  </table>`;
}

function koLine(sd) {
  const s = sd.summary;
  const row = (team, key) => h`<p class="sm-ko-team${s.winner === key ? ' is-w' : ''}">${teamMark(team)}<span>${team ? team.name : 'To be decided'}</span>
    <span class="sm-ko-cats">${sd.matches.map((m) => { const v = key === 'a' ? m.score_a : m.score_b; return h`<i class="${matchWinner(m) === key ? 'is-w' : ''}">${v == null ? '–' : v}</i>`; })}</span>
    <b>${team ? (key === 'a' ? s.catsA : s.catsB) : '–'}</b></p>`;
  return h`<div class="sm-ko${sd.stage === 'final' ? ' is-final' : ''}"><p class="sm-ko-title"><b>${tieTitle(sd)}</b><span>M · W · O</span></p>${row(sd.a, 'a')}${row(sd.b, 'b')}</div>`;
}

export function summaryPartial(state, { secret = false } = {}) {
  const final = state.knockout.find((sd) => sd.stage === 'final');
  const semis = state.knockout.filter((sd) => sd.stage === 'semi');
  const champ = final ? winnerOf(final) : null;
  const second = final ? loserOf(final) : null;
  const done = state.allMatches.filter((m) => m.status === 'done');
  const games = done.reduce((n, m) => n + m.score_a + m.score_b, 0);
  const tickets = [...state.ticketsByTeam.values()].reduce((n, list) => n + list.length, 0);
  const yardBest = [...state.yardByTeam.entries()].map(([id, y]) => ({ team: state.teamById.get(id), pts: y.banked })).sort((x, y) => y.pts - x.pts)[0];
  // Every result, newest last, grouped under its round for the vertical ticker.
  const order = [...state.showdowns].filter((sd) => sd.matches.some((m) => m.status === 'done'));
  const feedItem = (sd) => h`<div class="sm-feed-item"><p class="sm-feed-round">${sd.stage === 'group' ? `Round ${sd.round}` : tieTitle(sd)}</p>
    <p class="sm-feed-teams"><span class="${sd.summary.gamesA > sd.summary.gamesB ? 'is-w' : ''}">${teamMark(sd.a)}${sd.a?.name}</span><span class="${sd.summary.gamesB > sd.summary.gamesA ? 'is-w' : ''}">${teamMark(sd.b)}${sd.b?.name}</span></p>
    ${sd.matches.filter((m) => m.status === 'done').map((m) => h`<p class="sm-feed-score"><b class="${m.score_a > m.score_b ? 'is-w' : ''}">${m.score_a}</b><em>${CAT[m.category]}</em><b class="${m.score_b > m.score_a ? 'is-w' : ''}">${m.score_b}</b></p>`)}</div>`;
  const stats = secret ? playerStats(state) : null;

  return h`
<section class="sm${secret ? ' has-secret' : ''}" aria-label="Tournament summary">
  <div class="sm-col sm-main">
    ${champ ? h`<div class="sm-champ">
      <div class="sm-champ-crest">${teamMark(champ)}</div>
      <div class="sm-champ-text"><p class="sm-champ-label"><span class="tournament-sport-mark">${ICON.trophy}</span>2026 Champion</p><strong>${champ.name}</strong><small>${champ.school}</small></div>
      ${second ? h`<div class="sm-second">${teamMark(second)}<div><small>Runner-up</small><b>${second.name}</b></div></div>` : ''}
    </div>` : h`<div class="sm-champ is-open">
      <div class="sm-champ-text"><p class="sm-champ-label"><span class="tournament-sport-mark">${ICON.trophy}</span>2026 Champion</p><strong>To be decided</strong><small>This screen fills in as the final is played.</small></div>
    </div>`}
    <div class="sm-kos">${semis.map(koLine)}${final ? koLine(final) : ''}</div>
    <div class="sm-tiles">
      <div><b>${done.length}</b><span>matches</span></div>
      <div><b>${games}</b><span>games</span></div>
      <div><b>${tickets}</b><span>golden tickets</span></div>
      ${yardBest && yardBest.pts > 0 ? h`<div><b>${fmtPoints(yardBest.pts)}</b><span>best School Yard · ${yardBest.team.name}</span></div>` : ''}
    </div>
  </div>
  <div class="sm-col sm-standings">${state.groupsSet ? h`${tvStandings(state, 'A')}${tvStandings(state, 'B')}` : h`<p class="sb-wait">Groups are not set yet.</p>`}</div>
  ${secret ? h`<div class="sm-col sm-secret">${playerTable('Most matches won', 'won', stats.wins, 'wins')}${playerTable('Most games won', 'games', stats.games, 'games')}</div>` : ''}
  <aside class="sm-col sm-feed" aria-label="All results">
    <p class="sm-feed-label">All results</p>
    <div class="sm-feed-track">${order.length
      ? h`<div class="sm-feed-items${order.length > 4 ? ' is-moving' : ''}" style="--n:${order.length}">${order.map(feedItem)}${order.length > 4 ? order.map(feedItem) : ''}</div>`
      : h`<p class="sm-feed-none">Results appear here as matches finish.</p>`}</div>
  </aside>
</section>`;
}

export function summaryPage(state, qrSvg, publicUrl, { secret = false } = {}) {
  return tvFrame(state, qrSvg, publicUrl, {
    title: 'TV final summary', words: ['Final', 'results'], src: `/partial/tv-summary${secret ? '?secret=1' : ''}`, inner: summaryPartial(state, { secret }), bodyClass: 'sm-body',
  });
}

export { raw };
