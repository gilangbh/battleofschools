import { h, raw, layout, teamMark, showdownTitle, flash } from './ui.js';
import { STAGE_LABEL } from '../rules.js';

const TABS = [['setup', 'Draw and fixtures'], ['people', 'Logins'], ['players', 'Players'], ['settings', 'Settings']];
const opt = (value, label, selected) => h`<option value="${value}"${selected ? raw(' selected') : ''}>${label}</option>`;

function setupTab(state) {
  const teamOptions = (sel) => h`<option value="">To be decided</option>${state.teams.map((t) => opt(t.id, t.name, sel === t.id))}`;
  return h`
<section><h2>1. Groups</h2>
  <p>After the live draw on 25 November, put five schools in each group.</p>
  <form method="post" action="/admin/groups">
    <ul class="group-grid" role="list">${state.teams.map((t) => h`<li>${teamMark(t)}<span>${t.name}</span>
      <select name="grp_${t.id}" aria-label="Group for ${t.name}">${opt('', 'No group', !t.grp)}${opt('A', 'Group A', t.grp === 'A')}${opt('B', 'Group B', t.grp === 'B')}</select></li>`)}</ul>
    <p class="form-actions"><button class="button" type="submit">Save groups</button></p>
  </form>
</section>

<section><h2>2. Fixtures</h2>
  <p>“Generate” builds five rounds where every school meets all five schools in the other group, plus two semifinals and a final. Then edit any showdown to match the actual draw, and add times and courts.</p>
  <form method="post" action="/admin/fixtures/generate" data-confirm="This deletes all existing fixtures, lineups and scores. Continue?">
    <button class="button ${state.showdowns.length ? 'ghost' : 'lime'}" type="submit">${state.showdowns.length ? 'Regenerate all fixtures' : 'Generate fixtures'}</button>
  </form>
  ${state.showdowns.length ? h`<div class="table-scroll"><table class="tournament-table admin-table">
    <thead><tr><th scope="col">Round</th><th scope="col">School A</th><th scope="col">School B</th><th scope="col">Time</th><th scope="col">Court</th><th scope="col"></th></tr></thead>
    <tbody>${state.showdowns.map((sd) => h`<tr>
      <th scope="row">${showdownTitle(sd)}</th>
      <td><select name="team_a" form="sd-${sd.id}" aria-label="School A">${teamOptions(sd.team_a)}</select></td>
      <td><select name="team_b" form="sd-${sd.id}" aria-label="School B">${teamOptions(sd.team_b)}</select></td>
      <td><input type="time" name="start_time" form="sd-${sd.id}" value="${sd.start_time || ''}" aria-label="Start time"></td>
      <td><select name="court" form="sd-${sd.id}" aria-label="Court">${opt('', 'Not set', !sd.court)}${state.courts.map((c) => opt(c, c, sd.court === c))}</select></td>
      <td class="row-actions"><form method="post" action="/admin/showdown/${sd.id}" id="sd-${sd.id}"><button class="button small" type="submit">Save</button></form>
        <form method="post" action="/admin/showdown/${sd.id}/delete" data-confirm="Delete this showdown and its scores?"><button class="link-button" type="submit">Delete</button></form></td>
    </tr>`)}</tbody>
  </table></div>
  <form method="post" action="/admin/showdown" class="inline-row">
    <label>Add a showdown <select name="stage">${Object.entries(STAGE_LABEL).map(([k, v]) => opt(k, v, false))}</select></label>
    <label>Round number <input type="number" name="round" min="1" max="20" value="1" required></label>
    <button class="button small ghost" type="submit">Add</button>
  </form>` : ''}
</section>

<section><h2>3. Semifinals and final</h2>
  <p>When the group stage is finished, this puts A1 v A2 and B1 v B2 into the semifinals. Run it again after the semifinals to set the final. You can also set the schools by hand in the table above.</p>
  <form method="post" action="/admin/knockout/fill"><button class="button" type="submit">Fill from current results</button></form>
</section>`;
}

function peopleTab(state, users, origin) {
  return h`
<section><h2>Logins</h2>
  <p>Captains manage their own school’s lineups. Desk staff enter scores. Everyone signs in with an emailed link; “Create link” gives you a link to send yourself (for example by WhatsApp) that works once within three days.</p>
  <div class="table-scroll"><table class="tournament-table admin-table">
    <thead><tr><th scope="col">Email</th><th scope="col">Name</th><th scope="col">Role</th><th scope="col">School</th><th scope="col"></th></tr></thead>
    <tbody>${users.map((u) => h`<tr><th scope="row">${u.email}</th><td>${u.name || ''}</td><td>${u.role}</td><td>${u.team_id ? state.teamById.get(u.team_id)?.name : '–'}</td>
      <td class="row-actions"><form method="post" action="/admin/users/${u.id}/link"><button class="button small ghost" type="submit">Create link</button></form>
      <form method="post" action="/admin/users/${u.id}/delete" data-confirm="Remove ${u.email}?"><button class="link-button" type="submit">Remove</button></form></td></tr>`)}</tbody>
  </table></div>
  <h3>Add a login</h3>
  <form method="post" action="/admin/users" class="grid-form">
    <label>Email <input type="email" name="email" required></label>
    <label>Name <input type="text" name="name"></label>
    <label>Role <select name="role">${opt('captain', 'Captain', true)}${opt('desk', 'Scoring desk', false)}${opt('admin', 'Admin', false)}</select></label>
    <label>School (captains only) <select name="team_id"><option value="">None</option>${state.teams.map((t) => opt(t.id, t.name, false))}</select></label>
    <button class="button" type="submit">Add login</button>
  </form>
  <p class="footnote">Links are built with this address: ${origin}</p>
</section>`;
}

