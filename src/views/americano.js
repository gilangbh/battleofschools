// Gold Americano: the desk page (scores, table, setup) and its TV screen.
import { h, raw, layout, teamMark, flash, ICON } from './ui.js';
import { MAX_POINTS } from '../americano.js';
import { tvFrame } from './public.js';

const opt = (value, label, selected) => h`<option value="${value}"${selected ? raw(' selected') : ''}>${label}</option>`;
const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const first = (name) => name.split(/\s+/)[0];

function face(am, p, cls = '') {
  if (!p) return h`<span class="am-face ${cls}">?</span>`;
  if (p.photo) return h`<span class="am-face ${cls}"><img src="/assets/players/${p.photo}" alt="" width="96" height="120"></span>`;
  const team = p.team_id ? am.teamById.get(p.team_id) : null;
  return h`<span class="am-face ${cls}${team ? ' is-crest' : ''}">${team ? teamMark(team) : initials(p.name)}</span>`;
}
const who = (am, id) => am.byId.get(id);
const pairText = (am, a, b) => `${who(am, a)?.name || '?'} / ${who(am, b)?.name || '?'}`;

function table(am) {
  const b = am.board;
  return h`<div class="table-scroll"><table class="tournament-table am-table">
    <thead><tr><th scope="col">Player</th><th scope="col">Played</th><th scope="col">W–D–L</th><th scope="col">Against</th><th scope="col">Points</th></tr></thead>
    <tbody>${b.rows.map((r) => h`<tr class="${am.placing.winner === r.player.id ? 'tournament-qualified' : ''}">
      <th scope="row"><span class="am-who"><b class="am-rank">${b.rows.some((x) => x.played) ? r.rank : '–'}</b>${face(am, r.player)}<span>${r.player.name}<small>${[r.player.label, am.placing.winner === r.player.id ? 'Winner' : am.placing.runner === r.player.id ? 'Runner-up' : ''].filter(Boolean).join(' · ')}</small></span></span></th>
      <td>${r.played}</td><td>${r.won}–${r.drawn}–${r.lost}</td><td>${r.against}</td><td><strong>${r.points}</strong></td></tr>`)}</tbody>
  </table></div>`;
}

