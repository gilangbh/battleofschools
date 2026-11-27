import { h, raw, layout, teamMark, showdownTitle, flash } from './ui.js';
import { STAGE_LABEL } from '../rules.js';

const TABS = [['setup', 'Draw and fixtures'], ['people', 'Logins'], ['players', 'Players'], ['settings', 'Settings']];
const PENCIL = raw('<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>');
const CAT_SHORT = { men: 'Men’s', women: 'Women’s', open: 'Open' };
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

<section id="bonus"><h2>Starting points</h2>
  <p>The pre-event social challenge gives each school up to 5 points before play starts: 0.5 per verified account, up to ten accounts. Enter each school’s points here once the committee has tallied them. Enter 0 for a school that earned none; an empty box means “not tallied yet” and keeps that group’s semifinal places provisional.</p>
  <form method="post" action="/admin/bonus">
    <ul class="group-grid bonus-grid" role="list">${state.teams.map((t) => h`<li>${teamMark(t)}<span>${t.name}</span>
      <input type="number" inputmode="decimal" name="b_${t.id}" min="0" max="5" step="0.5" value="${state.bonusByTeam.has(t.id) ? state.bonusByTeam.get(t.id) : ''}" placeholder="–" aria-label="Starting points for ${t.name}"></li>`)}</ul>
    <p class="form-actions"><button class="button" type="submit">Save starting points</button></p>
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
      </tr>
      <tr class="fx-cats"><td colspan="5"><details${sd.stage !== 'group' ? raw(' open') : ''}>
        <summary>Category courts and times${sd.matches.some((m) => m.plan_court || m.plan_time) ? h` <b>· set: ${sd.matches.map((m) => `${CAT_SHORT[m.category]} ${[m.plan_time, m.plan_court].filter(Boolean).join(' ') || 'as showdown'}`).join(' · ')}</b>` : h` <span>· same as the showdown</span>`}</summary>
        <div class="fx-cat-grid">${sd.matches.map((m) => h`<div><b>${CAT_SHORT[m.category]}</b>
          <input type="time" name="mt_${m.id}" value="${m.plan_time || ''}" aria-label="${CAT_SHORT[m.category]} time, ${title}">
          <select name="mc_${m.id}" aria-label="${CAT_SHORT[m.category]} court, ${title}">${opt('', 'As showdown', !m.plan_court)}${state.courts.map((c) => opt(c, c, m.plan_court === c))}</select></div>`)}</div>
      </details></td></tr>`)}</tbody>`;
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

<section id="knockout"><h2>3. Semifinals and final</h2>
  <p>When the group matches and every school’s School Yard results are in, this puts A1 v A2 and B1 v B2 into the semifinals. It will not fill a group that is unfinished or tied for a semifinal place: set that semifinal by hand in the table above once the committee decides.</p>
  <form method="post" action="/admin/knockout/fill"><button class="button" type="submit">Fill from current results</button></form>
  ${state.knockout.filter((sd) => sd.a && sd.b).length ? h`<h3 style="margin-top:1.5rem">Results</h3>
  <p class="footnote">The first school to win two categories wins, so the third category is only needed at 1–1. Total games do not decide it. The final is filled from the two semifinal winners, and the champion shows once the final has a winner.</p>
  <ul class="winner-list" role="list">${state.knockout.filter((sd) => sd.a && sd.b).map((sd) => {
    const s = sd.summary;
    return h`<li><div><b>${showdownTitle(sd)}</b><span>${sd.a.name} v ${sd.b.name}</span>
        <small>${s.done ? `Categories ${s.catsA}–${s.catsB}` : 'Not started'}${s.winner ? ` · winner: ${(s.winner === 'a' ? sd.a : sd.b).name}` : ''}</small></div></li>`;
  })}</ul>` : ''}
</section>`;
}

function peopleTab(state, users, origin, links) {
  const who = (u) => (u.role === 'captain' ? `Captain, ${state.teamById.get(u.team_id)?.name || 'no school'}` : u.role === 'desk' ? 'Scoring desk' : 'Admin');
  return h`
