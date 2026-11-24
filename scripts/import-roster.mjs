// Sends the 24 November registration snapshot to a running site's roster import and saves the change report.
// Usage: node scripts/import-roster.mjs <base-url> <session-cookie-value> <update-folder> <report-file>
// Private data goes only to the target site. Nothing here prints a name, an email or a sign-in link.
import fs from 'node:fs';
import path from 'node:path';

const [base, cookie, folder, reportFile] = process.argv.slice(2);
const origin = new URL(base).origin;
const snap = JSON.parse(fs.readFileSync(path.join(folder, 'registration', 'scoring-active-regulars.json'), 'utf8'));
const LEVEL = { silver: 'silver', 'low-silver': 'silver', bronze: 'bronze', 'lower-bronze': 'lower_bronze' };
const photoKey = (u) => (u ? u.split('/').pop().replace(/-\d{8}(?=\.jpe?g$)/, '') : null);

const players = snap.players.map((r) => {
  if (r.participation_status !== 'active' || !['regular', 'playing_captain'].includes(r.role)) throw new Error(`unexpected record ${r.player_id}`);
  const approved = r.category_approval_current === true && LEVEL[r.approved_current_rating];
  return {
    reg_id: r.player_id,
    team: r.team_id.match(/BOS26-TEAM-([A-Z]+)-/)[1].toLowerCase(),
    name: r.display_name,
    full_name: r.full_name,
    jersey_name: r.jersey_name || null,
    gender: r.gender === 'male' ? 'M' : r.gender === 'female' ? 'F' : null,
    // Only a current committee approval sets the category; anything else stays flagged for review.
    level: approved || LEVEL[String(r.submitted_rating || '').toLowerCase()] || 'bronze',
    level_pending: approved ? 0 : 1,
    is_captain: r.role === 'playing_captain',
    photo: photoKey(r.public_photo_url || r.photo_url),
  };
});

const res = await fetch(`${base}/admin/roster/import`, {
  method: 'POST',
  headers: { Cookie: `bos_sid=${cookie}`, Origin: origin, 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ snapshot: snap.snapshot_id, players }),
});
const text = await res.text();
let out;
try { out = JSON.parse(text); } catch { throw new Error(`import failed: status ${res.status}`); }
if (!out.ok) throw new Error(`import refused: ${out.error}`);
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, JSON.stringify({ snapshot: snap.snapshot_id, target: origin, ...out }, null, 2));
console.log('summary', JSON.stringify(out.summary));
const fields = {};
for (const r of out.report) for (const k of Object.keys(r.changes)) fields[k] = (fields[k] || 0) + 1;
console.log('fields changed', JSON.stringify(fields));

// Read back: eight active regulars per school, no category under review, and the counts by category.
const data = await (await fetch(`${base}/admin/export.json`, { headers: { Cookie: `bos_sid=${cookie}` } })).json();
const active = data.players.filter((p) => p.active && !p.is_gold);
const perTeam = {};
for (const p of active) perTeam[p.team_id] = (perTeam[p.team_id] || 0) + 1;
const by = (k) => active.reduce((m, p) => ({ ...m, [p[k]]: (m[p[k]] || 0) + 1 }), {});
console.log('check', JSON.stringify({
  activeRegulars: active.length, eightPerSchool: Object.values(perTeam).every((n) => n === 8) && Object.keys(perTeam).length === 10,
  withRegId: active.filter((p) => p.reg_id).length, underReview: active.filter((p) => p.level_pending).length,
  noGender: active.filter((p) => !p.gender).length, noPhoto: active.filter((p) => !p.photo).length,
  levels: by('level'), genders: by('gender'), captains: active.filter((p) => p.is_captain).length,
  goldActive: data.players.filter((p) => p.is_gold && p.active).length, goldInactive: data.players.filter((p) => p.is_gold && !p.active).length,
}));
