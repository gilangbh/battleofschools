import { h, raw, layout, teamMark, categoryTag, showdownTitle, scoreText, flash, LEVEL_LABEL } from './ui.js';
import { isKnockout, ticketBalance, GOLD_DEPLOYMENTS, GOLDEN_POINTS, GROUP_GAMES, KNOCKOUT_TARGET, CATEGORY_LABEL } from '../rules.js';

const SHORT = { men: 'Men’s', women: 'Women’s', open: 'Open' };
const roundTitle = (sd) => (sd.stage === 'group' ? `Round ${sd.round}` : sd.stage === 'semi' ? 'Semifinals' : showdownTitle(sd));
const statusChip = (m) => h`<span class="state state-${m.status}">${m.status === 'live' ? `On ${m.court || 'court'}` : m.status === 'done' ? 'Finished' : 'Not started'}</span>`;

// ---------- Desk home: courts first, then the rounds ----------

export function deskPage(state, user, query) {
  const rounds = [...new Set(state.showdowns.map((s) => s.round))];
  const ofRound = (r) => state.showdowns.filter((s) => s.round === r);
  const current = rounds.find((r) => ofRound(r).some((s) => !s.summary.complete)) ?? rounds[rounds.length - 1];

  const courtTile = (court) => {
    const m = state.live.find((x) => x.court === court);
    if (!m) return h`<li class="court-tile is-free"><span class="court-name">${court}</span><span class="court-free">Free</span></li>`;
    return h`<li class="court-tile is-busy"><a href="/desk/showdown/${m.sd.id}#match-${m.id}">
      <span class="court-name">${court}<span class="court-cat">${SHORT[m.category]}</span></span>
      <span class="court-line"><span>${m.sd.a?.name}</span><b>${m.score_a ?? 0}</b></span>
      <span class="court-line"><span>${m.sd.b?.name}</span><b>${m.score_b ?? 0}</b></span>
    </a></li>`;
  };
  const noCourt = state.live.filter((m) => !m.court || !state.courts.includes(m.court));

  const row = (sd) => {
    const s = sd.summary;
    const ko = isKnockout(sd.stage);
    return h`<li><a class="desk-item" href="/desk/showdown/${sd.id}">
      <span class="desk-teams">${teamMark(sd.a)}<strong>${sd.a ? sd.a.name : 'To be decided'}</strong><span>v</span>${teamMark(sd.b)}<strong>${sd.b ? sd.b.name : 'To be decided'}</strong></span>
      <span class="desk-meta">${[sd.start_time, sd.court].filter(Boolean).join(' · ')}</span>
      <span class="desk-states">${sd.matches.map((m) => h`<span class="state state-${m.status}">${SHORT[m.category]}${m.status === 'done' ? h` <b>${scoreText(m)}</b>` : m.status === 'live' ? h` · ${m.court || 'on court'}` : ''}</span>`)}</span>
      ${s.done ? h`<span class="desk-total">${ko ? s.catsA : s.gamesA}–${ko ? s.catsB : s.gamesB}</span>` : h`<span class="desk-total is-empty">Open</span>`}
    </a></li>`;
  };

  const body = h`
<main id="main" class="page">
  <div class="tournament-hero"><div class="wrap hero-row"><h1 class="page-title">Scoring desk</h1><a class="button small outline" href="/desk/challenge">Challenge points</a></div></div>
  <div class="wrap tournament-body">
    ${flash(query)}
    <section aria-labelledby="courts-h">
      <h2 id="courts-h">Courts</h2>
      <ul class="court-strip" role="list">${state.courts.map(courtTile)}${noCourt.map((m) => courtTile(m.court))}</ul>
    </section>
    <section aria-labelledby="rounds-h">
      <h2 id="rounds-h">Showdowns</h2>
      ${state.showdowns.length === 0 ? h`<p class="quiet-note">No fixtures yet. An admin creates them after the draw.</p>` : ''}
      <div class="tournament-rounds">${rounds.map((r) => {
        const sds = ofRound(r);
        const done = sds.filter((s) => s.summary.complete).length;
        return h`<details class="tournament-round"${r === current ? raw(' open') : ''}>
          <summary>${roundTitle(sds[0])} <span class="round-count">${done === sds.length ? 'finished' : `${done}/${sds.length} finished`}</span></summary>
          <ul class="desk-list" role="list">${sds.map(row)}</ul>
        </details>`;
      })}</div>
    </section>
  </div>
</main>`;
  return layout({ title: 'Scoring desk', body, user, active: 'desk' });
}