${links ? h`<section class="links-box"><h2>Sign-in links</h2>
  <p>Each link works once and expires seven days after it was created. Creating new links does not cancel these. Send each one only to the person it is for.</p>
  <div class="table-scroll"><table class="tournament-table admin-table">
    <thead><tr><th scope="col">Who</th><th scope="col">Email</th><th scope="col">Link</th></tr></thead>
    <tbody>${links.map((l) => h`<tr><th scope="row">${who(l.user)}</th><td>${l.user.email}</td><td><input class="copy-field" type="text" readonly value="${l.url}" aria-label="Sign-in link for ${l.user.email}" onfocus="this.select()"></td></tr>`)}</tbody>
  </table></div>
</section>` : ''}
<section><h2>Logins</h2>
  <p class="footnote">Captains manage their own school’s lineups. Desk staff enter scores. “Link” creates a sign-in link you can send yourself, for example by WhatsApp.</p>
  <div class="form-actions">
    <form method="post" action="/admin/users/links"><button class="button small" type="submit">Create links for everyone</button></form>
    <form method="post" action="/admin/security/revoke" data-confirm="Cancel every unused sign-in link and sign out every other device? Everyone will need a new link."><button class="button small ghost" type="submit">Cancel all links and sign everyone out</button></form>
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

const FACE = raw('<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="9" r="4.2"/><path d="M3.5 22c.6-5 4-7.5 8.5-7.5s7.900 2.500 8.500 7.500Z"/></svg>');
/** Small portrait beside a name. It opens a card to upload a new picture or remove the current one. */
function photoControl(p) {
  const src = p.photo ? `/assets/players/${p.photo}` : '';
  return h`<span class="ph" data-photo="${p.id}">
    <button type="button" class="ph-btn${src ? '' : ' is-empty'}" data-photo-open aria-expanded="false" aria-label="Photo of ${p.name}: upload or remove" title="Photo">${src ? h`<img src="${src}" alt="" width="48" height="60" loading="lazy">` : FACE}</button>
    <span class="ph-pop" hidden>
      <span class="ph-big${src ? '' : ' is-empty'}">${src ? h`<img src="${src}" alt="Photo of ${p.name}" width="480" height="600">` : FACE}</span>
      <span class="ph-side"><b>${p.name}</b>
        <label class="button small lime ph-upload">${src ? 'Replace photo' : 'Upload photo'}<input type="file" accept="image/jpeg,image/png,image/webp" data-photo-file hidden></label>
        <button type="button" class="button small ghost" data-photo-remove${src ? '' : raw(' hidden')}>Remove photo</button>
        <small data-photo-note>Portrait works best. It is cropped to 4:5 and shown on the TV board.</small>
      </span>
    </span>
  </span>`;
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
        <td>${p.id === 'new'
          ? h`<input class="name-input" type="text" name="name_new" value="" placeholder="+ Add a player" aria-label="Name of a new player">`
          : h`<div class="name-cell">${photoControl(p)}<strong class="name-text">${p.name}</strong>${p.full_name && p.full_name !== p.name ? h`<small class="name-full">${p.full_name}${p.jersey_name && p.jersey_name !== p.name ? ` · jersey ${p.jersey_name}` : ''}</small>` : ''}<button type="button" class="name-edit" data-rename aria-label="Rename ${p.name}" title="Rename">${PENCIL}</button><input class="name-input" type="text" name="name_${p.id}" value="${p.name}" aria-label="Name" hidden></div>`}</td>
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
  <p class="footnote">Gold Players have no committee category: the level shown for them is not used by any rule. The name in bold is the short name shown on scoreboards; the registered full name and jersey name sit under it. A school’s Gold Player is an extra player with “Gold Player ★” on, and may only be deployed while “Active” is on, so keep a nominee switched off until the committee approves. Turn “Active” off for a player who has withdrawn.</p>
</section>`;
}

function goldPool(state) {
  const row = (g) => h`<tr><td><input type="text" name="name_${g.id}" value="${g.name}" maxlength="60" placeholder="${g.id === 'new' ? '+ Add a free agent' : ''}" aria-label="Name"></td>
    <td><select name="gender_${g.id}" aria-label="Gender">${opt('', 'Not set', !g.gender)}${opt('M', 'Man', g.gender === 'M')}${opt('F', 'Woman', g.gender === 'F')}</select></td>
    <td>${g.id === 'new' ? '' : h`<label class="tick"><input type="checkbox" name="active_${g.id}"${g.active ? raw(' checked') : ''}><span>Active</span></label>`}</td></tr>`;
  const callers = state.teams.filter((t) => !t.hasOwnGold).map((t) => t.name);
  return h`<section id="gold-pool"><h2>Organizer Gold pool</h2>
  <p class="footnote">Free agents who belong to no school. A school with no Gold Player of its own can call one with a Gold Player Ticket; the usual ticket rules apply and games count for the calling school. Schools that can call them now: ${callers.join(', ') || 'none'}.</p>
  <form method="post" action="/admin/free-gold">
    <div class="table-scroll"><table class="tournament-table admin-table"><thead><tr><th scope="col">Name</th><th scope="col">Plays as</th><th scope="col">Status</th></tr></thead>
    <tbody>${[...state.freeGold, { id: 'new', name: '', gender: 'M', active: 1 }].map(row)}</tbody></table></div>
    <p class="form-actions"><button class="button small" type="submit">Save pool</button></p>
  </form></section>`;
}

function settingsTab(state, visibility) {
  const s = state.settings;
  return h`
<section><h2>Who can see the site</h2>
  <form method="post" action="/admin/settings" class="visibility-form">
    <input type="hidden" name="event_title" value="${s.event_title}"><input type="hidden" name="event_date" value="${s.event_date}"><input type="hidden" name="venue" value="${s.venue}"><input type="hidden" name="courts" value="${s.courts}"><input type="hidden" name="public_url" value="${s.public_url}">
    ${[['staff', 'Admin and desk only', 'Everything is hidden, including the TV board. Captains who sign in see a “revealed at the briefing” page.'],
      ['captains', 'Captains too', 'Captains can see fixtures and submit lineups. The public still sees nothing.'],
      ['public', 'Everyone', 'Live scores and the TV board are open to all. Lineups stay hidden until both captains submit.']].map(([k, label, text]) => h`<label class="vis-option"><input type="radio" name="visibility" value="${k}"${visibility === k ? raw(' checked') : ''}><span><b>${label}</b>${text}</span></label>`)}
    <button class="button" type="submit">Save</button>
  </form>
</section>
<section><h2>Event</h2>
  <form method="post" action="/admin/settings" class="grid-form">
    <label>Event title <input type="text" name="event_title" value="${s.event_title}" required></label>
    <label>Date <input type="text" name="event_date" value="${s.event_date}"></label>
    <label>Venue <input type="text" name="venue" value="${s.venue}"></label>
    <label>Courts, separated by commas <input type="text" name="courts" value="${s.courts}" required></label>
    <label>Public address for the QR code (leave empty to use the address this site is opened with) <input type="url" name="public_url" value="${s.public_url}" placeholder="https://scores.battleofschools.id"></label>
    <input type="hidden" name="visibility" value="${visibility}"><button class="button" type="submit">Save settings</button>
  </form>
</section>
<section><h2>Emails</h2>
  <p>The app sends one email: the sign-in link. Check how it looks before relying on it.</p>
  <p class="form-actions"><a class="button ghost small" href="/admin/email-preview" target="_blank" rel="noopener">Preview the sign-in email ↗</a><a class="button ghost small" href="/admin/email-preview?format=text" target="_blank" rel="noopener">Plain-text version ↗</a></p>
</section>
<section><h2>Backup</h2>
  <p>Downloads every school, player, fixture, lineup, score, ticket and School Yard result as one file. Logins and sign-in links are not included.</p>
  <a class="button ghost" href="/admin/export.json">Download backup</a>
</section>
<section><h2>Test data</h2>
  <p>Use these before the event only. “Load demo data” fills random groups, lineups and scores so you can see every screen working. Resetting scores is in the next section.</p>
  <div class="form-actions">
    <form method="post" action="/admin/demo" data-confirm="Replace all fixtures and scores with random demo data?"><button class="button ghost" type="submit">Load demo data</button></form>
  </div>
</section>
<section id="reset"><h2>Reset scores</h2>
  <p>Sets every match back to “not started” and removes its score, in the group stage and the finals. Schools, players, logins, fixtures, times and courts are kept. Download a backup first if there is anything you might want back.</p>
  <button type="button" class="button ghost" data-toggle="reset-panel" aria-expanded="false">Reset all scores…</button>
  <form method="post" action="/admin/reset" class="dm-panel reset-panel" id="reset-panel" hidden>
    <p class="panel-title">This cannot be undone</p>
    <label class="tick-line"><input type="checkbox" name="lineups"> Also remove every lineup and Golden Ticket, and empty the semifinals and final</label>
    <label class="tick-line"><input type="checkbox" name="yard"> Also remove School Yard results and School Spirit bonuses</label>
    <label class="reset-confirm">Type RESET to confirm <input type="text" name="confirm" autocomplete="off" autocapitalize="characters" spellcheck="false" required pattern="[Rr][Ee][Ss][Ee][Tt]" placeholder="RESET"></label>
    <div class="form-actions"><button class="button danger" type="submit">Reset scores now</button><a class="button ghost small" href="/admin/export.json">Download backup first</a></div>
  </form>
</section>
<section><h2>TV screens</h2>
  <p>Open one of these on the venue TV in full screen. Each updates by itself.</p>
  <ul class="tv-links" role="list">
    <li><a href="/tv">Group stage</a><span>Six courts with player photos, both group tables, results ticker.</span></li>
    <li><a href="/tv/knockout">Knockout stage</a><span>The two semifinals and the final as a bracket, category by category.</span></li>
    <li><a href="/tv/americano">Gold Americano</a><span>The individual table and the rounds of the Gold Players’ event.</span></li>
    <li><a href="/tv/summary">Final summary</a><span>Champion, finals results, both groups and every score.</span></li>
    <li><a href="/tv/summary?secret=1">Final summary with player tables</a><span>Adds the top ten players by matches won and by games won. Only shown with this address.</span></li>
  </ul>
</section>`;
}

export function adminPage(state, user, { tab, users, origin, query, links = null, visibility = 'public' }) {
  const current = TABS.some(([k]) => k === tab) ? tab : 'setup';
  const content = current === 'setup' ? setupTab(state) : current === 'people' ? peopleTab(state, users, origin, links) : current === 'players' ? h`${playersTab(state, query.team)}${goldPool(state)}` : settingsTab(state, visibility);
  const body = h`
<main id="main" class="page">
  <div class="tournament-hero"><div class="wrap"><p class="eyebrow">Tournament staff</p><h1 class="page-title">Admin</h1></div></div>
  <nav class="tournament-nav" aria-label="Admin sections"><div class="wrap">${TABS.map(([k, label]) => h`<a href="/admin?tab=${k}"${k === current ? raw(' aria-current="page"') : ''}>${label}</a>`)}<a href="/tv">TV scoreboard ↗</a></div></nav>
  <div class="wrap tournament-body">
    ${visibility === 'public' ? '' : h`<p class="lock-banner"><b>The site is private.</b> ${visibility === 'staff' ? 'Only admin and desk logins can see it.' : 'Captains can see it; the public cannot.'} <a href="/admin?tab=settings">Change</a></p>`}
    ${flash(query)}
    ${query.link ? h`<p class="flash flash-ok">Sign-in link (works once, valid seven days): <input class="copy-field" type="text" readonly value="${query.link}" aria-label="Sign-in link" onfocus="this.select()"></p>` : ''}
    ${content}
  </div>
</main>`;
  return layout({ title: 'Admin', body, user, active: 'admin', scripts: ['/js/forms.js'] });
}
