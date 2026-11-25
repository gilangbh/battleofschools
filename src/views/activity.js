import { h, raw, layout, teamMark, flash } from './ui.js';
import { STATIONS, FIELDS, AGG_LABEL, slotsFor, fmtPoints, fieldsFromRaw, ROUNDS, STATION_MAX, YARD_MAX, BONUS_MAX, RESULTS_NEEDED } from '../activity.js';

const LABEL = { recorded: 'Recorded', corrected: 'Corrected', removed: 'Removed', held: 'Held for review', released: 'Released from review', 'recorded, held': 'Recorded and held for review' };
const time = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

/** What was recorded for one attempt, in words. Names of spectators stay on this staff page only. */
function describe(stationId, r, playerName) {
  const x = r.raw || {};
  if (x.demo) return 'Demo result';
  if (x.quick) return `Quick entry from the overview table: ${fmtPoints(x.points)} points, no booth detail`;
  if (stationId === 'pin') return `${x.score} of 5 labels correct · ${playerName(x.player)}`;
  if (stationId === 'satu') return `Hopscotch ${fmtPoints(x.hop * 0.5)} + Blind Scoop ${fmtPoints(Math.min((x.bowl / 40) * 2.5, 2.5))} (${x.bowl} bowl points) · ${x.hopper}, ${x.scooper}`;
  if (stationId === 'accuracy') return `Shots ${x.shots.join(', ')} = ${x.shots.reduce((a, b) => a + b, 0)} · ${playerName(x.player)}`;
  if (stationId === 'on') return `${x.lengths} completed length${x.lengths === 1 ? '' : 's'} · ${x.runners}`;
  return `${x.result === 'done' ? `Completed${x.seconds != null ? ` in ${x.seconds} s` : ' within 30 s'}` : 'Not completed within 30 s'} · ${playerName(x.player)}`;
}

const QUICK_STEP = { pin: '1', satu: 'any', accuracy: 'any', on: '0.5', red_bull: '1' };

/** The overview of every school. Each cell holds the points per showdown and can be typed into directly. */
function overview(state, current, user) {
  const admin = user && user.role === 'admin';
  const rowsOf = new Map(state.teams.map((t) => [t.id, new Map(state.activityRows.filter((r) => r.team_id === t.id).map((r) => [`${r.station}:${r.slot}`, r]))]));
  return h`<div class="table-scroll"><table class="tournament-table yard-table">
    <thead><tr><th scope="col">School</th>${STATIONS.map((st) => h`<th scope="col">${st.name}<small class="yq-unit">${st.agg === 'single' ? 'whole event' : 'showdown 1 to 5'}</small></th>`)}<th scope="col">Starting points</th><th scope="col">So far</th><th scope="col"><span class="visually-hidden">Save</span></th></tr></thead>
    <tbody>${state.teams.map((t) => {
      const y = state.yardByTeam.get(t.id);
      const mine = rowsOf.get(t.id);
      const bonus = state.bonusByTeam.has(t.id) ? state.bonusByTeam.get(t.id) : null;
      const form = `qf-${t.id}`;
      const opp = (slot) => { const sd = state.showdowns.find((x) => x.stage === 'group' && x.round === slot && (x.team_a === t.id || x.team_b === t.id)); const o = sd ? (sd.team_a === t.id ? sd.b : sd.a) : null; return o ? ` v ${o.name}` : ''; };
      return h`<tr${current && current.id === t.id ? raw(' class="is-current"') : ''}><th scope="row"><a class="tournament-table-team" href="/desk/activity?team=${t.id}#st-pin">${teamMark(t)}<span>${t.name}</span></a></th>
        ${STATIONS.map((st) => {
          const s = y.stations[st.id];
          return h`<td class="yq-cell ${s.complete ? 'is-in' : ''}"><div class="yq-grid">${slotsFor(st).map((slot) => {
            const r = mine.get(`${st.id}:${slot}`);
            const label = `${st.name}, ${slot ? `showdown ${slot}${opp(slot)}` : 'whole event'}, ${t.name}`;
            const locked = r && (r.held || !r.raw?.quick);
            return locked
              ? h`<span class="yq-lock${r.held ? ' is-held' : ''}" title="${label}: recorded in detail${r.held ? ' and held for review' : ''}. Change it with the form for this school above.">${fmtPoints(r.score)}</span>`
              : h`<input type="number" inputmode="decimal" form="${form}" name="q_${st.id}_${slot}" min="0" max="${STATION_MAX}" step="${QUICK_STEP[st.id]}" value="${r ? r.score : ''}" placeholder="${slot || '–'}" title="${label}" aria-label="${label}">${r ? h`<input type="hidden" form="${form}" name="qv_${st.id}_${slot}" value="${r.updated_at}">` : h`<input type="hidden" form="${form}" name="qv_${st.id}_${slot}" value="0">`}`;
          })}</div><small>${s.count ? `${fmtPoints(s.points)} · ` : ''}${s.count}/${s.need} in</small></td>`;
        })}
        <td class="yq-cell">${admin
          ? h`<div class="yq-grid"><input type="number" inputmode="decimal" form="${form}" name="q_bonus" min="0" max="${BONUS_MAX}" step="0.5" value="${bonus === null ? '' : bonus}" placeholder="–" aria-label="Starting points for ${t.name}"></div><small>${bonus === null ? 'not set' : 'set'}</small>`
          : h`${bonus === null ? '–' : fmtPoints(bonus)}<small>${bonus === null ? 'not set' : 'set by admin'}</small>`}</td>
        <td><strong>${fmtPoints(y.banked + (bonus || 0))}</strong><small>${y.complete && bonus !== null ? 'final' : `${y.entered}/${y.needed} in`}</small></td>
        <td class="yq-save"><button class="button small" type="submit" form="${form}">Save</button></td></tr>`;
    })}</tbody>
  </table></div>
  ${state.teams.map((t) => h`<form method="post" action="/desk/activity-quick/${t.id}" id="qf-${t.id}" data-quick><input type="hidden" name="cur" value="${current ? current.id : t.id}"></form>`)}`;
}

