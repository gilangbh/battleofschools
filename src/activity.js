// School Yard activity scoring, kept free of database and HTTP so it can be tested directly.
// Rule basis: organizer policy BOS26-ACTIVITY-20261124-APPROVED.
//
//   School Yard total = Pin average + Satu Satu average + Accuracy average + On single result + Flip Cup sum
//   Each station is worth at most 5, so the total is at most 25.
//
// A result that has not been recorded is pending. It is never treated as zero and an average is always
// over exactly five showdowns, so each recorded attempt adds a fixed amount (its score divided by five).

export const POLICY_VERSION = 'BOS26-ACTIVITY-20261124-APPROVED';
export const ROUNDS = 5;
export const STATION_MAX = 5;
export const YARD_MAX = 25;
export const BONUS_MAX = 5;


export const STATIONS = [
  { id: 'pin', name: 'Pin the Cut', by: 'Tokusen × JAPFA', agg: 'mean', who: 'Five people, at least one registered player. First eligible group in each showdown.' },
  { id: 'satu', name: 'Satu Satu', by: 'Hopscotch + Blind Scoop', agg: 'mean', who: 'Two spectators, one per role. Ten different people over the five showdowns.' },
  { id: 'accuracy', name: 'Accuracy', by: 'Sucor Sekuritas', agg: 'mean', who: 'One of the school’s eight regular players takes five shots (not a Gold Player). First eligible attempt in each showdown.' },
  { id: 'on', name: 'On Running', by: 'On', agg: 'single', who: 'One or two spectators. One recorded run per school for the whole event.' },
  { id: 'red_bull', name: 'Flip Cup', by: 'Red Bull', agg: 'sum', who: 'Four people, at least one registered player. Each drinks the shot, then at once flips the same emptied cup. One 30-second clock for all four, no refill on a retry. One relay in each showdown.' },
];
export const STATION_BY_ID = new Map(STATIONS.map((s) => [s.id, s]));
export const AGG_LABEL = { mean: 'average of five', single: 'one result', sum: 'sum of five' };

/** Slots a station has: one per group showdown, or slot 0 for the single event-wide On run. */
export const slotsFor = (station) => (station.agg === 'single' ? [0] : Array.from({ length: ROUNDS }, (_, i) => i + 1));
export const RESULTS_NEEDED = STATIONS.reduce((n, s) => n + slotsFor(s).length, 0); // 21

/** Entry fields per station, in the order they are shown. */
export const FIELDS = {
  pin: ['score', 'player', 'ref'],
  satu: ['hop', 'bowl', 'hopper', 'scooper', 'ref'],
  accuracy: ['s1', 's2', 's3', 's4', 's5', 'player', 'ref'],
  on: ['lengths', 'runners', 'ref'],
  red_bull: ['result', 'seconds', 'player', 'ref'],
};
/** Fields that say what happened. The booth sheet reference alone does not make an attempt. */
const RESULT_FIELDS = (stationId) => (FIELDS[stationId] || []).filter((k) => k !== 'ref');

const text = (v) => String(v ?? '').trim();
const blank = (v) => text(v) === '';
/** A strict number: the whole field must be a number, so "3 or 4" is not read as 3. */
const num = (v) => (/^\d+(\.\d+)?$/.test(text(v)) ? Number(text(v)) : NaN);
const whole = (v) => (/^\d+$/.test(text(v)) ? Number(text(v)) : NaN);
export const personKey = (name) => text(name).toLowerCase().replace(/\s+/g, ' ');

/** True when nothing was typed for this attempt, so it is skipped and stays pending. */
export function isBlank(stationId, f) {
  return RESULT_FIELDS(stationId).every((k) => blank(f[k]));
}

/**
 * Check one official attempt and work out its score.
 * f: the entry fields as typed. ctx: { playerIds (Set of the school's active registered players), usedPeople (Set of
 * personKey values this school already used at Satu Satu in other showdowns) }.
 * Returns { error } or { score, raw } where raw is what gets stored.
 */
export function readAttempt(stationId, f, ctx = {}) {
  const r = scoreAttempt(stationId, f, ctx);
  if (r.error) return r;
  // The booth sheet number ties the entry back to the paper record.
  const ref = text(f.ref).slice(0, 40);
  return { score: r.score, raw: ref ? { ...r.raw, ref } : r.raw };
}

