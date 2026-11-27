import { h, raw, layout, teamMark, categoryTag, pairNames, showdownTitle, scoreText, flash, LEVEL_LABEL, ICON } from './ui.js';
import { ticketBalance, GOLD_DEPLOYMENTS, GOLDEN_POINTS, MIN_APPEARANCES, isKnockout } from '../rules.js';

const minutesBefore = (hhmm, n) => {
  const [h2, m] = hhmm.split(':').map(Number);
  const total = (h2 * 60 + m - n + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const playerLabel = (p) => `${p.name} · ${LEVEL_LABEL[p.level]}${p.gender ? ` · ${p.gender === 'M' ? 'Man' : 'Woman'}` : ''}`;

function playerSelect(name, team, selected) {
  return h`<select name="${name}" required aria-label="${name === 'p1' ? 'First player' : 'Second player'}">
    <option value="">Choose player</option>
    ${team.regulars.map((p) => h`<option value="${p.id}"${selected === p.id ? raw(' selected') : ''}>${playerLabel(p)}</option>`)}
  </select>`;
}

function lineupBlock(state, team, m, goldLeft, base) {
  const sd = m.sd;
  const side = sd.team_a === team.id ? 'a' : 'b';
  const mine = m.lineup[side];
  const opp = side === 'a' ? sd.b : sd.a;
  const head = h`<p class="lineup-cat">${categoryTag(m.category)}${m.time || m.court ? h`<span class="chip">${[m.time, m.court].filter(Boolean).join(' · ')}</span>` : ''}</p>`;

  if (m.revealed) {
    const score = scoreText(m);
    return h`<div class="lineup is-locked">${head}
      <p class="lineup-pairs"><strong>${pairNames(state, m, side).join(' / ')}</strong> <span>v</span> ${pairNames(state, m, side === 'a' ? 'b' : 'a').join(' / ')}</p>
      <p class="lineup-status">${m.status === 'done' ? h`Final score ${side === 'a' ? score : `${m.score_b}–${m.score_a}`}` : m.status === 'live' ? 'On court now' : 'Locked. Ask the scoring desk for changes.'}</p>
    </div>`;
  }
  if (m.status === 'done') {
    return h`<div class="lineup is-locked">${head}<p class="lineup-status">Finished ${scoreText(m)}. No lineup was recorded.</p></div>`;
  }
  const canGold = !isKnockout(sd.stage) && team.goldOptions.length > 0 && (goldLeft > 0 || (mine && mine.goldOut));
  const goldValue = (slot, g) => (g.freeId ? `${slot}:${g.freeId}` : slot);
  const goldSel = mine && mine.goldOut ? goldValue(mine.goldOut === mine.p1 ? 'p1' : 'p2', { freeId: mine.goldFreeId }) : '';
  return h`<div class="lineup ${mine ? 'is-waiting' : 'is-open'}">${head}
    ${mine ? h`<p class="lineup-status"><strong>Submitted.</strong> Hidden until ${opp ? opp.name : 'your opponent'} submits.</p>` : ''}
    <form method="post" action="${base}/lineup/${m.id}" class="lineup-form">
      ${playerSelect('p1', team, mine?.p1)}
      ${playerSelect('p2', team, mine?.p2)}
      ${canGold ? h`<select name="gold" aria-label="Gold Player Ticket">
        <option value="">No Gold Player Ticket</option>
        ${team.goldOptions.map((g) => ['p1', 'p2'].map((slot) => h`<option value="${goldValue(slot, g)}"${goldSel === goldValue(slot, g) ? raw(' selected') : ''}>${g.name} ★ starts instead of ${slot === 'p1' ? 'first' : 'second'} player</option>`))}
      </select>` : ''}
      <button class="button small" type="submit">${mine ? 'Update' : 'Submit'}</button>
      ${canGold ? h`<span class="footnote">The Gold Player may only replace the highest-rated player of the pair, and must be the same gender.</span>` : ''}
    </form>
    ${mine ? h`<form method="post" action="${base}/lineup/${m.id}/withdraw"><button class="link-button" type="submit">Withdraw</button></form>` : ''}
  </div>`;
}

export function captainPage(state, user, team, query) {
  const base = user.role === 'admin' ? `/captain/${team.id}` : '/captain';
  const used = state.ticketsByTeam.get(team.id) || [];
  const bal = ticketBalance(used);
  const mine = state.showdowns.filter((sd) => sd.team_a === team.id || sd.team_b === team.id);
  const groupMatchesLeft = mine
    .filter((sd) => sd.stage === 'group')
    .flatMap((sd) => sd.matches)
    .filter((m) => !m.lineup[m.sd.team_a === team.id ? 'a' : 'b'] && m.status !== 'done').length;
  const short = team.regulars.filter((p) => (state.appearances.get(p.id) || 0) < MIN_APPEARANCES);
  const missingGender = team.regulars.some((p) => !p.gender);

  const card = (sd) => {
    const opp = sd.team_a === team.id ? sd.b : sd.a;
    return h`<article class="showdown-card">
      <header><h3>${showdownTitle(sd)} <span>v</span> ${opp ? h`${teamMark(opp)} ${opp.name}` : 'To be decided'}</h3>${sd.stage === 'group' && sd.start_time ? h`<p class="due">Lineups due ${minutesBefore(sd.start_time, 15)}</p>` : ''}<p class="fixture-meta">${[sd.start_time, sd.courtText].filter(Boolean).join(' · ')}</p></header>
      <div class="lineup-grid">${sd.matches.map((m) => lineupBlock(state, team, m, bal.goldLeft, base))}</div>
    </article>`;
  };
  // Showdowns that still need attention come first; finished ones fold away below.
  const upcoming = mine.filter((sd) => !sd.summary.complete);
  const finished = mine.filter((sd) => sd.summary.complete);

  const body = h`
<main id="main" class="page">
  <div class="tournament-hero"><div class="wrap">
    <p class="eyebrow">Captain’s lineups</p>
    <div class="team-head">${teamMark(team)}<div><h1 class="page-title">${team.name}</h1><p>${team.school}${team.grp ? ` · Group ${team.grp}` : ''}</p></div></div>
  </div></div>
  <div class="wrap tournament-body">
    ${flash(query)}
    ${user.role === 'admin' ? h`<form method="get" action="/captain" class="tournament-filter"><div><label for="team">Viewing as</label><select id="team" name="team" data-autosubmit>${state.teams.map((t) => h`<option value="${t.id}"${t.id === team.id ? raw(' selected') : ''}>${t.name}</option>`)}</select></div><button type="submit">Switch</button></form>` : ''}

    <section aria-labelledby="lineups-h">
      <h2 id="lineups-h">Lineups</h2>
      <p class="flash due-note"><b>All three pairs are due 15 minutes before your showdown starts.</b> The committee enforces this; the app does not close lineups on the clock.</p>
      <p class="footnote">Your pair stays hidden until the other captain submits theirs. As soon as both are in for a category, both are shown and locked, even if that is early.</p>
      ${!team.hasOwnGold && team.goldOptions.length ? h`<p class="footnote">Your school has no Gold Player of its own, so a Gold Player Ticket can call an organizer Gold: ${team.goldOptions.map((g) => g.name).join(' or ')}. The same ticket rules apply and the games count for your school.</p>` : ''}
      ${mine.length ? '' : h`<p class="quiet-note">Your matchups appear here after the live draw on 25 November.</p>`}
      ${upcoming.map(card)}
      ${finished.length ? h`<details class="tournament-round finished-rounds"><summary>Finished showdowns <span class="round-count">${finished.length}</span></summary>${finished.map(card)}</details>` : ''}
    </section>

    <section aria-labelledby="squad-h">
      <h2 id="squad-h">Your squad</h2>
      <div class="stat-row">
        <div class="stat"><span class="stat-num">${bal.goldLeft}</span><span>Gold Player use${bal.goldLeft === 1 ? '' : 's'} left of ${GOLD_DEPLOYMENTS}</span></div>
        <div class="stat"><span class="stat-num">${bal.pointLeft}</span><span>Golden Point${bal.pointLeft === 1 ? '' : 's'} left of ${GOLDEN_POINTS}</span></div>
        <div class="stat"><span class="stat-num">${short.length}</span><span>player${short.length === 1 ? '' : 's'} still under ${MIN_APPEARANCES} appearances</span></div>
        <div class="stat"><span class="stat-num">${groupMatchesLeft}</span><span>group lineup${groupMatchesLeft === 1 ? '' : 's'} still to submit</span></div>
      </div>
      ${short.length && groupMatchesLeft > 0 && short.reduce((n, p) => n + MIN_APPEARANCES - (state.appearances.get(p.id) || 0), 0) > groupMatchesLeft * 2
        ? h`<p class="flash flash-error">There are not enough group matches left for every player to reach ${MIN_APPEARANCES} appearances. Talk to the organizer.</p>` : ''}
      <form method="post" action="${base}/genders">
      <table class="tournament-table squad-table">
        <thead><tr><th scope="col">Player</th><th scope="col">Level</th><th scope="col">Plays as</th><th scope="col">Appearances</th></tr></thead>
        <tbody>${team.players.map((p) => {
          const n = state.appearances.get(p.id) || 0;
          return h`<tr>
            <th scope="row">${p.name}${p.is_captain ? h` <span class="chip">${ICON.captain}Captain</span>` : ''}${p.is_gold ? h` <span class="chip chip-gold">Gold Player ★</span>` : ''}</th>
            <td>${p.is_gold ? 'Gold' : LEVEL_LABEL[p.level]}${p.level_pending ? h` <small>(under review)</small>` : ''}</td>
            <td>${p.gender ? (p.gender === 'M' ? 'Man' : 'Woman') : h`<select name="gender_${p.id}" aria-label="Gender of ${p.name}"><option value="">Not set</option><option value="M">Man</option><option value="F">Woman</option></select>`}</td>
            <td>${p.is_gold ? '–' : h`<span class="${n >= MIN_APPEARANCES ? 'ok' : 'warn'}">${n} of ${MIN_APPEARANCES}</span>`}</td>
          </tr>`;
        })}</tbody>
      </table>
      ${missingGender ? h`<p class="form-actions"><button class="button small ghost" type="submit">Save “plays as”</button> <span class="footnote">Needed so the app can check Men’s and Women’s doubles pairs. It cannot be changed here once saved.</span></p>` : ''}
      </form>
      ${used.length ? h`<p class="footnote">Tickets used: ${used.map((t) => {
        const m = state.matchById.get(t.match_id);
        return `${t.type === 'gold_player' ? 'Gold Player' : 'Golden Point'} in ${m ? showdownTitle(m.sd) : 'a match'}`;
      }).join(', ')}.</p>` : ''}
    </section>
  </div>
</main>`;
  return layout({ title: `${team.name} lineups`, body, user, active: 'captain', scripts: ['/js/forms.js'] });
}