// ---------- One showdown: three match cards ----------

function courtChips(state, m, formId) {
  const busy = new Map(state.live.filter((x) => x.id !== m.id && x.court).map((x) => [x.court, x]));
  return h`<div class="court-chips" role="radiogroup" aria-label="Court">${state.courts.map((c, i) => {
    const b = busy.get(c);
    return h`<label class="court-chip${b ? ' is-busy' : ''}" title="${b ? `${b.sd.a?.name} v ${b.sd.b?.name} is on this court` : c}">
      <input type="radio" name="court" value="${c}" form="${formId}"${m.court === c ? raw(' checked') : ''}${b ? raw(' disabled') : ''}><span>${c.replace(/^court\s*/i, '') || i + 1}</span></label>`;
  })}</div>`;
}

function teamBlock(state, m, side) {
  const sd = m.sd;
  const team = side === 'a' ? sd.a : sd.b;
  const l = m.lineup[side];
  const ko = isKnockout(sd.stage);
  const max = ko ? KNOCKOUT_TARGET : GROUP_GAMES;
  const score = side === 'a' ? m.score_a : m.score_b;
  const mine = m.tickets.filter((t) => t.team_id === team.id);
  const bal = ticketBalance(state.ticketsByTeam.get(team.id) || []);
  const hasGold = mine.some((t) => t.type === 'gold_player');
  const hasPoint = mine.some((t) => t.type === 'golden_point');
  const canPoint = bal.pointLeft > 0 && !hasGold;
  const canGoldHere = bal.goldLeft > 0 && !hasGold && !hasPoint && Boolean(team.gold);
  const left = canPoint || canGoldHere ? 1 : 0;
  const pid = `${m.id}-${side}`;
  const sel = (name, selected) => h`<select name="${name}" required aria-label="${name === 'p1' ? 'First player' : 'Second player'}"><option value="">Choose player</option>${team.regulars.map((p) => h`<option value="${p.id}"${selected === p.id ? raw(' selected') : ''}>${p.name} · ${LEVEL_LABEL[p.level]}${p.gender ? ` · ${p.gender}` : ''}</option>`)}</select>`;

  return h`<div class="dm-team">
    <div class="dm-team-main">
      <p class="dm-team-name">${teamMark(team)}<strong>${team.name}</strong></p>
      <p class="dm-pair">${l ? h`<span>${l.player1?.name} / ${l.player2?.name}</span>` : h`<span class="is-missing">No lineup yet</span>`}
        <button type="button" class="pill" data-toggle="lu-${pid}" aria-expanded="false">${l ? 'Edit' : 'Add'}</button>
        ${ko ? '' : left > 0 ? h`<button type="button" class="pill pill-gold" data-toggle="tk-${pid}" aria-expanded="false">★ Ticket <small>Gold ${bal.goldLeft} · Point ${bal.pointLeft}</small></button>` : h`<span class="pill is-off">★ None available</span>`}
      </p>
      ${mine.length ? h`<ul class="dm-tix" role="list">${mine.map((t) => {
        const out = state.playerById.get(t.player_out);
        return h`<li>★ ${t.type === 'gold_player' ? `Gold Player for ${out ? out.name : '?'}${t.timing === 'start' ? '' : ' after game 2'}` : 'Golden Point'}
          <form method="post" action="/desk/ticket/${t.id}/delete"><button type="submit" aria-label="Remove this ticket" title="Remove">×</button></form></li>`;
      })}</ul>` : ''}
    </div>
    ${m.status === 'done'
      ? h`<span class="dm-score-final">${score}</span>`
      : h`<div class="stepper">
        <button type="button" data-step="-1" aria-label="One game less for ${team.name}">−</button>
        <input type="number" name="${side}" form="sf-${m.id}" min="0" max="${max}" inputmode="numeric" value="${score ?? 0}" aria-label="Games won by ${team.name}" required>
        <button type="button" data-step="1" aria-label="One game more for ${team.name}">+</button>
      </div>`}

    <div class="dm-panel" id="lu-${pid}" hidden>
      <form method="post" action="/desk/match/${m.id}/lineup/${side}" class="panel-row">${sel('p1', l?.p1)}${sel('p2', l?.p2)}<button class="button small" type="submit">Save pair</button></form>
      ${l ? h`<form method="post" action="/desk/match/${m.id}/lineup/${side}/clear"><button class="link-button" type="submit">Clear, so the captain can submit again</button></form>` : ''}
    </div>

    ${ko || left <= 0 ? '' : h`<form class="dm-panel dm-ticket" id="tk-${pid}" method="post" action="/desk/match/${m.id}/ticket" hidden>
      <input type="hidden" name="team" value="${team.id}">
      <p class="panel-title">Tickets for ${team.name} <small>Gold Player ${bal.goldLeft} of ${GOLD_DEPLOYMENTS} · Golden Point ${bal.pointLeft} of ${GOLDEN_POINTS}</small></p>
      ${canPoint ? h`<div class="ticket-option">
        <button class="button small lime" type="submit" name="use" value="point">Golden Point</button>
        <span>Called at 40–40: wins the point and the game. If both schools call it, record only the school that won the rock-paper-scissors.</span>
      </div>` : h`<div class="ticket-option"><span class="is-missing">${hasGold ? 'No Golden Point here: this school has a Gold Player in this match.' : 'No Golden Points left.'}</span></div>`}
      ${canGoldHere ? h`<div class="ticket-option is-stack">
        <span><strong>${team.gold.name} ★</strong> plays instead of (same gender only):</span>
        ${l ? h`<div class="ticket-buttons">${[l.player1, l.player2].filter(Boolean).map((p) => h`<button class="button small lime" type="submit" name="use" value="out:${p.id}">${p.name}</button>`)}</div>
          <div class="ticket-when"><label><input type="radio" name="timing" value="start" checked> Before the first serve</label><label><input type="radio" name="timing" value="after_g2"> After game 2</label></div>`
          : h`<span class="is-missing">Add the pair first.</span>`}
      </div>` : h`<div class="ticket-option"><span class="is-missing">${hasGold ? 'Gold Player already in this match.' : hasPoint ? 'No Gold Player here: this school used a Golden Point in this match.' : !team.gold ? 'This school has no approved Gold Player.' : 'No Gold Player deployments left.'}</span></div>`}
    </form>`}
  </div>`;
}

