// Gold exhibition (Gold Americano): a separate individual event for the school-community Gold players. Kept free of
// database and HTTP. It has nothing to do with school standings, regular-player appearances or the tactical tickets.
//
// Organizer rules of 27 November 2026: four players, three rotating doubles rounds, every partner once, no byes.
// Each round is first to four games with no deuce. At 3–3 a tiebreak to five points (sudden death at 4–4) decides
// it, the round finishes 4–3 and the tiebreak is recorded separately. The individual table counts games won.
// A tie for a prize place is settled by a 1v1 playoff on court, never by a points difference.

export const PLAYERS = 4;
export const GAMES_TARGET = 4;
export const TIEBREAK_TARGET = 5;

/** Three rounds for four player ids: [{ round, a: [id, id], b: [id, id] }], or null for any other number. */
export function schedule(ids) {
  if (ids.length !== PLAYERS) return null;
  const [w, x, y, z] = ids;
  return [[[w, x], [y, z]], [[w, y], [x, z]], [[w, z], [x, y]]].map(([a, b], r) => ({ round: r + 1, a, b }));
}

const isCount = (n) => Number.isInteger(n) && n >= 0;

/** A finished round: games for each pair, and the tiebreak points when it ended 4–3. */
export function validateScore(a, b, tbA = null, tbB = null) {
  if (!isCount(a) || !isCount(b)) return 'Enter both game scores as whole numbers.';
  if (Math.max(a, b) !== GAMES_TARGET || Math.min(a, b) >= GAMES_TARGET) return `A round ends when one pair reaches ${GAMES_TARGET} games (4–0 to 4–3).`;
  const tiebreak = tbA !== null || tbB !== null;
  if (Math.min(a, b) < GAMES_TARGET - 1) return tiebreak ? 'A tiebreak is only played at 3–3, so only a 4–3 round has one.' : null;
  if (!isCount(tbA) || !isCount(tbB)) return 'A 4–3 round went to a tiebreak: enter both tiebreak scores.';
  if (Math.max(tbA, tbB) !== TIEBREAK_TARGET || Math.min(tbA, tbB) >= TIEBREAK_TARGET) return `The tiebreak ends when one pair reaches ${TIEBREAK_TARGET} points (5–0 to 5–4).`;
  if ((a > b) !== (tbA > tbB)) return 'The tiebreak winner must be the pair with four games.';
  return null;
}

/**
 * The individual table: games won. Players level on games share a position and nothing separates them here.
 * `ties` lists the level groups that touch first or second place once every round is finished.
 */
export function leaderboard(players, matches) {
  const rows = new Map(players.map((p) => [p.id, { player: p, played: 0, won: 0, lost: 0, points: 0, against: 0 }]));
  let left = 0;
  for (const m of matches) {
    if (m.status !== 'done') { left++; continue; }
    for (const [ids, mine, theirs] of [[[m.a1, m.a2], m.score_a, m.score_b], [[m.b1, m.b2], m.score_b, m.score_a]]) {
      for (const id of ids) {
        const r = rows.get(id);
        if (!r) continue;
        r.played++; r.points += mine; r.against += theirs;
        if (mine > theirs) r.won++; else r.lost++;
      }
    }
  }
  const list = [...rows.values()].sort((x, y) => y.points - x.points || x.player.sort - y.player.sort || x.player.id - y.player.id);
  for (const r of list) r.rank = 1 + list.filter((o) => o.points > r.points).length;
  const finished = matches.length > 0 && left === 0;
  const top = list.filter((r) => r.rank === 1);
  const second = list.filter((r) => r.rank === 2);
  const outright = top.length === 1 && second.length === 1;
  const ties = finished && !outright
    ? [[1, top], [2, second]].filter(([, g]) => g.length > 1).map(([place, g]) => ({ place, players: g.map((r) => r.player) }))
    : [];
  return { rows: list, left, finished, needsPlayoff: finished && !outright, ties, winner: finished && outright ? top[0].player : null, runnerUp: finished && outright ? second[0].player : null };
}