function entryFields(state, team, st, slot, values) {
  const name = (k) => `a_${st.id}_${slot}_${k}`;
  const v = (k) => values[k] ?? '';
  const numField = (k, label, attrs) => h`<label class="yf">${label}<input type="number" inputmode="decimal" name="${name(k)}" value="${v(k)}"${raw(attrs)}></label>`;
  const textField = (k, label, wide) => h`<label class="yf${wide ? ' is-wide' : ''}">${label}<input type="text" name="${name(k)}" value="${v(k)}" maxlength="${wide ? 120 : 60}" autocomplete="off"></label>`;
  const refField = () => h`<label class="yf is-ref">Booth sheet no. (optional)<input type="text" name="${name('ref')}" value="${v('ref')}" maxlength="40" autocomplete="off"></label>`;
  const player = (label) => h`<label class="yf is-wide">${label}<select name="${name('player')}"><option value="">Choose player</option>${team.regulars.map((p) => h`<option value="${p.id}"${String(v('player')) === String(p.id) ? raw(' selected') : ''}>${p.name}</option>`)}</select></label>`;
  if (st.id === 'pin') return h`${numField('score', 'Correct labels, 0 to 5', ' min="0" max="5" step="1"')}${player('Registered player in the five')}${refField()}`;
  if (st.id === 'satu') return h`${numField('hop', 'Hopscotch achievements, 0 to 5', ' min="0" max="5" step="1"')}${numField('bowl', 'Blind Scoop bowl points', ' min="0" step="any"')}${textField('hopper', 'Hopper (spectator)')}${textField('scooper', 'Scooper (spectator)')}${refField()}`;
  if (st.id === 'accuracy') return h`<span class="yf-shots">${[1, 2, 3, 4, 5].map((i) => numField(`s${i}`, `Shot ${i}`, ' min="0" step="any"'))}</span>${player('Regular player who shot')}${refField()}`;
  if (st.id === 'on') return h`${numField('lengths', 'Completed 20 m lengths', ' min="0" max="60" step="1"')}${textField('runners', 'Runner, or both runners (spectators)', true)}${refField()}`;
  return h`<label class="yf is-wide">Relay result<select name="${name('result')}"><option value="">Choose</option><option value="done"${v('result') === 'done' ? raw(' selected') : ''}>Completed within 30 seconds</option><option value="not"${v('result') === 'not' ? raw(' selected') : ''}>Not completed within 30 seconds</option></select></label>${numField('seconds', 'Final flip, seconds (optional)', ' min="0" step="any"')}${player('Registered player in the four')}${refField()}`;
}