function matchCard(state, m) {
  const sd = m.sd;
  const ko = isKnockout(sd.stage);
  const ready = sd.a && sd.b;
  const rule = ko ? 'First to 6. At 5–5 a tiebreak decides it, so the final score is 6–5.' : `${GROUP_GAMES} games are played, so the scores add up to ${GROUP_GAMES}.`;
  if (!ready) return h`<article class="dm dm-scheduled" id="match-${m.id}"><header class="dm-head"><h2>${categoryTag(m.category)}</h2></header><p class="quiet-note">Both schools must be set before this match can be scored.</p></article>`;

  const tiebreak = (formId) => (ko ? h`<div class="tb-row"><span>Tiebreak points, only at 5–5</span>
    <input type="number" name="tba" form="${formId}" min="0" max="20" inputmode="numeric" value="${m.tb_a ?? ''}" aria-label="Tiebreak points, ${sd.a.name}"><b>–</b>
    <input type="number" name="tbb" form="${formId}" min="0" max="20" inputmode="numeric" value="${m.tb_b ?? ''}" aria-label="Tiebreak points, ${sd.b.name}"></div>` : '');

  return h`<article class="dm dm-${m.status}" id="match-${m.id}" data-total="${ko ? '' : GROUP_GAMES}" data-target="${ko ? KNOCKOUT_TARGET : ''}">
    <header class="dm-head"><h2>${categoryTag(m.category)}</h2>${statusChip(m)}</header>

    ${m.status === 'scheduled' ? h`<form method="post" action="/desk/match/${m.id}/court" id="cf-${m.id}" class="dm-court">
      <span class="dm-label">Court</span>${courtChips(state, m, `cf-${m.id}`)}
      <button class="button small lime" type="submit" name="go" value="live">Start match</button>
    </form>` : ''}

    ${teamBlock(state, m, 'a')}
    ${teamBlock(state, m, 'b')}

    ${m.status === 'done' ? h`
      <div class="dm-actions"><button type="button" class="pill" data-toggle="fix-${m.id}" aria-expanded="false">Edit score</button></div>
      <div class="dm-panel" id="fix-${m.id}" hidden>
        <form method="post" action="/desk/match/${m.id}/score" id="sf-${m.id}" class="fix-row">
          <input type="number" name="a" min="0" max="${ko ? KNOCKOUT_TARGET : GROUP_GAMES}" value="${m.score_a}" aria-label="Games won by ${sd.a.name}" required><b>–</b>
          <input type="number" name="b" min="0" max="${ko ? KNOCKOUT_TARGET : GROUP_GAMES}" value="${m.score_b}" aria-label="Games won by ${sd.b.name}" required>
          <button class="button small" type="submit" name="mode" value="final">Save correction</button>
        </form>
        ${tiebreak(`sf-${m.id}`)}
        <form method="post" action="/desk/match/${m.id}/reopen" data-confirm="Remove this score and reopen the match?"><button class="link-button" type="submit">Reopen the match and remove the score</button></form>
      </div>` : h`
      ${tiebreak(`sf-${m.id}`)}
      <form method="post" action="/desk/match/${m.id}/score" id="sf-${m.id}" class="dm-actions"${m.status === 'live' ? raw(' data-live') : ''}>
        <button class="button" type="submit" name="mode" value="final">Save final score</button>
        <p class="dm-hint" data-hint data-rule="${rule}">${rule}</p>
      </form>
      ${m.status === 'live' ? h`<div class="dm-foot">
        <span class="autosave">Each tap on + or − updates the scoreboards.</span>
        <button type="button" class="pill" data-toggle="mv-${m.id}" aria-expanded="false">Change court</button>
      </div>
      <form class="dm-panel dm-court" id="mv-${m.id}" method="post" action="/desk/match/${m.id}/court" hidden>
        ${courtChips(state, m, `mv-${m.id}`)}
        <button class="button small" type="submit" name="go" value="save">Move</button>
        <button class="button small ghost" type="submit" name="go" value="scheduled">Take off court</button>
      </form>` : ''}`}
  </article>`;
}

