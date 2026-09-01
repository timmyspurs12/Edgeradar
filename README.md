# EdgeRadar

**Find the probabilities hiding underneath the obvious markets.**

Pre-match football prediction & statistical intelligence platform. Instead of "who
wins", EdgeRadar surfaces the highest-probability, under-the-radar statistical
outcomes knowable *before kickoff* — total goals lines, team goals, half goals,
BTTS, clean sheets, corners, cards, and protected results.

## Running

```bash
npm install
npm run dev        # http://localhost:3000
```

**Live mode (football-data.org):** get a free key at
https://www.football-data.org/client/register, then:

```bash
cp .env.example .env.local
# set FOOTBALL_DATA_API_KEY=your_key
npm run build && npm start
```

With a key present the app switches to LIVE mode automatically (strict live-only:
only the 10 competitions actually served by the free tier are shown — Premier
League, La Liga, Serie A, Bundesliga, Ligue 1, Champions League, Eredivisie,
Primeira Liga, Brasileirão, EFL Championship). The free tier allows 10 requests
per minute, so the first cold load can take ~1–2 minutes; responses are cached on
disk (`data/fdo-cache.json`, 30-min TTL). Corners, cards, odds and injuries are
not on this tier and render as **Data unavailable** — never fabricated.

Without a key the app runs in **DEMO MODE**: a seeded, deterministic, fully
synthetic dataset. Every screen is labeled DEMO DATA. Demo and live data are
never mixed.

All kickoff times render in **Africa/Lagos (WAT)** — configurable via `DISPLAY_TZ`.

## Architecture

```
src/lib/types.ts            Domain types
src/lib/markets.ts          35 market definitions, outcome evaluator, correlation clusters
src/lib/engine.ts           Deterministic prediction engine (EdgeRadar v1.0)
src/lib/service.ts          App service: snapshots, locking, track record, calibration, league radar
src/lib/providers/types.ts  Provider abstraction (Fixtures/Statistics/Injury/Odds/Broadcast)
src/lib/providers/demo.ts   Seeded synthetic demo provider
src/lib/providers/index.ts  Provider registry (DATA_PROVIDER env)
prisma/schema.prisma        Production PostgreSQL schema (all 19 models)
src/app/…                   Next.js App Router pages + API routes
```

### The engine (no generative AI in the probability path)

For each market: blends **season / last-10 / last-5 / home-away / opponent-mirror /
league-baseline** frequencies, then shrinks toward the league baseline
(`p = (raw·n + baseline·k)/(n+k)`, k=12) so thin samples cannot fake confidence.
Edge Score = probability (42%) + sample size (18%) + component consistency (18%) +
recent alignment (12%) + data quality (10%).

### Guarantees enforced in code

- Predictions generated **pre-match only**; snapshots carry a visible timestamp and
  **lock at kickoff** (post-match data never feeds back).
- Post-match verification & calibration are computed separately and never rewrite snapshots.
- Missing data (corners, cards, injuries, odds) renders as **Data unavailable** — never fabricated.
- Leagues below the sample floor show **INSUFFICIENT DATA** instead of a fake confidence score.
- Combination builder is correlation-aware: one leg per fixture, correlated same-team
  markets excluded before probabilities are multiplied.
- No prediction is ever described as guaranteed.

## Connecting live data

Two live providers ship built-in. Add a key to `.env.local` and restart — no code
changes. Auto-selection priority: **API-Football → football-data.org → demo**.
Force a specific one with `DATA_PROVIDER=api-football | football-data | demo`.
Demo and live data are never mixed.

### Option A — API-Football (api-sports.io)

Free key: <https://dashboard.api-football.com> → `APIFOOTBALL_KEY=...` in `.env.local`.

**Free plan ($0, 100 requests/day, no card):** all endpoints and 1,100+ leagues,
but *only past seasons* — the current season is Pro-only. EdgeRadar handles this
honestly with **REPLAY mode**: it auto-detects an old season, shifts its calendar
onto today's timeline, and replays it walk-forward — fixtures shown as UPCOMING are
real historical matches whose results are hidden from the engine until their
virtual kickoff passes. Every page is labeled REPLAY; it is a full end-to-end test
of the live pipeline with real data, not real upcoming fixtures.

**Pro plan ($19/mo, 7,500 req/day, prepaid, no auto-renewal):** current season
unlocks and REPLAY mode switches itself off — genuine upcoming fixtures, zero code
change. Raise `APIFOOTBALL_STATS_BUDGET` (e.g. 50–100) to enrich corners/cards via
per-fixture statistics (each fixture fetched once, cached permanently).

Quota math (free): 14 leagues × 1 request per refresh cycle, TTL 360 min
(`APIFOOTBALL_TTL_MINUTES`) ≈ 56 req/day — safely inside 100/day. Daily quota
resets 00:00 UTC. Knobs: `APIFOOTBALL_LEAGUES` (CSV of league IDs),
`APIFOOTBALL_SEASON`, `APIFOOTBALL_REPLAY=0` to disable replay.

Odds and injuries are deliberately not wired (not available to free keys); the
VALUE category stays disabled rather than estimated.

### Option B — football-data.org

Free key: <https://www.football-data.org/client/register> →
`FOOTBALL_DATA_API_KEY=...`. Real current-season fixtures for 10 competitions
(PL, La Liga, Serie A, Bundesliga, Ligue 1, UCL, Eredivisie, Primeira, Brasileirão,
Championship). No corners/cards/odds on the free tier.

### General

- Keys are server-side env vars only (`.env.example`) — never shipped to the browser.
- Optionally point `DATABASE_URL` at PostgreSQL and run `npx prisma migrate dev`.
- Local mocks for offline testing: `node scripts/mock-fdo.js` (football-data v4 on
  :4400, use `FDO_BASE_URL`) and `node scripts/mock-apifootball.js` (API-Football v3
  on :4500, simulates free-plan season lock — use `APIFOOTBALL_BASE_URL=http://localhost:4500`
  with any `APIFOOTBALL_KEY`).

## Disclaimer

EdgeRadar provides statistical probabilities, not guaranteed outcomes. Football
remains inherently unpredictable. Past performance does not guarantee future results.
