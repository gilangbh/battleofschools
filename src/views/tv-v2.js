// TV screen v2: scores reach the desk after a match, not during it, so this screen leads with finished
// matches. Courts in play show who is on court without a score, and the group tables show School Yard and social activity points.
import { h, teamMark, pairNames, showdownTitle } from './ui.js';
import { matchWinner, isKnockout } from '../rules.js';
import { tvFrame, tvStandings, onCourt } from './public.js';

const CAT = { men: 'Men’s', women: 'Women’s', open: 'Open' };
const courtNumber = (court) => (String(court).match(/\d+/) || [''])[0];
/** History cards that fit on the screen at once (two columns of two, on a 16:9 screen); more than this and the list rolls. */
const FIT = 4;

function courtCard(state, m) {
  const side = (key) => {
    const team = key === 'a' ? m.sd.a : m.sd.b;
    const people = onCourt(state, m, key);
    return h`<div class="v2-side">
      <span class="v2-faces">${people
        ? people.map((p) => h`<span class="v2-face${p.gold ? ' is-gold' : ''}">${p.photo ? h`<img src="/assets/players/${p.photo}" alt="" width="96" height="120" decoding="async">` : teamMark(team)}</span>`)
        : h`<span class="v2-face">${teamMark(team)}</span>`}</span>
      <span class="v2-who"><b>${team ? team.name : 'To be decided'}</b><small>${people ? people.map((p) => `${p.gold ? '★ ' : ''}${p.name}`).join(' / ') : 'Lineup to come'}</small></span>
    </div>`;
  };
  return h`<li class="v2-court">
    <header><span class="v2-num">${courtNumber(m.court) || '–'}</span><b>${CAT[m.category]} doubles</b><small>${showdownTitle(m.sd)}</small></header>
    ${side('a')}${side('b')}
  </li>`;
}

/** Showdowns with at least one finished match, the most recently finished first. */
export function history(state) {
  const last = (sd) => Math.max(...sd.matches.map((m) => (m.status === 'done' ? m.finished_at || 0 : -1)));
  return state.showdowns.filter((sd) => sd.matches.some((m) => m.status === 'done')).sort((x, y) => last(y) - last(x) || y.id - x.id);
}

function historyCard(state, sd) {
  const s = sd.summary;
  const ko = isKnockout(sd.stage);
  const total = { a: ko ? s.catsA : s.gamesA, b: ko ? s.catsB : s.gamesB };
  const lead = total.a === total.b ? null : total.a > total.b ? 'a' : 'b';
  const school = (team, key) => h`<span class="v2-school${lead === key ? ' is-w' : ''}">${teamMark(team)}<strong>${team ? team.name : 'To be decided'}</strong></span>`;
  const row = (m) => {
    const w = matchWinner(m);
    const done = m.status === 'done';
    const cell = (key) => {
      const names = pairNames(state, m, key);
      const score = key === 'a' ? m.score_a : m.score_b;
      const tb = key === 'a' ? m.tb_a : m.tb_b;
      return h`<span class="v2-pair">${names ? names.map((n) => h`<i>${n}</i>`) : ''}</span><b class="v2-score${w === key ? ' is-w' : ''}">${done ? h`${score}${tb != null ? h`<sup>${tb}</sup>` : ''}` : '–'}</b>`;
    };
    return h`<div class="v2-row is-${m.category}${done ? '' : ' is-pending'}">${cell('a')}<em>${CAT[m.category]}${m.status === 'live' ? h`<small>On court</small>` : ''}</em>${cell('b')}</div>`;
  };
  return h`<article class="v2-card${s.complete ? '' : ' is-part'}">
    <header><span>${[showdownTitle(sd), sd.courtText].filter(Boolean).join(' · ')}</span><span class="v2-state">${s.complete ? 'Ended' : 'In play'}</span></header>
    <div class="v2-teams">${school(sd.a, 'a')}
      <span class="v2-total"><b class="${lead === 'a' ? 'is-w' : ''}">${total.a}</b><i>–</i><b class="${lead === 'b' ? 'is-w' : ''}">${total.b}</b><small>${ko ? 'Categories' : 'Games'}</small></span>
      ${school(sd.b, 'b')}</div>
    ${sd.matches.map(row)}
  </article>`;
}

export function tvV2Partial(state) {
  const cards = history(state);
  const grid = h`<div class="v2-grid">${cards.map((sd) => historyCard(state, sd))}</div>`;
  const rolls = cards.length > FIT;
  return h`
<section class="v2-col v2-now" aria-label="On court now">
  <h2 class="v2-h">On court now</h2>
  ${state.live.length
    ? h`<ul class="v2-courts" role="list">${state.live.map((m) => courtCard(state, m))}</ul>`
    : h`<p class="v2-empty">No matches on court right now.</p>`}
</section>
<section class="v2-col v2-history" aria-label="Match history">
  <h2 class="v2-h">Matches<small>${cards.length ? 'Latest first' : ''}</small></h2>
  ${cards.length
    ? h`<div class="v2-track"><div class="v2-roll${rolls ? ' is-moving' : ''}" style="--n:${cards.length}">${grid}${rolls ? grid : ''}</div></div>`
    : h`<p class="v2-empty">Scores appear here as each match finishes.</p>`}
</section>
<aside class="v2-col v2-side-col">${state.groupsSet ? h`${tvStandings(state, 'A', { extra: true })}${tvStandings(state, 'B', { extra: true })}` : h`<p class="v2-empty">Groups are not set yet.</p>`}</aside>`;
}

export function tvV2Page(state, qrSvg, publicUrl) {
  return tvFrame(state, qrSvg, publicUrl, { title: 'TV match history', words: ['Match', 'history'], src: '/partial/tv-v2', inner: tvV2Partial(state), bodyClass: 'v2-body' });
}