export function americanoPage(am, user, query) {
  const b = am.board;
  const admin = user.role === 'admin';
  const tied = (rank) => b.rows.filter((r) => r.rank === rank).map((r) => r.player.name);
  const body = h`
<main id="main" class="page">
  <div class="tournament-hero"><div class="wrap"><p class="eyebrow"><a href="/desk">← Scoring desk</a> · Individual event · Championship Court 3 · 14:00 to 15:00</p><h1 class="page-title">Gold Americano</h1></div></div>
  <div class="wrap tournament-body">
    ${flash(query)}
    <p class="lock-banner"><b>Separate from the school tournament.</b> Nothing entered here touches school standings, regular-player appearances or the Golden Tickets.</p>

    ${am.matches.length ? h`<section aria-labelledby="am-scores"><h2 id="am-scores">Matches</h2>
      <p class="footnote">Enter the rally points each pair scored. There is no fixed total and a draw is allowed. Leave a match empty until it has been played; empty both boxes to remove a score.</p>
      <form method="post" action="/desk/americano/scores" data-dirty-form>
        <ul class="am-rounds" role="list">${am.matches.map((m) => h`<li class="am-round${m.status === 'done' ? ' is-done' : ''}">
          <p class="am-round-head"><b>Round ${m.round}</b>${m.bye != null ? h`<span>Sits out: ${who(am, m.bye)?.name || '?'}</span>` : ''}</p>
          <div class="am-match">
            <span class="am-pair">${pairText(am, m.a1, m.a2)}</span>
            <input type="number" inputmode="numeric" min="0" max="${MAX_POINTS}" step="1" name="a_${m.id}" value="${m.score_a ?? ''}" aria-label="Round ${m.round}, points for ${pairText(am, m.a1, m.a2)}">
            <i>–</i>
            <input type="number" inputmode="numeric" min="0" max="${MAX_POINTS}" step="1" name="b_${m.id}" value="${m.score_b ?? ''}" aria-label="Round ${m.round}, points for ${pairText(am, m.b1, m.b2)}">
            <span class="am-pair is-b">${pairText(am, m.b1, m.b2)}</span>
          </div></li>`)}</ul>
        <div class="save-bar"><button class="button" type="submit">Save scores</button><span class="save-note" data-dirty-note>No unsaved changes.</span></div>
      </form>
    </section>` : h`<p class="quiet-note">No rounds yet. ${admin ? 'Add the players below, then create the rounds.' : 'An admin adds the players and creates the rounds.'}</p>`}

    <section aria-labelledby="am-table"><h2 id="am-table">Individual table</h2>
      ${am.players.length ? table(am) : h`<p class="quiet-note">No players yet.</p>`}
      ${b.needsPlayoff && !am.placing.winner ? h`<p class="flash flash-error">${tied(1).length > 1 ? `${tied(1).join(', ')} are level for first place.` : `${tied(2).join(', ')} are level for second place.`} Play the deciding playoff on court, then an admin confirms the winner and runner-up below.</p>` : ''}
      ${am.placing.winner ? h`<p class="flash flash-ok">Winner: ${who(am, am.placing.winner)?.name}. Runner-up: ${who(am, am.placing.runner)?.name || 'not set'}.${am.placing.auto ? '' : ' Confirmed by an admin.'}</p>` : ''}
      <p class="footnote">Ranked by rally points won. Players level on points share a place; the app does not separate them. <a href="/tv/americano">Open the TV screen ↗</a></p>
    </section>

    ${admin ? h`<section aria-labelledby="am-setup"><h2 id="am-setup">Players and rounds</h2>
      <p class="footnote">These players are only for this event. Adding someone here does not make them a Gold Player for the school tournament.</p>
      <form method="post" action="/admin/americano/players">
        <div class="table-scroll"><table class="tournament-table admin-table">
          <thead><tr><th scope="col">Name</th><th scope="col">Shown as (school or “Free agent”)</th><th scope="col">Crest</th><th scope="col">Remove</th></tr></thead>
          <tbody>${[...am.players, { id: 'new', name: '', label: '', team_id: '' }].map((p) => h`<tr>
            <td><input type="text" name="name_${p.id}" value="${p.name}" maxlength="60" placeholder="${p.id === 'new' ? '+ Add a player' : ''}" aria-label="Name"></td>
            <td><input type="text" name="label_${p.id}" value="${p.label || ''}" maxlength="40" aria-label="Shown as"></td>
            <td><select name="team_${p.id}" aria-label="Crest">${opt('', 'None', !p.team_id)}${am.teams.map((t) => opt(t.id, t.name, p.team_id === t.id))}</select></td>
            <td>${p.id === 'new' ? '' : h`<input type="checkbox" name="del_${p.id}" aria-label="Remove ${p.name}">`}</td></tr>`)}</tbody>
        </table></div>
        <p class="form-actions"><button class="button small" type="submit">Save players</button></p>
      </form>
      <form method="post" action="/admin/americano/generate" class="am-generate"${am.matches.length ? raw(' data-confirm="Create the rounds again? Every Gold Americano score is removed."') : ''}>
        <p><b>${am.players.length} player${am.players.length === 1 ? '' : 's'}.</b> ${am.players.length === 5 ? 'Five rounds: everyone plays four matches, sits out once, and partners every other player once.' : am.players.length === 4 ? 'With four players the format is a draft only: three rounds, partnering each other player once. The committee has not confirmed it.' : 'The event needs five players (or four for the draft format).'}</p>
        ${am.players.length === 4 ? h`<label class="tick-line"><input type="checkbox" name="four" required> The committee has agreed to run the four-player draft format</label>` : ''}
        <button class="button ${am.matches.length ? 'ghost small' : 'lime'}" type="submit"${am.players.length === 5 || am.players.length === 4 ? '' : raw(' disabled')}>${am.matches.length ? 'Create the rounds again' : 'Create the rounds'}</button>
      </form>
      ${b.finished ? h`<form method="post" action="/admin/americano/placing" class="inline-row am-placing">
        <label>Winner <select name="winner">${opt('', b.winner ? `From the table: ${b.winner.name}` : 'Choose', !am.placing.manual)}${am.players.map((p) => opt(p.id, p.name, am.placing.manual && am.placing.winner === p.id))}</select></label>
        <label>Runner-up <select name="runner">${opt('', b.runnerUp ? `From the table: ${b.runnerUp.name}` : 'Choose', !am.placing.manual)}${am.players.map((p) => opt(p.id, p.name, am.placing.manual && am.placing.runner === p.id))}</select></label>
        <button class="button small" type="submit">Confirm after the playoff</button>
      </form>` : ''}
    </section>` : ''}
  </div>
</main>`;
  return layout({ title: 'Gold Americano', body, user, active: 'desk', scripts: ['/js/forms.js'] });
}

