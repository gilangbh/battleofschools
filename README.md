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
4. **After the group stage**: Admin → *Fill from current results* sets the semifinals (A1 v A2, B1 v B2);
   run it again after the semifinals to set the final.

## Rules built in

Taken from battleofschools.id/homecoming/games/ as published on 17 November 2026 (`src/rules.js`):

- Group match: exactly five games, one standings point per game won. Standings = games won + Festival
  Challenge points.
- Semifinals and final: first to six games; at 5–5 a tiebreak to seven decides it (final score 6–5).
- Two Silver players cannot pair, in any round.
- Men’s doubles needs two men, Women’s doubles two women. A player with no gender on record is refused
  for those categories rather than waved through.
- Each regular player needs three group-stage appearances: tracked and flagged on the captain page.
- Tactical tickets are two separate balances per school, group stage only: three Gold Player deployments and
  two Golden Points. A school cannot use both kinds in the same category match. A Gold Player replaces a
  player of the same gender, before the first serve or after game 2, and must be an approved, active Gold
  Player on the roster.
- Knockout rounds: a player plays one category match per round.

Held for the committee, because no rule has been published:

- **Ties in the standings**: schools level on total share a rank. A tie across the top-two cut is flagged
  and the semifinal is not filled automatically.
- **Who wins a semifinal or final**: never worked out from the scores. An admin confirms the winner under
  Admin → Draw and fixtures; the final and the champion follow from confirmed winners only.
- **Open doubles pairings**: no restriction beyond the Silver rule.

## Privacy and access

- Admin → Settings → *Who can see the site*: admin and desk only (default), captains too, or everyone.
  While private, every page, the TV board, the live fragments and the event stream need a sign-in.
- Admin → Logins → *Cancel all links and sign everyone out* revokes every unused link and every other session.
- Admin → Settings → *Download backup* saves all tournament data as JSON (no logins or links).
-  holds private organizer material and is not in git.

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
