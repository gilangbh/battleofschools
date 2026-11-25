// Gold Americano: a separate individual event for the Gold Players. Kept free of database and HTTP.
// It has nothing to do with school standings, regular-player appearances or the tactical tickets.
//
// An exhibition: the committee set no total per match, so any whole-number score is accepted, draws included.
// A player's tally is the rally points their pair won across their matches.

export const MAX_POINTS = 99; // only a guard against typing mistakes

/**
 * The rounds for a list of player ids.
 * Five players: five rounds, one player sits out each round, and everyone partners every other player exactly once
 * (four matches and one bye each). Four players: three rounds, partnering each of the other three once.
 * Returns [{ round, a: [id, id], b: [id, id], bye }] or null for any other number of players.
 */
export function schedule(ids) {
  if (ids.length === 5) {
    const p = (i) => ids[((i % 5) + 5) % 5];
    return [0, 1, 2, 3, 4].map((r) => ({ round: r + 1, bye: p(r), a: [p(r + 1), p(r + 4)], b: [p(r + 2), p(r + 3)] }));
  }
  if (ids.length === 4) {
    const [w, x, y, z] = ids;
    return [[[w, x], [y, z]], [[w, y], [x, z]], [[w, z], [x, y]]].map(([a, b], r) => ({ round: r + 1, bye: null, a, b }));
  }
  return null;
}

export function validateScore(a, b) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return 'Enter both scores as whole numbers.';
  if (a > MAX_POINTS || b > MAX_POINTS) return `Scores above ${MAX_POINTS} look like a typing mistake.`;
  return null;
}

/**
 * The individual table. Players level on points share a rank: nothing separates them here, because the
 * deciding playoff for tied prize places is played on court and its result is confirmed by an admin.
 * `needsPlayoff` is true when a tie touches first or second place once every match is finished.
 */
export function leaderboard(players, matches) {
  const rows = new Map(players.map((p) => [p.id, { player: p, played: 0, won: 0, drawn: 0, lost: 0, points: 0, against: 0, byes: 0 }]));
  let left = 0;
  for (const m of matches) {
    if (m.status !== 'done') { left++; continue; }
    if (m.bye != null && rows.has(m.bye)) rows.get(m.bye).byes++;
    for (const [ids, mine, theirs] of [[[m.a1, m.a2], m.score_a, m.score_b], [[m.b1, m.b2], m.score_b, m.score_a]]) {
      for (const id of ids) {
        const r = rows.get(id);
        if (!r) continue;
        r.played++; r.points += mine; r.against += theirs;
        if (mine > theirs) r.won++; else if (mine < theirs) r.lost++; else r.drawn++;
      }
    }
  }
  const list = [...rows.values()].sort((x, y) => y.points - x.points || x.player.sort - y.player.sort || x.player.id - y.player.id);
  for (const r of list) r.rank = 1 + list.filter((o) => o.points > r.points).length;
  const finished = matches.length > 0 && left === 0;
  const top = list.filter((r) => r.rank === 1);
  const second = list.filter((r) => r.rank === 2);
  // Outright when exactly one player is first and exactly one is second.
  const outright = top.length === 1 && second.length === 1;
  return { rows: list, left, finished, needsPlayoff: finished && !outright, winner: finished && outright ? top[0].player : null, runnerUp: finished && outright ? second[0].player : null };
}
