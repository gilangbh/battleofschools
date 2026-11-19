// Re-import schools, players and crests from the public school pages on battleofschools.id.
// Usage: npm run scrape
// Writes seed/schools.json, public/assets/crests/<school>.svg and public/assets/players/<file>.jpg.
// Portraits are shrunk to 480 x 600 when the optional `sharp` package is installed (npm i --no-save sharp). It does not touch the database:
// the seed is only loaded when the database has no schools (delete data/bos.db to re-seed).
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://battleofschools.id';
const SLUGS = ['acs', 'jis', 'bsj', 'fsj', 'lentera', 'mentari', 'nas', 'nzsj', 'springfield', 'sph'];
const strip = (s) => s.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const fetchText = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (bos-scores import)' } });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.text();
};

let sharp = null;
try { sharp = (await import('sharp')).default; } catch { console.log('sharp is not installed: portraits are saved at full size'); }
fs.mkdirSync(path.join('public', 'assets', 'players'), { recursive: true });

const out = [];
for (const slug of SLUGS) {
  const html = await fetchText(`${BASE}/schools/${slug}/`);
  const team = strip(html.match(/<h1>([\s\S]*?)<\/h1>/)[1]);
  const school = strip(html.match(/class="school-team-name">([\s\S]*?)<\/p>/)[1]);
  const honor = (html.match(/school-team-award">([\s\S]*?)<\/p>/) || [])[1];
  const players = [];
  for (const li of html.split('<li class="school-team-player">').slice(1)) {
    const block = li.split('</li>')[0];
    const name = strip(block.match(/<h3>([\s\S]*?)<\/h3>/)[1]);
    const meta = (block.match(/school-player-meta">([\s\S]*?)<\/p>/) || [, ''])[1];
    const spans = [...meta.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((m) => strip(m[1])).filter(Boolean);
    let photo = null;
    const src = (block.match(/<img src="([^"]+.jpe?g)"/) || [])[1];
    if (src) {
      const res = await fetch(BASE + src, { headers: { 'User-Agent': 'Mozilla/5.0 (bos-scores import)' } });
      if (res.ok) {
        let buf = Buffer.from(await res.arrayBuffer());
        if (sharp) buf = await sharp(buf).resize(480, 600, { fit: 'cover', position: 'top' }).jpeg({ quality: 78 }).toBuffer();
        photo = path.basename(src).replace(/-d{8}(?=.jpe?g$)/, '');
        fs.writeFileSync(path.join('public', 'assets', 'players', photo), buf);
      }
    }
    players.push({ name, captain: spans.includes('Captain'), level: spans.filter((s) => s !== 'Captain').join(' | '), photo });
  }
  out.push({ slug, team, school, honor: honor ? strip(honor) : null, players });
  const crest = await fetchText(`${BASE}/api/reveal-logo/${slug}/`);
  fs.writeFileSync(path.join('public', 'assets', 'crests', `${slug}.svg`), crest);
  console.log(`${team}: ${players.length} players`);
}
fs.writeFileSync(path.join('seed', 'schools.json'), JSON.stringify(out, null, 1));
console.log(`Wrote seed/schools.json (${out.length} schools, ${out.reduce((n, s) => n + s.players.length, 0)} players)`);
