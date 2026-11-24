// Tournament rules, kept free of database and HTTP so they can be tested directly.
// Source: battleofschools.id/homecoming/games/ (rules as published 17 Nov 2026).

export const CATEGORIES = ['men', 'women', 'open'];
export const CATEGORY_LABEL = { men: 'Men’s doubles', women: 'Women’s doubles', open: 'Open doubles' };
export const STAGE_LABEL = { group: 'Group stage', semi: 'Semifinal', third: 'Third place', final: 'Final' };
export const GROUP_GAMES = 5; // every group category match plays exactly five games
export const KNOCKOUT_TARGET = 6; // semifinals and final are a race to six
// Tactical tickets are two separate private balances per school (organizer decision, November 2026).
export const GOLD_DEPLOYMENTS = 3;
export const GOLDEN_POINTS = 2;

/** How many of each ticket a school has used and has left. */
export function ticketBalance(tickets = []) {
  const goldUsed = tickets.filter((t) => t.type === 'gold_player').length;
  const pointUsed = tickets.filter((t) => t.type === 'golden_point').length;
  return { goldUsed, pointUsed, goldLeft: Math.max(0, GOLD_DEPLOYMENTS - goldUsed), pointLeft: Math.max(0, GOLDEN_POINTS - pointUsed) };
}
export const MIN_APPEARANCES = 3;

export const isKnockout = (stage) => stage !== 'group';

const isInt = (n) => Number.isInteger(n);

/** A score entered while the match is still being played. */
export function validateRunningScore(stage, a, b) {
  if (!isInt(a) || !isInt(b) || a < 0 || b < 0) return 'Scores must be whole numbers.';
  if (!isKnockout(stage)) {
    if (a + b > GROUP_GAMES) return `A group match has ${GROUP_GAMES} games in total.`;
    return null;
  }
  if (a > KNOCKOUT_TARGET || b > KNOCKOUT_TARGET) return `Knockout matches are a race to ${KNOCKOUT_TARGET}.`;
  if (a === KNOCKOUT_TARGET && b === KNOCKOUT_TARGET) return 'Both pairs cannot reach six games.';
  return null;
}

/** A final score. */
export function validateFinalScore(stage, a, b, tbA = null, tbB = null) {
  if (!isInt(a) || !isInt(b) || a < 0 || b < 0) return 'Enter both scores as whole numbers.';
  if (!isKnockout(stage)) {
    if (a + b !== GROUP_GAMES) return `Group scores must add up to ${GROUP_GAMES} games (for example 3–2 or 4–1).`;
    return null;
  }
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi !== KNOCKOUT_TARGET || lo >= KNOCKOUT_TARGET) return `A knockout match ends when one pair reaches ${KNOCKOUT_TARGET} games (6–0 to 6–5).`;
  const hasTb = tbA != null || tbB != null;
  if (hasTb) {
    if (lo !== 5) return 'A tiebreak is only played at 5–5, so the final score must be 6–5.';
    if (!isInt(tbA) || !isInt(tbB) || tbA < 0 || tbB < 0) return 'Enter both tiebreak scores.';
    const tbHi = Math.max(tbA, tbB);
    const tbLo = Math.min(tbA, tbB);
    if (tbHi !== 7 || tbLo > 6) return 'The tiebreak is first to seven points (7–0 to 7–6).';
    if ((a > b) !== (tbA > tbB)) return 'The tiebreak winner must be the pair with six games.';
  }
  return null;
}

/**
 * Check one school's pair for one category match.
 * ctx: { stage, category, players (the school's active players), p1, p2, goldOut,
 *        otherLineups ([{category, p1, p2}] this school has in the same showdown),
 *        ticketsUsedElsewhere (tickets used by the school outside this lineup) }
 * Returns an array of error strings; empty means the lineup is allowed.
 */
export function validateLineup(ctx) {
  const errors = [];
  const { stage, category, players, p1, p2, goldOut = null, otherLineups = [], goldUsedElsewhere = 0, goldenPointHere = false } = ctx;
  const byId = new Map(players.map((p) => [p.id, p]));
  const a = byId.get(p1);
  const b = byId.get(p2);
  if (!a || !b) return ['Pick two players from your own roster.'];
  if (a.id === b.id) return ['Pick two different players.'];
  if (a.is_gold || b.is_gold) return ['The Gold Player can only come in through a Gold Player Ticket.'];

  if (a.level === 'silver' && b.level === 'silver') {
    errors.push(`${a.name} and ${b.name} are both Silver. Silver players cannot partner with each other.`);
  }
  if (category === 'men') {
    for (const p of [a, b]) {
      if (p.gender === 'F') errors.push(`${p.name} is listed as a woman and cannot play Men’s doubles.`);
      else if (p.gender !== 'M') errors.push(`${p.name} has no gender on record, so cannot be checked for Men’s doubles. Ask the organizer to set it.`);
    }
  }
  if (category === 'women') {
    for (const p of [a, b]) {
      if (p.gender === 'M') errors.push(`${p.name} is listed as a man and cannot play Women’s doubles.`);
      else if (p.gender !== 'F') errors.push(`${p.name} has no gender on record, so cannot be checked for Women’s doubles. Ask the organizer to set it.`);
    }
  }
  if (isKnockout(stage)) {
    for (const other of otherLineups) {
      if (other.category === category) continue;
      for (const p of [a, b]) {
        if (other.p1 === p.id || other.p2 === p.id) {
          errors.push(`${p.name} is already in ${CATEGORY_LABEL[other.category]}. Each player plays one category match per knockout round.`);
        }
      }
    }
  }
  if (goldOut != null) {
    const gold = players.find((p) => p.is_gold);
    const out = byId.get(goldOut);
    if (isKnockout(stage)) errors.push('Golden Tickets can only be used in the group stage.');
    else if (!gold) errors.push('Your school has no approved Gold Player.');
    else if (!out || (out.id !== a.id && out.id !== b.id)) errors.push('The Gold Player must replace one of the two players in this pair.');
    else {
      if (goldUsedElsewhere >= GOLD_DEPLOYMENTS) errors.push(`Your school has already used its ${GOLD_DEPLOYMENTS} Gold Player deployments.`);
      if (goldenPointHere) errors.push('Your school has already used a Golden Point in this match. The two tickets cannot be combined in one match.');
      if (!gold.gender || !out.gender) errors.push('The Gold Player replaces a player of the same gender, and a gender is missing on record. Ask the organizer to set it.');
      else if (gold.gender !== out.gender) errors.push(`The Gold Player can only replace a player of the same gender, and ${out.name} is not.`);
    }
  }
  return errors;
}

