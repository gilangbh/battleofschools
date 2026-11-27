// School Yard Champion: the separate ledger of each supporter's raw result at each station.
// It never feeds the school standings, and credited points stay pending until the award policy is approved.
import { h, raw, layout, teamMark, flash } from './ui.js';

export const AWARD_STATIONS = [
  { id: 'pin', name: 'Pin the Cut' }, { id: 'satu', name: 'Satu Satu' }, { id: 'accuracy', name: 'Accuracy' }, { id: 'on', name: 'On Running' }, { id: 'red_bull', name: 'Flip Cup' },
];
export const AWARD_KINDS = [
  ['spectator', 'Spectator'], ['cheer', 'Cheer squad'], ['gold', 'Gold Player'], ['player', 'Registered player'], ['unverified', 'Not verified yet'],
];
const KIND_LABEL = Object.fromEntries(AWARD_KINDS);
const NEW_ROWS = 8;

export function awardPage(state, user, { team, query, records, counts, standing = [], log = [], draft = null }) {
  const admin = user.role === 'admin';
  // One line per person, with their stations across.
  const people = new Map();
  for (const r of records) {
    const p = people.get(r.person_key) || { person: r.person, kind: r.kind, ref: r.ref, byStation: new Map() };
    p.byStation.set(r.station, r);
    people.set(r.person_key, p);
  }
  const d = (name) => (draft ? draft[name] ?? '' : '');
  const body = h`
<main id="main" class="page">
  <div class="tournament-hero"><div class="wrap"><p class="eyebrow"><a href="/desk">← Scoring desk</a> · Separate from the school standings</p><h1 class="page-title">School Yard Champion ledger</h1></div></div>
  <div class="wrap tournament-body">
    ${flash(query)}
    <p class="lock-banner"><b>One verified point per person per station.</b> Once for the whole event, at most five per person, no cap on a school’s total. Satu Satu is one station. A failed or zero-score attempt still counts; queueing, scanning or a gift alone does not. Unverified records stay pending.</p>
    <section aria-labelledby="champ-h"><h2 id="champ-h">School Yard Champion standing</h2>
      ${standing.length ? h`<div class="table-scroll"><table class="tournament-table champ-table">
        <thead><tr><th scope="col">Position</th><th scope="col">School</th><th scope="col">Points</th><th scope="col">People</th><th scope="col">Fewest at a station</th></tr></thead>
        <tbody>${standing.map((r) => h`<tr><td>${r.rank}${r.level ? ' =' : ''}</td><th scope="row">${state.teamById.get(r.team)?.name || r.team}</th><td><strong>${r.total}</strong></td><td>${r.people}</td><td>${r.minimum}</td></tr>`)}</tbody></table></div>`
        : h`<p class="quiet-note">No verified participation yet.</p>`}
      <p class="footnote">Ordered by points, then different people, then the fewest participants at any one station (higher wins). Schools marked = are still level and need a witnessed public draw. Staff only: this is not shown on any public screen.</p>
    </section>
    <ul class="school-picker" role="list">${state.teams.map((t) => {
      const c = counts.get(t.id) || { people: 0, records: 0 };
      return h`<li><a href="/desk/award?team=${t.id}"${team && t.id === team.id ? raw(' aria-current="true"') : ''}>${teamMark(t)}<strong>${t.name}</strong><small>${c.people} people · ${c.records} records</small></a></li>`;
    })}</ul>

    ${team ? h`
    <form method="post" action="/desk/award/${team.id}" data-dirty-form>
      <div class="roster-head">${teamMark(team)}<div><h3>${team.name}</h3><p>Copy each line of the school’s person ledger sheet. Type the raw result exactly as written; leave a station empty if the person did not play it.</p></div></div>
      <div class="table-scroll"><table class="tournament-table admin-table award-entry">
        <thead><tr><th scope="col">Person</th><th scope="col">Bracelet or ID (optional)</th><th scope="col">Who they are</th>${AWARD_STATIONS.map((s) => h`<th scope="col">${s.name}</th>`)}<th scope="col">Sheet and row</th></tr></thead>
        <tbody>${Array.from({ length: NEW_ROWS }, (_, i) => h`<tr>
          <td><input type="text" name="p_${i}" value="${d(`p_${i}`)}" maxlength="80" autocomplete="off" aria-label="Person, line ${i + 1}"></td>
          <td><input type="text" name="id_${i}" value="${d(`id_${i}`)}" maxlength="40" autocomplete="off" aria-label="Bracelet or ID, line ${i + 1}"></td>
          <td><select name="k_${i}" aria-label="Who they are, line ${i + 1}">${AWARD_KINDS.map(([k, label]) => h`<option value="${k}"${d(`k_${i}`) === k ? raw(' selected') : ''}>${label}</option>`)}</select></td>
          ${AWARD_STATIONS.map((s) => h`<td><input type="text" name="r_${i}_${s.id}" value="${d(`r_${i}_${s.id}`)}" maxlength="40" autocomplete="off" aria-label="${s.name} raw result, line ${i + 1}"></td>`)}
          <td><input type="text" name="ref_${i}" value="${d(`ref_${i}`)}" maxlength="40" autocomplete="off" aria-label="Sheet and row, line ${i + 1}"></td></tr>`)}</tbody>
      </table></div>
      <div class="save-bar"><button class="button" type="submit">Save these lines</button><span class="save-note" data-dirty-note>No unsaved changes.</span></div>
    </form>

    <section aria-labelledby="award-list"><h2 id="award-list">${team.name}: recorded so far</h2>
      ${people.size ? h`<div class="table-scroll"><table class="tournament-table award-list">
        <thead><tr><th scope="col">Person</th><th scope="col">Who they are</th>${AWARD_STATIONS.map((s) => h`<th scope="col">${s.name}</th>`)}<th scope="col">Points</th></tr></thead>
        <tbody>${[...people.values()].map((p) => h`<tr><th scope="row">${p.person}</th><td>${KIND_LABEL[p.kind] || p.kind}</td>
          ${AWARD_STATIONS.map((s) => { const r = p.byStation.get(s.id); return h`<td>${r ? h`<label class="award-v" title="Verified participation"><input type="hidden" form="aw-verify" name="seen_${r.id}" value="1"><input type="checkbox" form="aw-verify" name="v_${r.id}"${r.verified ? raw(' checked') : ''} aria-label="Verified: ${p.person}, ${s.name}"></label><span class="award-raw">${r.raw}</span>${r.ref ? h`<small>${r.ref}</small>` : ''}${admin ? h`<button class="fx-del" type="submit" form="aw-del-${r.id}" aria-label="Remove ${p.person}, ${s.name}" title="Remove this record">×</button>` : ''}` : '–'}</td>`; })}
          <td>${(() => { const all5 = [...p.byStation.values()]; const done = all5.filter((r) => r.verified).length; return h`<strong>${done}</strong>${done < all5.length ? h` <span class="chip">${all5.length - done} pending</span>` : ''}`; })()}</td></tr>`)}</tbody>
      </table></div>
      <form method="post" action="/desk/award/${team.id}/verify" id="aw-verify"><p class="form-actions"><button class="button small" type="submit">Save verification</button> <span class="footnote">Tick each result whose participation you have checked, then save.</span></p></form>
      ${admin ? records.map((r) => h`<form method="post" action="/admin/award/${r.id}/delete" id="aw-del-${r.id}" data-confirm="Remove this record? It stays in the change list."></form>`) : ''}`
        : h`<p class="quiet-note">Nothing recorded for this school yet.</p>`}
      ${log.length ? h`<details class="tournament-round yard-log"><summary>Changes for ${team.name} <span class="round-count">${log.length}${log.length === 60 ? '+' : ''}</span></summary>
        <ul class="plain-list">${log.map((l) => h`<li>${new Date(l.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })} · ${l.action} · ${l.person} · ${AWARD_STATIONS.find((s) => s.id === l.station)?.name || l.station} · ${l.raw} · ${l.by_email || 'unknown'}</li>`)}</ul></details>` : ''}
    </section>` : h`<p class="quiet-note">Choose a school to copy in its person ledger.</p>`}
  </div>
</main>`;
  return layout({ title: 'School Yard Champion ledger', body, user, active: 'desk', scripts: ['/js/forms.js'] });
}
