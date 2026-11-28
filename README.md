# Battle of Schools scores

Live scoring, captain lineups and scoreboards for Battle of Schools Homecoming 2026 (padel, 10 schools, 28 November 2026).

## Run it locally

Needs Node.js 22.13 or newer.

```
npm install
npm start
```

Then open http://localhost:3000.

| Screen | Address | Who |
| --- | --- | --- |
| Live scores (phone) | `/` | Everyone, no sign-in |
| TV scoreboard with QR code | `/tv` | Venue screens, no sign-in |
| TV match history, group tables with School Yard points | `/tv/v2` | Venue screens, no sign-in |
| Captain lineups | `/captain` | School captains |
| Scoring desk | `/desk` | Desk staff |
| Admin | `/admin` | Organizer |

Local test logins (created only when not in production): `admin@bos.local`, `desk@bos.local`,
`captain.acs@bos.local`, `captain.jis@bos.local`. Enter one on `/login`; with no email service configured
the sign-in link is shown on the page.

To see every screen populated, sign in as admin and use Admin → Settings → **Load demo data**
(or start with `DEMO=1 npm start` on an empty database). **Clear results** removes it again.

`npm test` runs the rules tests.

## How match day works

1. **After the draw (25 Nov)**: Admin → set Group A / B → Generate fixtures → edit each showdown to match the
   draw and add times and courts.
2. **Captains** pick a pair for each category match. A lineup is hidden until the other captain submits,
   then both are shown and locked. The desk can enter or clear a lineup for a captain.
3. **Scoring desk** opens a showdown, picks one of the six courts and taps *Start match* (it appears on the
   scoreboards). During play each tap on + or − updates the live score on the TV and phones. *Save final score*
   closes the match. *Edit* next to a pair changes the lineup; *★ Ticket* records a Golden Point or Gold Player.
4. **School Yard points**: Scoring desk → *School Yard points* → choose a school. Type in each station result
   as the booth sheet arrives and press *Save*. A row left empty stays pending. A recorded row is locked behind
   *Edit*, which is for recording mistakes only; every change is kept in the change list.
5. **After the group stage**: Admin → *Fill from current results* sets the semifinals (A1 v A2, B1 v B2) once
   the group matches and every school's activity results are in; run it again after the semifinals to set the final.

## Rules built in

Padel and Gold rules follow the organizer's brief of 24 November 2026 (`src/rules.js`):

- Group match: exactly five games, one standings point per game won. Categories play Men’s, Women’s, then Open.
- Standings = games won + School Yard points + School Spirit bonus (up to 5, entered per school).
- Semifinals and final: no tactical tickets, a player plays one category per round, and the first school to win
  two categories wins (the third is only needed at 1–1; total games never decide it). Each category is first
  to six games; at 5–5 a first-to-seven tiebreak decides it and the score is recorded as 6–5.
- Two Silver players cannot pair, in any round.
- Men’s doubles needs two men, Women’s doubles two women. A player with no gender on record is refused
  for those categories rather than waved through.
- Each regular player needs three group-stage appearances: tracked and flagged on the captain page. A player
  replaced by the Gold Player keeps the appearance.
- Tactical tickets are two separate balances per school, group stage only: three Gold Player deployments and
  two Golden Points. A school cannot use both kinds in the same category match.
- The Gold Player may replace only a highest-rated regular of the original pair (Lower Bronze < Bronze < Silver,
  compared before gender), must be the same gender as that player, and comes in before the first serve or
  after game 2. A category still under review or a missing gender is refused, never assumed. The check runs on
  the server for captains and for the desk (`goldReplaceError`), not only in the buttons.

School Yard activities follow policy BOS26-ACTIVITY-20261124-APPROVED (`src/activity.js`):

- Total = Pin the Cut average + Satu Satu average + Accuracy average + On Running single result + Flip Cup sum.
  Each station is worth at most 5, so at most 25.
- One official result per school, station and group showdown; On Running has one for the whole event. The
  database key enforces it, so a repeated submission never becomes a second attempt.
- A missing result is pending: never zero, never a smaller denominator. Each recorded attempt at an averaged
  station counts a fifth of its score, so the running figure is exact. A school's 25 is final at 21 results.
- Satu Satu needs two different spectators each showdown and nobody twice for the same school.
- Semifinal places stay provisional until the group matches, all activity results and the bonus are in.
- `npm test` also compares the scoring with the organizer's reference module when the private
  `references/` folder is present.

Not built: the Best School Yard supporter award, open-play records and sponsor gifts. They are separate from
tournament scoring and their allocation rules are still open.

Held for the committee, because no rule has been published:

- **Ties in the standings**: schools level on total share a rank. A tie across the top-two cut is flagged
  and the semifinal is not filled automatically.
- **Open doubles pairings**: no restriction beyond the Silver rule.
- **Missed or invalid activity attempts and display rounding**: nothing is defaulted; points show to two decimals.

## Roster import

`POST /admin/roster/import` (admin, JSON) brings the regular players in line with a registration snapshot,
matched by stable registration ID, then portrait file, then name. Nobody is deleted: a regular who is no longer
in the snapshot is switched off. It answers with a change report keyed by registration ID. Full name and jersey
name are stored apart from the short scoreboard name.

## Privacy and access

- Admin → Settings → *Who can see the site*: admin and desk only (default), captains too, or everyone.
  While private, every page, the TV board, the live fragments and the event stream need a sign-in.
- Admin → Logins → *Cancel all links and sign everyone out* revokes every unused link and every other session.
- Admin → Settings → *Download backup* saves all tournament data as JSON (no logins or links).
- `references/` holds private organizer material and is not in git.

## Data

- `seed/schools.json`: schools, players and levels imported from the school pages on battleofschools.id.
  `npm run scrape` refreshes it and the crests. The seed loads only into an empty database.
- `data/bos.db`: SQLite database (created on first start, not in git).
- Styling: `public/css/tournament.css` is the results stylesheet from battleofschools.id; `public/css/app.css`
  carries the same colours, Poppins fonts and component styles.

## Deploying (Railway)

One service running `npm start`, a volume mounted for the database with
`DATA_DIR` pointing at it, and the variables in `.env.example`. Run a single instance: live updates and the
database are both in-process.