function teamForm(state, team, log, draft) {
  const y = state.yardByTeam.get(team.id);
  const rows = new Map(state.activityRows.filter((r) => r.team_id === team.id).map((r) => [`${r.station}:${r.slot}`, r]));
  const playerName = (id) => state.playerById.get(id)?.name || 'player not found';
  const opponents = new Map(state.showdowns.filter((sd) => sd.stage === 'group' && (sd.team_a === team.id || sd.team_b === team.id)).map((sd) => [sd.round, sd]));
  const bonus = state.bonusByTeam.has(team.id) ? state.bonusByTeam.get(team.id) : null;
  const holdBox = (st, slot, r) => h`<label class="yard-del"><input type="checkbox" name="hold_${st.id}_${slot}"${(draft ? draft[`hold_${st.id}_${slot}`] : r?.held) ? raw(' checked') : ''}> Hold for committee review: keep it on record but do not count it yet (for example a late or disputed attempt)</label>`;
  const draftFields = (st, slot) => (draft ? Object.fromEntries(FIELDS[st.id].map((k) => [k, draft[`a_${st.id}_${slot}_${k}`] ?? ''])) : null);

  const row = (st, slot) => {
    const r = rows.get(`${st.id}:${slot}`);
    const sd = opponents.get(slot);
    const opp = sd ? (sd.team_a === team.id ? sd.b : sd.a) : null;
    const when = slot === 0
      ? h`<b>Whole event</b><span>One official run</span>`
      : h`<b>Showdown ${slot}</b><span>${opp ? `v ${opp.name}` : 'Opponent not set'}${sd?.start_time ? ` · ${sd.start_time}` : ''}</span>`;
    const stored = fieldsFromRaw(st.id, r?.raw);
    const typed = draftFields(st, slot);
    const values = typed || stored;
    const version = h`<input type="hidden" name="v_${st.id}_${slot}" value="${draft ? draft[`v_${st.id}_${slot}`] ?? '0' : r ? r.updated_at : 0}">`;
    if (!r) return h`<li class="yard-row"><div class="yard-when">${when}</div><div class="yard-entry">${version}${entryFields(state, team, st, slot, values)}<details class="yard-more"><summary>More</summary>${holdBox(st, slot, null)}</details></div></li>`;
    const pid = `ya-${st.id}-${slot}`;
    const reopened = Boolean(draft && (draft[`del_${st.id}_${slot}`] || Boolean(draft[`hold_${st.id}_${slot}`]) !== Boolean(r.held) || FIELDS[st.id].some((k) => String(typed[k] ?? '') !== String(stored[k] ?? ''))));
    return h`<li class="yard-row is-done${r.held ? ' is-held' : ''}"><div class="yard-when">${when}</div>
      <div class="yard-result"><b>${fmtPoints(r.score)}</b><span>${r.held ? h`<em class="yard-held">Held for committee review · not counted</em> ` : ''}${describe(st.id, r, playerName)}${r.raw?.ref ? ` · sheet ${r.raw.ref}` : ''}</span><button type="button" class="pill" data-toggle="${pid}" aria-expanded="${reopened ? 'true' : 'false'}">Edit</button></div>
      <div class="yard-entry dm-panel" id="${pid}"${reopened ? '' : raw(' hidden')}>
        <p class="yard-fix">Only to correct a recording mistake. A later or better try does not replace the official attempt. The first entry stays in the change list.</p>
        ${version}${entryFields(state, team, st, slot, values)}
        ${holdBox(st, slot, r)}
        <label class="yard-del"><input type="checkbox" name="del_${st.id}_${slot}"${draft && draft[`del_${st.id}_${slot}`] ? raw(' checked') : ''}> Remove this result and set it back to pending</label>
      </div></li>`;
  };

  return h`<form method="post" action="/desk/activity/${team.id}" data-dirty-form class="yard-form">
    <div class="roster-head">${teamMark(team)}<div><h3>${team.name}</h3><p>School Yard so far: <b>${fmtPoints(y.banked)}</b> of ${YARD_MAX} · ${y.entered} of ${RESULTS_NEEDED} results in${y.held ? ` · ${y.held} held for review` : ''}${y.complete ? ' · complete' : ''}</p></div></div>
    <p class="footnote">Record the first eligible official attempt at each station. Leave a row empty while a result is missing: it stays pending and is never counted as zero. Enter 0 only for a real attempt that scored nothing.</p>
    ${STATIONS.map((st) => {
      const s = y.stations[st.id];
      return h`<section class="yard-st" aria-labelledby="st-${st.id}">
        <header class="yard-st-head"><h3 id="st-${st.id}">${st.name} <small>${st.by}</small></h3>
          <p class="yard-sum"><b>${s.count ? fmtPoints(s.points) : '–'}</b> of ${STATION_MAX} · ${s.count} of ${s.need} in · ${AGG_LABEL[st.agg]}</p></header>
        <p class="footnote">${st.who}</p>
        <ul class="yard-rows" role="list">${slotsFor(st).map((slot) => row(st, slot))}</ul>
      </section>`;
    })}
    <section class="yard-st" aria-labelledby="st-bonus">
      <header class="yard-st-head"><h3 id="st-bonus">Pre-event social challenge <small>Starting points</small></h3><p class="yard-sum"><b>${bonus === null ? '–' : fmtPoints(bonus)}</b> of ${BONUS_MAX}</p></header>
      <p class="footnote">Starting points from the pre-event social challenge, separate from the ${YARD_MAX} School Yard points. An admin sets them for every school before match day under Admin → Draw and fixtures.${bonus === null ? ' Not set yet for this school, so its semifinal place stays provisional.' : ''}</p>
    </section>
    <div class="save-bar"><button class="button" type="submit">Save ${team.name}</button><span class="save-note" data-dirty-note>No unsaved changes.</span></div>
  </form>
  ${log.length ? h`<details class="tournament-round yard-log"><summary>Changes for ${team.name} <span class="round-count">${log.length}${log.length === 40 ? '+' : ''}</span></summary>
    <ul class="plain-list">${log.map((l) => {
      const st = STATIONS.find((x) => x.id === l.station);
      return h`<li>${time(l.at)} · ${st ? st.name : 'School Spirit bonus'}${l.slot ? ` showdown ${l.slot}` : ''} · ${LABEL[l.action] || l.action}${l.score != null ? ` ${fmtPoints(l.score)}` : ''} · ${l.by_email || 'unknown'}</li>`;
    })}</ul></details>` : ''}`;
}