function scoreAttempt(stationId, f, ctx = {}) {
  const playerIds = ctx.playerIds || new Set();
  const player = () => {
    const id = whole(f.player);
    return playerIds.has(id) ? id : null;
  };
  if (stationId === 'pin') {
    const score = whole(f.score);
    if (!(score >= 0 && score <= 5)) return { error: 'Pin the Cut: enter how many of the five labels were correct, 0 to 5.' };
    const p = player();
    if (!p) return { error: 'Pin the Cut: choose the registered player who was in the group of five.' };
    return { score, raw: { score, player: p } };
  }
  if (stationId === 'satu') {
    const hop = whole(f.hop);
    const bowl = num(f.bowl);
    if (!(hop >= 0 && hop <= 5)) return { error: 'Satu Satu: enter how many of the five Hopscotch achievements were made, 0 to 5.' };
    if (!(bowl >= 0 && bowl <= 1000)) return { error: 'Satu Satu: enter the Blind Scoop bowl points as a number.' };
    const hopper = text(f.hopper).slice(0, 60);
    const scooper = text(f.scooper).slice(0, 60);
    if (!hopper || !scooper) return { error: 'Satu Satu: enter the names of both spectators, the hopper and the scooper.' };
    if (personKey(hopper) === personKey(scooper)) return { error: 'Satu Satu: the hopper and the scooper must be two different people.' };
    for (const name of [hopper, scooper]) {
      if (ctx.usedPeople?.has(personKey(name))) return { error: `Satu Satu: ${name} already took an official Satu Satu turn for this school in another showdown. Each school needs ten different people.` };
    }
    const score = hop * 0.5 + Math.min((bowl / 40) * 2.5, 2.5);
    return { score, raw: { hop, bowl, hopper, scooper } };
  }
  if (stationId === 'accuracy') {
    const shots = ['s1', 's2', 's3', 's4', 's5'].map((k) => num(f[k]));
    if (shots.some((n) => !(n >= 0 && n <= 1000))) return { error: 'Accuracy: enter all five shot values. A miss or a foot fault is 0.' };
    const p = player();
    if (!p) return { error: 'Accuracy: choose the registered player who took the five shots.' };
    const score = Math.min(shots.reduce((a, b) => a + b, 0) / 20, 5);
    return { score, raw: { shots, player: p } };
  }
  if (stationId === 'on') {
    const lengths = whole(f.lengths);
    if (!(lengths >= 0 && lengths <= 60)) return { error: 'On Running: enter the number of completed 20 m lengths.' };
    const runners = text(f.runners).slice(0, 120);
    if (!runners) return { error: 'On Running: enter the name of the runner, or both names for a pair.' };
    return { score: Math.min(lengths * 0.5, 5), raw: { lengths, runners } };
  }
  if (stationId === 'red_bull') {
    if (f.result !== 'done' && f.result !== 'not') return { error: 'Flip Cup: choose whether the relay was completed within 30 seconds.' };
    const seconds = blank(f.seconds) ? null : num(f.seconds);
    if (seconds !== null && !(seconds >= 0 && seconds <= 600)) return { error: 'Flip Cup: the time of the final flip must be a number of seconds.' };
    if (f.result === 'done' && seconds !== null && seconds > 30) return { error: 'Flip Cup: a relay finished after 30 seconds is not completed. Choose “Not completed”.' };
    const p = player();
    if (!p) return { error: 'Flip Cup: choose the registered player who was in the four.' };
    return { score: f.result === 'done' ? 1 : 0, raw: { result: f.result, seconds, player: p } };
  }
  return { error: 'Unknown station.' };
}

/** A stored result in the shape of the entry fields, so an edit starts from what was recorded. */
export function fieldsFromRaw(stationId, x) {
  if (!x || x.demo) return {};
  if (stationId === 'accuracy') return { s1: x.shots[0], s2: x.shots[1], s3: x.shots[2], s4: x.shots[3], s5: x.shots[4], player: x.player, ref: x.ref ?? '' };
  return { ...x, seconds: x.seconds ?? '', ref: x.ref ?? '' };
}

/**
 * One school's School Yard position from its recorded attempts ([{ station, slot, score }]).
 * `banked` is what the recorded attempts are worth so far; `total` is set only when all 21 results are in.
 */
export function summarize(allRows = []) {
  // A result held for committee review is on record but not counted, so its slot stays pending.
  const rows = allRows.filter((r) => !r.held);
  const held = allRows.length - rows.length;
  const stations = {};
  let banked = 0;
  let entered = 0;
  for (const st of STATIONS) {
    const need = slotsFor(st).length;
    const scores = rows.filter((r) => r.station === st.id).map((r) => r.score);
    const sum = scores.reduce((a, b) => a + b, 0);
    const points = Math.min(st.agg === 'mean' ? sum / ROUNDS : sum, STATION_MAX);
    stations[st.id] = { count: scores.length, need, points, complete: scores.length === need };
    banked += points;
    entered += scores.length;
  }
  const complete = entered === RESULTS_NEEDED;
  return { stations, banked, entered, held, needed: RESULTS_NEEDED, complete, total: complete ? banked : null };
}

/** Points shown to people: at most two decimals, no trailing zeros. Display rounding is still the committee's call. */
export const fmtPoints = (n) => String(Number((Math.round(n * 100) / 100).toFixed(2)));
