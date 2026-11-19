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

<section id="fixtures"><h2>2. Fixtures</h2>
  <p>“Generate” builds five rounds where every school meets all five schools in the other group, plus two semifinals and a final.</p>
  <form method="post" action="/admin/fixtures/generate" data-confirm="This deletes all existing fixtures, lineups and scores. Continue?">
    <button class="button ${state.showdowns.length ? 'ghost small' : 'lime'}" type="submit">${state.showdowns.length ? 'Regenerate all fixtures' : 'Generate fixtures'}</button>
  </form>
  ${state.showdowns.length ? h`
  <div class="autofill" data-autofill>
    <p class="autofill-title">Fill times and courts for every round</p>
    <label>First round starts <input type="time" data-af="start" value="09:00"></label>
    <label>Minutes per round <input type="number" data-af="gap" min="5" max="240" step="5" value="45"></label>
    <label>First court <select data-af="first">${state.courts.map((c, i) => opt(i, c, i === 0))}</select></label>
    <button class="button small lime" type="button" data-af="go">Fill the table</button>
    <span class="footnote" data-af="note">Showdown 1 of a round goes on the first court, showdown 2 on the next, and so on. Nothing is saved until you press Save all.</span>
  </div>
  <form method="post" action="/admin/showdowns" id="fx" data-dirty-form>
  <div class="table-scroll"><table class="tournament-table admin-table fx-table">
    <thead><tr><th scope="col">School A</th><th scope="col">School B</th><th scope="col">Time</th><th scope="col">Court</th><th scope="col"><span class="visually-hidden">Delete</span></th></tr></thead>
    ${[...new Set(state.showdowns.map((sd) => `${sd.stage}:${sd.round}`))].map((key) => {
      const sds = state.showdowns.filter((sd) => `${sd.stage}:${sd.round}` === key);
      const title = sds[0].stage === 'group' ? `Round ${sds[0].round}` : sds[0].stage === 'semi' ? 'Semifinals' : showdownTitle(sds[0]);
      return h`<tbody data-round>
      <tr class="fx-round"><th scope="rowgroup" colspan="2">${title}</th>
        <td><input type="time" data-round-time aria-label="Time for all of ${title}" title="Sets the time for every showdown in ${title}"></td>
        <td colspan="2"><span class="footnote">Set a time here to apply it to the whole round</span></td></tr>
      ${sds.map((sd) => h`<tr>
        <td><select name="team_a_${sd.id}" aria-label="School A">${teamOptions(sd.team_a)}</select></td>
        <td><select name="team_b_${sd.id}" aria-label="School B">${teamOptions(sd.team_b)}</select></td>
        <td><input type="time" name="time_${sd.id}" value="${sd.start_time || ''}" aria-label="Start time" data-fx="time"></td>
        <td><select name="court_${sd.id}" aria-label="Court" data-fx="court">${opt('', 'Not set', !sd.court)}${state.courts.map((c) => opt(c, c, sd.court === c))}</select></td>
        <td><button class="fx-del" type="submit" form="del-${sd.id}" aria-label="Delete this showdown" title="Delete this showdown">×</button></td>
      </tr>`)}</tbody>`;
    })}
  </table></div>
  <div class="save-bar"><button class="button" type="submit">Save all</button><span class="save-note" data-dirty-note>No unsaved changes.</span></div>
  </form>
  ${state.showdowns.map((sd) => h`<form method="post" action="/admin/showdown/${sd.id}/delete" id="del-${sd.id}" data-confirm="Delete this showdown and its scores?"></form>`)}
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

function peopleTab(state, users, origin, links) {
  const who = (u) => (u.role === 'captain' ? `Captain, ${state.teamById.get(u.team_id)?.name || 'no school'}` : u.role === 'desk' ? 'Scoring desk' : 'Admin');
  return h`
${links ? h`<section class="links-box"><h2>Sign-in links</h2>
  <p>Each link works once and expires in three days. Creating new links does not cancel these. Send each one only to the person it is for.</p>
  <div class="table-scroll"><table class="tournament-table admin-table">
    <thead><tr><th scope="col">Who</th><th scope="col">Email</th><th scope="col">Link</th></tr></thead>
    <tbody>${links.map((l) => h`<tr><th scope="row">${who(l.user)}</th><td>${l.user.email}</td><td><input class="copy-field" type="text" readonly value="${l.url}" aria-label="Sign-in link for ${l.user.email}" onfocus="this.select()"></td></tr>`)}</tbody>
  </table></div>
</section>` : ''}
<section><h2>Logins</h2>
  <p class="footnote">Captains manage their own school’s lineups. Desk staff enter scores. “Link” creates a sign-in link you can send yourself, for example by WhatsApp.</p>
  <div class="form-actions">
    <form method="post" action="/admin/users/links"><button class="button small" type="submit">Create links for everyone</button></form>
    <form method="post" action="/admin/users/seed"><button class="button small ghost" type="submit">Add missing desk and captain logins</button></form>
  </div>
  <div class="table-scroll"><table class="tournament-table admin-table">
    <thead><tr><th scope="col">Email</th><th scope="col">Name</th><th scope="col">Role</th><th scope="col"></th></tr></thead>
    <tbody>${users.map((u) => h`<tr><th scope="row">${u.email}</th><td>${u.name || ''}</td><td>${who(u)}</td>
      <td class="row-actions"><form method="post" action="/admin/users/${u.id}/link"><button class="pill" type="submit">Link</button></form>
      <form method="post" action="/admin/users/${u.id}/delete" data-confirm="Remove ${u.email}?"><button class="fx-del" type="submit" aria-label="Remove ${u.email}" title="Remove">×</button></form></td></tr>`)}</tbody>
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

function playersTab(state, teamId) {
  const team = state.teamById.get(teamId) || state.teams[0];
  const of = (t) => state.allPlayers.filter((p) => p.team_id === t.id);
  const everyone = of(team);
  const tick = (name, on, label) => h`<label class="tick"><input type="checkbox" name="${name}"${on ? raw(' checked') : ''}><span>${label}</span></label>`;
  return h`
<section><h2>Players</h2>
  <ul class="school-picker" role="list">${state.teams.map((t) => {
    const ps = of(t).filter((p) => p.active);
    const missing = ps.filter((p) => !p.gender).length;
    return h`<li><a href="/admin?tab=players&team=${t.id}"${t.id === team.id ? raw(' aria-current="true"') : ''}>${teamMark(t)}<strong>${t.name}</strong>
      <small class="${missing ? 'is-missing' : ''}">${missing ? `${missing} without gender` : `${ps.length} players, all set`}</small></a></li>`;
  })}</ul>

  <form method="post" action="/admin/players/${team.id}" data-dirty-form>
    <div class="roster-head">${teamMark(team)}<div><h3>${team.name}</h3><p>${team.school}</p></div></div>
    <div class="table-scroll"><table class="tournament-table admin-table roster-table">
      <thead><tr><th scope="col">Player</th><th scope="col">Plays as</th><th scope="col">Level</th><th scope="col">Flags</th></tr></thead>
      <tbody>${[...everyone, { id: 'new', name: '', level: 'bronze', active: 1 }].map((p) => h`<tr class="${p.id !== 'new' && !p.active ? 'is-inactive' : ''}">
        <td><input class="name-input" type="text" name="name_${p.id}" value="${p.name}" placeholder="${p.id === 'new' ? '+ Add a player' : ''}" aria-label="Name"></td>
        <td><div class="seg" role="radiogroup" aria-label="Plays as">
          <label><input type="radio" name="gender_${p.id}" value="M"${p.gender === 'M' ? raw(' checked') : ''}><span>Man</span></label>
          <label><input type="radio" name="gender_${p.id}" value="F"${p.gender === 'F' ? raw(' checked') : ''}><span>Woman</span></label>
        </div></td>
        <td><div class="seg" role="radiogroup" aria-label="Level">
          <label><input type="radio" name="level_${p.id}" value="silver"${p.level === 'silver' ? raw(' checked') : ''}><span>Silver</span></label>
          <label><input type="radio" name="level_${p.id}" value="bronze"${p.level === 'bronze' ? raw(' checked') : ''}><span>Bronze</span></label>
          <label><input type="radio" name="level_${p.id}" value="lower_bronze"${p.level === 'lower_bronze' ? raw(' checked') : ''}><span>Lower Bronze</span></label>
        </div></td>
        <td><div class="ticks">${tick(`captain_${p.id}`, p.is_captain, 'Captain')}${tick(`gold_${p.id}`, p.is_gold, 'Gold Player ★')}${tick(`pending_${p.id}`, p.level_pending, 'Level under review')}${tick(`active_${p.id}`, p.active, 'Active')}</div></td>
      </tr>`)}</tbody>
    </table></div>
    <div class="save-bar"><button class="button" type="submit">Save ${team.name}</button><span class="save-note" data-dirty-note>No unsaved changes.</span></div>
  </form>
  <p class="footnote">Names and levels were imported from the school pages on battleofschools.id, which do not publish gender. A school’s Gold Player is added as an extra player with “Gold Player ★” on. Turn “Active” off for a player who has withdrawn.</p>
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

export function adminPage(state, user, { tab, users, origin, query, links = null }) {
  const current = TABS.some(([k]) => k === tab) ? tab : 'setup';
  const content = current === 'setup' ? setupTab(state) : current === 'people' ? peopleTab(state, users, origin, links) : current === 'players' ? playersTab(state, query.team) : settingsTab(state);
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
