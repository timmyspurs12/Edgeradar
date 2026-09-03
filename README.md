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

Verify a change the way CI does:

```bash
npm test           # 142 Vitest unit tests
npm run lint       # next lint (ESLint)
npm run typecheck  # tsc --noEmit
npm run build      # production build
npm run verify     # all four, in order
```

**Live mode:** copy `.env.example` to `.env.local`, set `DATA_PROVIDER` and the key
for that provider, then `npm run build && npm start`. See
[Connecting live data](#connecting-live-data) for the five supported providers.

Without credentials the app runs in **DEMO MODE**: a seeded, deterministic, fully
synthetic dataset. Every screen is labeled DEMO DATA. Demo and live data are never
mixed, and a live provider is never silently swapped for demo data.

All kickoff times render in **Africa/Lagos (WAT)** — configurable via `DISPLAY_TZ`.

### Deploying to Vercel

Everything Vercel needs lives in the repository root (`package.json`, `src/`,
`prisma/`, `next.config.mjs`, `tsconfig.json`) — nothing is nested in a subfolder,
so the default build settings work unchanged:

| Setting | Value |
| --- | --- |
| Framework preset | Next.js |
| Build command | `npm run build` |
| Output directory | `.next` |
| Install command | `npm install` |
| Node.js | 18.17+ (see `engines`) |

Fonts are **self-hosted** from `src/app/fonts/` (SIL OFL 1.1, licenses included)
rather than fetched with `next/font/google`. `next/font/google` downloads at build
time, which makes deploys fail whenever Google Fonts is slow, rate-limited or
unreachable; vendoring removes that failure mode entirely.

Set your provider variables under Project → Settings → Environment Variables. If a
live provider is selected without its key the deploy still builds, and every page
renders an explicit **DATA PROVIDER MISCONFIGURED** panel naming the missing
variable — it does not quietly fall back to synthetic data.

## Architecture

```
src/lib/types.ts             Domain types
src/lib/time.ts              UTC normalization + display-timezone day boundaries
src/lib/markets.ts           35 market definitions, outcome evaluator, correlation clusters
src/lib/engine.ts            Deterministic prediction engine (EdgeRadar v1.0)
src/lib/repository.ts        queryFixtures() — the single source of truth for fixtures
src/lib/banker.ts            2.00 odds banker engine (whitelist + anti-correlation)
src/lib/service.ts           Provider orchestration, kickoff locking, strict live integrity
src/lib/providers/types.ts   Provider abstraction + ProviderError / ProviderConfigError
src/lib/providers/index.ts   Provider registry (DATA_PROVIDER)
src/lib/providers/customapi.ts      DATA_PROVIDER=custom
src/lib/providers/apifootball.ts    DATA_PROVIDER=api-football
src/lib/providers/footballdata.ts   DATA_PROVIDER=football-data
src/lib/providers/openfootball.ts   DATA_PROVIDER=openfootball
src/lib/providers/demo.ts           DATA_PROVIDER=demo
prisma/schema.prisma         Production PostgreSQL schema (all 19 models)
src/app/…                    Next.js App Router pages + API routes
tests/…                      Vitest unit tests
```

### One authoritative data layer

Every page and API route — `/`, `/matches`, `/two-odds`, `/builder`,
`/api/fixtures`, `/api/two-odds` — reads fixtures through
`queryFixtures(data, options)` in `src/lib/repository.ts`. Nothing filters
`data.fixtures` by hand, so a change to the timezone or status rules lands
everywhere at once.

- **Kickoffs are normalized to UTC exactly once.** A naive timestamp (no `Z` or
  offset) is read as UTC, so results never depend on the server's local timezone.
  Unparseable kickoffs are dropped, never guessed.
- **"Today" and "Tomorrow" are calendar days in the display timezone**, expressed
  as a `[startUtc, endUtc)` UTC window. A 23:30 WAT kickoff is 22:30 UTC on the
  same WAT day, so it stays in "Today" — the classic bug where evening fixtures
  vanish from the list is impossible. Day stepping is done on the calendar, not by
  adding 24h, so DST days (23h/25h) resolve correctly.
- **Status and range filters are orthogonal.** `status` narrows by state
  (`UPCOMING` / `LIVE` / `FINISHED` / `ALL`), `range` narrows by time. Every
  forward-looking window starts at the beginning of the current display-timezone
  day, so in-play matches are never dropped mid-game.

### The 2.00 odds banker (`/two-odds`, `/api/two-odds`)

A small accumulator priced to land on a target (2.00 by default), built strictly
from **Over 1.5 Goals** and **2nd Half Over 0.5 Goals**. Nothing else is eligible.

Hard constraints, enforced while the slip is assembled and re-verified by
`validateBankerLegs()`:

1. Never two legs from the same fixture.
2. Never two legs involving a shared team.
3. Every leg clears the probability floor (default 78%) on ≥12 comparable matches.
4. Only fixtures that have not kicked off are eligible — locked snapshots are never re-priced.
5. If the target is unreachable the slip comes back `SHORT`. It is never padded
   with a weaker or off-whitelist pick.

Odds come from the provider's feed when it has one (`oddsSource: "FEED"`). With no
odds feed the leg is priced at model-derived **fair** odds (100 ÷ probability) and
labeled `"MODEL"` — a derived number is never presented as a bookmaker quote.

### The engine (no generative AI in the probability path)

For each market: blends **season / last-10 / last-5 / home-away / opponent-mirror /
league-baseline** frequencies, then shrinks toward the league baseline
(`p = (raw·n + baseline·k)/(n+k)`, k=12) so thin samples cannot fake confidence.
Edge Score = probability (42%) + sample size (18%) + component consistency (18%) +
recent alignment (12%) + data quality (10%).

### Guarantees enforced in code

- Predictions generated **pre-match only**; snapshots carry a visible timestamp and
  **lock at kickoff** (`lockedAt === kickoff`, set in `applyKickoffLock`).
  `assertPreMatchIntegrity()` runs on every build and throws if any snapshot's
  `generatedAt` is not strictly before its kickoff.
- Post-match verification & calibration are computed separately and never rewrite snapshots.
- **Zero silent mocking.** `src/lib/service.ts` contains no `catch` that substitutes
  demo data. In LIVE mode: a live provider reporting `DEMO` throws, a live provider
  returning zero fixtures throws, and any upstream/network failure propagates
  verbatim to an explicit error panel. `DATA_PROVIDER=demo` is the only way to get
  synthetic data, and it is an explicit opt-in.
- Missing data (corners, cards, injuries, odds) renders as **Data unavailable** — never fabricated.
- Leagues below the sample floor show **INSUFFICIENT DATA** instead of a fake confidence score.
- Combination builder is correlation-aware: one leg per fixture, no shared teams,
  excluded before probabilities are multiplied.
- No prediction is ever described as guaranteed.

## Connecting live data

Exactly one provider serves the app. Set `DATA_PROVIDER` (and that provider's key)
in `.env.local` or in Vercel's environment variables:

| `DATA_PROVIDER` | Source | Required env |
| --- | --- | --- |
| `custom` | Your own JSON API | `CUSTOM_API_URL` (or `CUSTOM_FOOTBALL_API_URL`) [+ `CUSTOM_API_KEY`] |
| `api-football` | API-Football (api-sports.io) | `APIFOOTBALL_KEY` |
| `football-data` | football-data.org | `FOOTBALL_DATA_API_KEY` |
| `openfootball` | OpenFootball community dataset | none (`OPENFOOTBALL_*` optional) |
| `demo` | Seeded synthetic dataset | none |

With `DATA_PROVIDER` unset the provider is auto-detected in the order above
(OpenFootball only when `OPENFOOTBALL_ENABLED=1`), falling back to `demo` when
nothing is configured. Requesting a live provider without its credentials raises
`ProviderConfigError` naming the missing variable — it never downgrades silently.
`/sources` renders the whole registry with each provider's state and missing keys.

### Option 0 — Custom Football API (recommended)

Point EdgeRadar at any HTTP JSON endpoint:

```bash
DATA_PROVIDER=custom
CUSTOM_API_URL=https://your-api.example.com
CUSTOM_API_KEY=your_secret          # sent as Bearer and x-api-key
```

The contract (leagues / teams / fixtures / historical / odds, all optional except
fixtures) is documented at the top of `src/lib/providers/customapi.ts`. The
normalizer handles vendor status vocabulary (`NS`/`1H`/`2H`/`HT`/`FT`/`POSTPONED`),
offset and naive kickoffs, string-typed odds, and missing half-time/corner/card
values — which stay `null` rather than being estimated. Odds are only ever taken
from the payload; this provider never scrapes a bookmaker.

Local mock for offline testing:

```bash
node scripts/mock-custom-api.js     # :4600
DATA_PROVIDER=custom CUSTOM_API_URL=http://127.0.0.1:4600 npm run dev
```

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

### Option C — OpenFootball (no key required)

Openly licensed community datasets from
[openfootball/football.json](https://github.com/openfootball/football.json), served
as plain JSON. No API key, so it is a legitimate live-data option if you do not want
to register with a commercial vendor.

```bash
DATA_PROVIDER=openfootball
OPENFOOTBALL_LEAGUES=en.1,es.1,it.1,de.1,fr.1
OPENFOOTBALL_SEASONS=2026-27,2025-26   # default: current + previous season
OPENFOOTBALL_TZ=Europe/London          # see caveat
```

Honest limitations, surfaced on `/sources` rather than papered over: the dataset
carries **no timezone** (so `OPENFOOTBALL_TZ` declares what zone the published
times are in; the UTC default can shift kickoff labels), and no corners, cards,
odds or injuries — those stay `null`. Matches with no published time default to
00:00 in that zone and are counted in the source notes.

### General

- Keys are server-side env vars only (`.env.example`) — never shipped to the browser.
- Optionally point `DATABASE_URL` at PostgreSQL and run `npx prisma migrate dev`.
- Local mocks for offline testing:
  - `node scripts/mock-custom-api.js` — Custom Football API on **:4600**
    (`CUSTOM_API_URL=http://127.0.0.1:4600`)
  - `node scripts/mock-fdo.js` — football-data v4 on **:4400** (`FDO_BASE_URL`)
  - `node scripts/mock-apifootball.js` — API-Football v3 on **:4500**, simulates the
    free-plan season lock (`APIFOOTBALL_BASE_URL=http://localhost:4500` with any
    `APIFOOTBALL_KEY`)

## Testing

`npm test` runs 142 Vitest unit tests (`vitest.config.ts`, `tests/`):

| File | Covers |
| --- | --- |
| `tests/time.test.ts` | UTC normalization; WAT day boundaries; DST 23h/25h days; calendar day stepping |
| `tests/repository.test.ts` | `queryFixtures` filtering — today/tomorrow in WAT, status × range, live matches never dropped, lock state, sorting |
| `tests/providers.test.ts` | `DATA_PROVIDER` switching, aliases, auto-detect order, `ProviderConfigError` for every missing key |
| `tests/customapi.test.ts` | Custom API contract: status mapping, kickoff normalization, odds provenance, endpoint fallback, auth headers |
| `tests/banker.test.ts` | Market whitelist, anti-correlation rules, odds target, eligibility floors, odds provenance |
| `tests/service.test.ts` | Kickoff locking, pre-match integrity assertion, zero silent mocking, UTC intake |

Tests take an injectable clock (`now`) and an injectable `fetch`, so they never
depend on wall-clock time or the network.

## Disclaimer

EdgeRadar provides statistical probabilities, not guaranteed outcomes. Football
remains inherently unpredictable. Past performance does not guarantee future results.
