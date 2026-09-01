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

1. Implement `FootballDataProvider` (see `src/lib/providers/types.ts`).
2. Register it in `src/lib/providers/index.ts`; set `DATA_PROVIDER=live`.
3. Keys are server-side env vars only (`.env.example`) — never shipped to the browser.
4. Point `DATABASE_URL` at PostgreSQL and run `npx prisma migrate dev`.

## Disclaimer

EdgeRadar provides statistical probabilities, not guaranteed outcomes. Football
remains inherently unpredictable. Past performance does not guarantee future results.