function playersTab(state) {
  return h`
<section><h2>Players</h2>
  <p>Names and levels were imported from the school pages on battleofschools.id. Gender is not published there, so set it here (or let each captain set it). Add each school’s approved Gold Player with the “Gold Player” box ticked.</p>
  ${state.teams.map((t) => {
    const everyone = state.allPlayers.filter((p) => p.team_id === t.id);
    return h`<details class="tournament-round"><summary>${t.name} <span class="round-count">${everyone.filter((p) => p.active && !p.is_gold).length} regular players${everyone.some((p) => p.active && p.is_gold) ? ' + Gold Player' : ''}</span></summary>
    <form method="post" action="/admin/players/${t.id}">
      <div class="table-scroll"><table class="tournament-table admin-table">
        <thead><tr><th scope="col">Name</th><th scope="col">Level</th><th scope="col">Under review</th><th scope="col">Gender</th><th scope="col">Captain</th><th scope="col">Gold Player</th><th scope="col">Active</th></tr></thead>
        <tbody>${[...everyone, { id: 'new', name: '', level: 'bronze', active: 1 }].map((p) => h`<tr>
          <td><input type="text" name="name_${p.id}" value="${p.name}" placeholder="${p.id === 'new' ? 'Add a player' : ''}" aria-label="Name"></td>
          <td><select name="level_${p.id}" aria-label="Level">${opt('silver', 'Silver', p.level === 'silver')}${opt('bronze', 'Bronze', p.level === 'bronze')}${opt('lower_bronze', 'Lower Bronze', p.level === 'lower_bronze')}</select></td>
          <td><input type="checkbox" name="pending_${p.id}"${p.level_pending ? raw(' checked') : ''} aria-label="Level under review"></td>
          <td><select name="gender_${p.id}" aria-label="Gender">${opt('', 'Not set', !p.gender)}${opt('M', 'Man', p.gender === 'M')}${opt('F', 'Woman', p.gender === 'F')}</select></td>
          <td><input type="checkbox" name="captain_${p.id}"${p.is_captain ? raw(' checked') : ''} aria-label="Captain"></td>
          <td><input type="checkbox" name="gold_${p.id}"${p.is_gold ? raw(' checked') : ''} aria-label="Gold Player"></td>
          <td><input type="checkbox" name="active_${p.id}"${p.active ? raw(' checked') : ''} aria-label="Active"></td>
        </tr>`)}</tbody>
      </table></div>
      <p class="form-actions"><button class="button small" type="submit">Save ${t.name}</button></p>
    </form></details>`;
  })}
</section>`;
}

function settingsTab(state) {
  const s = state.settings;
  return h`
<section><h2>Event</h2>
  <form method="post" action="/admin/settings" class="grid-form">
    <label>Event title <input type="text" name="event_title" value="${s.event_title}" required></label>
    <label>Date <input type="text" name="event_date" value="${s.event_date}"></label>
    <label>Venue <input type="text" name="venue" value="${s.venue}"></label>
    <label>Courts, separated by commas <input type="text" name="courts" value="${s.courts}" required></label>
    <label>Public address for the QR code (leave empty to use the address this site is opened with) <input type="url" name="public_url" value="${s.public_url}" placeholder="https://scores.battleofschools.id"></label>
    <button class="button" type="submit">Save settings</button>
  </form>
</section>
<section><h2>Festival Challenge stations</h2>
  <p>Add the 2026 stations here. Their points are entered on the scoring desk and added to the group standings.</p>
  <ul class="plain-list">${state.stations.map((st) => h`<li>${st.name} <form method="post" action="/admin/stations/${st.id}/delete" class="inline-form" data-confirm="Remove ${st.name} and its points?"><button class="link-button" type="submit">Remove</button></form></li>`)}</ul>
  <form method="post" action="/admin/stations" class="inline-row"><label>Station name <input type="text" name="name" required></label><button class="button small" type="submit">Add station</button></form>
</section>
<section><h2>Test data</h2>
  <p>Use these before the event only. “Load demo data” fills random groups, lineups and scores so you can see every screen working. “Clear results” removes all scores, lineups, tickets and challenge points but keeps schools, players, logins and fixtures.</p>
  <div class="form-actions">
    <form method="post" action="/admin/demo" data-confirm="Replace all fixtures and scores with random demo data?"><button class="button ghost" type="submit">Load demo data</button></form>
    <form method="post" action="/admin/reset" data-confirm="Remove all scores, lineups, tickets and challenge points?"><button class="button ghost" type="submit">Clear results</button></form>
  </div>
</section>`;
}

export function adminPage(state, user, { tab, users, origin, query }) {
  const current = TABS.some(([k]) => k === tab) ? tab : 'setup';
  const content = current === 'setup' ? setupTab(state) : current === 'people' ? peopleTab(state, users, origin) : current === 'players' ? playersTab(state) : settingsTab(state);
  const body = h`
<main id="main" class="page">
  <div class="tournament-hero"><div class="wrap"><p class="eyebrow">Tournament staff</p><h1 class="page-title">Admin</h1></div></div>
  <nav class="tournament-nav" aria-label="Admin sections"><div class="wrap">${TABS.map(([k, label]) => h`<a href="/admin?tab=${k}"${k === current ? raw(' aria-current="page"') : ''}>${label}</a>`)}<a href="/tv">TV scoreboard ↗</a></div></nav>
  <div class="wrap tournament-body">
    ${flash(query)}
    ${query.link ? h`<p class="flash flash-ok">Sign-in link (works once, valid three days): <input class="copy-field" type="text" readonly value="${query.link}" aria-label="Sign-in link" onfocus="this.select()"></p>` : ''}
    ${content}
  </div>
</main>`;
  return layout({ title: 'Admin', body, user, active: 'admin', scripts: ['/js/forms.js'] });
}