/** Winner side ('a' | 'b' | null) of a finished category match. */
export function matchWinner(m) {
  if (m.status !== 'done' || m.score_a == null || m.score_b == null) return null;
  if (m.score_a === m.score_b) return null;
  return m.score_a > m.score_b ? 'a' : 'b';
}

/** Totals for a showdown: games per side, categories won per side, completion and knockout winner. */
export function showdownSummary(stage, matches) {
  const s = { gamesA: 0, gamesB: 0, catsA: 0, catsB: 0, done: 0, live: 0, complete: false, winner: null };
  for (const m of matches) {
    if (m.status === 'live') s.live++;
    if (m.status !== 'done') continue;
    s.done++;
    s.gamesA += m.score_a;
    s.gamesB += m.score_b;
    const w = matchWinner(m);
    if (w === 'a') s.catsA++;
    if (w === 'b') s.catsB++;
  }
  s.complete = matches.length > 0 && s.done === matches.length;
  // The winner of a semifinal or final is never worked out here. The committee has not decided whether
  // categories won or total games decide it, so an admin confirms the winner and loadState copies it in.
  return s;
}

/**
 * Group standings. Total = padel games won in finished group matches + Festival Challenge points.
 * The committee has not published a tiebreak, so schools level on total share a rank and are never
 * separated here. Each row gets a `place`:
 *   'qualified'   top two, group stage finished, no tie across the cut
 *   'provisional' currently top two, group stage still running
 *   'tied'        level on total with a school on the other side of the top-two cut
 */
export function computeStandings(teams, showdowns, challengeByTeam) {
  const rows = new Map(
    teams.map((t) => [t.id, { team: t, played: 0, won: 0, lost: 0, games: 0, challenge: challengeByTeam.get(t.id) || 0, total: 0, place: null }]),
  );
  let groupLeft = 0;
  for (const sd of showdowns) {
    if (sd.stage !== 'group') continue;
    for (const m of sd.matches) {
      if (m.status !== 'done') { groupLeft++; continue; }
      const ra = rows.get(sd.team_a);
      const rb = rows.get(sd.team_b);
      if (!ra || !rb) continue;
      ra.played++;
      rb.played++;
      ra.games += m.score_a;
      rb.games += m.score_b;
      if (m.score_a > m.score_b) { ra.won++; rb.lost++; }
      else if (m.score_b > m.score_a) { rb.won++; ra.lost++; }
    }
  }
  const round1 = (n) => Math.round(n * 10) / 10;
  for (const row of rows.values()) {
    row.challenge = round1(row.challenge);
    row.total = round1(row.games + row.challenge);
  }
  const sorted = [...rows.values()].sort((x, y) => y.total - x.total || x.team.name.localeCompare(y.team.name));
  const groups = {};
  for (const row of sorted) {
    const g = row.team.grp || '';
    (groups[g] ||= []).push(row);
  }
  const anyPlayed = sorted.some((row) => row.played > 0);
  for (const list of Object.values(groups)) {
    for (const row of list) row.rank = 1 + list.filter((o) => o.total > row.total).length;
    if (!anyPlayed || list.length < 3) {
      if (anyPlayed) list.slice(0, 2).forEach((row) => { row.place = groupLeft === 0 ? 'qualified' : 'provisional'; });
      continue;
    }
    const cutTied = list[1].total === list[2].total;
    for (const [i, row] of list.entries()) {
      if (cutTied && row.total === list[1].total) row.place = 'tied';
      else if (i < 2) row.place = groupLeft === 0 ? 'qualified' : 'provisional';
    }
  }
  return groups;
}

/** Cross-group round robin: in round r, A[i] meets B[(i + r) mod n]. Every school meets all schools in the other group. */
export function generateGroupRounds(groupA, groupB) {
  const n = Math.min(groupA.length, groupB.length);
  const rounds = [];
  for (let r = 0; r < n; r++) {
    const pairs = [];
    for (let i = 0; i < n; i++) pairs.push([groupA[i], groupB[(i + r) % n]]);
    rounds.push(pairs);
  }
  return rounds;
}