// ---------- TV ----------

export function americanoPartial(am) {
  const b = am.board;
  if (!am.players.length) return h`<p class="kb-empty">The Gold Americano players appear here once they are added.</p>`;
  const next = am.matches.find((m) => m.status !== 'done');
  const side = (m, ids, score, lead) => h`<div class="am-tv-side${lead ? ' is-w' : ''}">
    <span class="am-tv-faces">${ids.map((id) => face(am, who(am, id)))}</span>
    <span class="am-tv-names">${ids.map((id) => first(who(am, id)?.name || '?')).join(' / ')}</span>
    <b>${score ?? '–'}</b></div>`;
  const winner = am.placing.winner ? who(am, am.placing.winner) : null;
  const runner = am.placing.runner ? who(am, am.placing.runner) : null;
  return h`
<section class="am-tv" aria-label="Gold Americano">
  <div class="am-tv-col">
    ${winner ? h`<div class="am-tv-champ">${face(am, winner, 'is-big')}<div><small><span class="tournament-sport-mark">${ICON.trophy}</span>Gold Americano winner</small><strong>${winner.name}</strong>${runner ? h`<span>Runner-up: ${runner.name}</span>` : ''}</div></div>`
      : h`<div class="am-tv-intro"><small>Individual event · Championship Court 3</small><strong>Rally points, five rounds</strong><span>${b.needsPlayoff ? 'Level at the top: a playoff decides it' : 'New partner every round. Most points wins.'}</span></div>`}
    <table class="am-tv-table">
      <thead><tr><th></th><th scope="col">Player</th><th scope="col">Played</th><th scope="col">W–D–L</th><th scope="col">Points</th></tr></thead>
      <tbody>${b.rows.map((r) => h`<tr class="${am.placing.winner === r.player.id || (!am.placing.winner && r.rank === 1 && r.played) ? 'is-top' : ''}">
        <td class="am-tv-rank">${b.rows.some((x) => x.played) ? r.rank : '–'}</td>
        <th scope="row"><span class="am-tv-who">${face(am, r.player)}<span><b>${r.player.name}</b><small>${r.player.label || ''}</small></span></span></th>
        <td>${r.played}</td><td>${r.won}–${r.drawn}–${r.lost}</td><td class="am-tv-pts" data-k="ap${r.player.id}">${r.points}</td></tr>`)}</tbody>
    </table>
  </div>
  <div class="am-tv-col am-tv-rounds">${am.matches.length ? am.matches.map((m) => h`<article class="am-tv-round${m.status === 'done' ? ' is-done' : next && next.id === m.id ? ' is-next' : ''}">
    <header><b>Round ${m.round}</b><span>${m.bye != null ? `Sits out: ${first(who(am, m.bye)?.name || '?')}` : ''}</span><i class="sb-chip">${m.status === 'done' ? 'Final' : next && next.id === m.id ? 'Up next' : 'Later'}</i></header>
    <div class="am-tv-match">${side(m, [m.a1, m.a2], m.score_a, m.status === 'done' && m.score_a > m.score_b)}<span class="am-tv-v">v</span>${side(m, [m.b1, m.b2], m.score_b, m.status === 'done' && m.score_b > m.score_a)}</div>
  </article>`) : h`<p class="kb-empty">The rounds appear here once they are created.</p>`}</div>
</section>`;
}

export function americanoTvPage(state, qrSvg, publicUrl, { am }) {
  return tvFrame(state, qrSvg, publicUrl, { title: 'TV Gold Americano', words: ['Gold', 'Americano'], src: '/partial/tv-americano', inner: americanoPartial(am), bodyClass: 'sm-body am-body' });
}