export function deskShowdownPage(state, user, sd, query) {
  const s = sd.summary;
  const ko = isKnockout(sd.stage);
  const body = h`
<main id="main" class="page">
  <div class="tournament-hero"><div class="wrap">
    <p class="eyebrow"><a href="/desk">← Scoring desk</a> · ${showdownTitle(sd)}${sd.start_time ? ` · ${sd.start_time}` : ''}</p>
    <h1 class="page-title showdown-title">${teamMark(sd.a)} ${sd.a ? sd.a.name : 'To be decided'} ${s.done ? h`<b class="showdown-total">${ko ? s.catsA : s.gamesA}–${ko ? s.catsB : s.gamesB}</b>` : h`<span>v</span>`} ${teamMark(sd.b)} ${sd.b ? sd.b.name : 'To be decided'}</h1>
  </div></div>
  <div class="wrap tournament-body">
    ${flash(query)}
    <div class="desk-matches">${sd.matches.map((m) => matchCard(state, m))}</div>
  </div>
</main>`;
  return layout({ title: 'Score entry', body, user, active: 'desk', scripts: ['/js/forms.js'] });
}

export function challengePage(state, user, query) {
  const pts = new Map(state.challengeRows.map((c) => [`${c.team_id}:${c.station_id}`, c.points]));
  const body = h`
<main id="main" class="page">
  <div class="tournament-hero"><div class="wrap"><p class="eyebrow"><a href="/desk">← Scoring desk</a></p><h1 class="page-title">Festival Challenge points</h1></div></div>
  <div class="wrap tournament-body">
    ${flash(query)}
    ${state.stations.length === 0
      ? h`<p class="quiet-note">No challenge stations yet. An admin adds them under Admin → Settings. Until then the standings show padel games only.</p>`
      : h`<form method="post" action="/desk/challenge">
        <div class="table-scroll"><table class="tournament-table challenge-table">
          <thead><tr><th scope="col">School</th>${state.stations.map((st) => h`<th scope="col">${st.name}</th>`)}<th scope="col">Total</th></tr></thead>
          <tbody>${state.teams.map((t) => h`<tr><th scope="row"><span class="tournament-table-team">${teamMark(t)}<span>${t.name}</span></span></th>
            ${state.stations.map((st) => h`<td><input type="number" step="0.1" min="0" inputmode="decimal" name="c_${t.id}_${st.id}" value="${pts.get(`${t.id}:${st.id}`) ?? ''}" aria-label="${t.name}, ${st.name}"></td>`)}
            <td><strong>${(state.challengeByTeam.get(t.id) || 0).toFixed(1)}</strong></td></tr>`)}</tbody>
        </table></div>
        <p class="form-actions"><button class="button" type="submit">Save challenge points</button></p>
      </form>`}
  </div>
</main>`;
  return layout({ title: 'Challenge points', body, user, active: 'desk' });
}

export { CATEGORY_LABEL };
