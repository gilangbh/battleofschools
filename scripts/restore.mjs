// Rebuilds a tournament database from a backup downloaded under Admin → Settings → Download backup.
// Usage: DATA_DIR=<empty folder> node --no-warnings scripts/restore.mjs <backup.json>
// It refuses to run on a folder that already holds tournament data. Logins and sign-in links are not in a backup,
// so after a restore the admin login is created again from ADMIN_EMAIL when the server starts.
import fs from 'node:fs';

const file = process.argv[2];
if (!file || !process.env.DATA_DIR) { console.error('Usage: DATA_DIR=<empty folder> node scripts/restore.mjs <backup.json>'); process.exit(1); }
const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
const { db } = await import('../src/db.js'); // creates an empty database with the current tables

const ORDER = ['settings', 'teams', 'players', 'free_gold', 'showdowns', 'matches', 'lineups', 'tickets', 'activity', 'station_final', 'activity_log', 'bonus', 'award', 'award_log', 'am_players', 'am_matches'];
if (db.prepare('SELECT COUNT(*) AS n FROM teams').get().n > 0) { console.error('This DATA_DIR already has tournament data. Restore into an empty folder.'); process.exit(1); }

db.exec('BEGIN');
const counts = {};
for (const table of ORDER) {
  const rows = backup[table];
  if (!Array.isArray(rows)) continue; // older backups do not have the newer tables
  const known = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  if (table === 'settings') db.exec('DELETE FROM settings');
  for (const row of rows) {
    const cols = Object.keys(row).filter((c) => known.has(c));
    db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c]));
  }
  counts[table] = rows.length;
}
db.exec('COMMIT');
console.log(`Restored from the backup of ${backup.exported_at}:`, JSON.stringify(counts));