export function activityPage(state, user, { team, query, log = [], draft = null }) {
  const body = h`
<main id="main" class="page">
  <div class="tournament-hero"><div class="wrap"><p class="eyebrow"><a href="/desk">← Scoring desk</a></p><h1 class="page-title">School Yard points</h1></div></div>
  <div class="wrap tournament-body">
    ${flash(query)}
    <ul class="school-picker" role="list">${state.teams.map((t) => {
      const y = state.yardByTeam.get(t.id);
      return h`<li><a href="/desk/activity?team=${t.id}"${team && t.id === team.id ? raw(' aria-current="true"') : ''}>${teamMark(t)}<strong>${t.name}</strong><small>${y.entered} of ${y.needed} in</small></a></li>`;
    })}</ul>
    ${team ? teamForm(state, team, log, draft) : h`<p class="quiet-note">Choose a school to enter its station results.</p>`}
    <section aria-labelledby="yard-all"><h2 id="yard-all">All schools</h2>
      <p class="footnote"><b>Quick entry:</b> type the points a station earned in each showdown straight into a cell (the small boxes run showdown 1 to 5; On Running is one box), then press Save at the end of that row. Quick entries record the points only, with no player or spectator names, so use the school form above when you need those checks. A result recorded in detail shows as a fixed number and is changed with that form. Empty a box and save to set it back to pending. Pin the Cut, Satu Satu and Accuracy count as the average of five showdowns, so each recorded attempt adds a fifth of its score. On Running is one result for the whole event. Flip Cup is the sum of five relays. A school’s ${YARD_MAX} is final once all ${RESULTS_NEEDED} results are in. Showdown numbers follow the group rounds, ${ROUNDS} per school.</p>
      ${overview(state, team, user)}
    </section>
  </div>
</main>`;
  return layout({ title: 'School Yard points', body, user, active: 'desk', scripts: ['/js/forms.js'] });
}
