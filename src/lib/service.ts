import { resolveProvider } from "./providers";
import { ProviderError, WarmingUpError } from "./providers/types";
import { buildContext, EngineContext, predictFixture, MODEL_VERSION } from "./engine";
import { evalMarket, MARKETS } from "./markets";
import { toUtcIso } from "./time";
import {
  Fixture, League, LeagueRadarStats, MatchPrediction, ResolvedPrediction, Team, TeamForm,
} from "./types";

/**
 * APPLICATION SERVICE LAYER
 * -------------------------
 * Pulls data through the provider abstraction, runs the prediction engine,
 * locks snapshots at kickoff, resolves finished predictions, and caches the
 * result for one hour.
 *
 * STRICT LIVE DATA INTEGRITY — ZERO SILENT MOCKING
 *  1. The provider is resolved once, from the environment. If a live provider
 *     is requested and misconfigured, `ProviderConfigError` propagates to the
 *     error boundary. There is no `catch` anywhere in this file that swaps in
 *     the demo dataset.
 *  2. `mode` on the returned data is the *provider's* mode. A live provider
 *     that reports `DEMO` is a contract violation and throws.
 *  3. In LIVE mode an empty payload is an error, not an empty dashboard.
 *  4. A live provider that is still filling its rate-limited cache throws
 *     `WarmingUpError`; pages render a progress screen. They do not render
 *     synthetic numbers while waiting.
 *  5. Predictions are pre-match artifacts. Once a fixture kicks off its
 *     snapshot is locked (`lockedAt === kickoff`) and is never recomputed from
 *     in-play or post-match data.
 */

export interface AppData {
  mode: "DEMO" | "LIVE";
  /** Which provider produced this data (see src/lib/providers). */
  providerId: string;
  builtAt: string;
  leagues: League[];
  teams: Team[];
  fixtures: Fixture[];
  ctx: EngineContext;
  predictions: Map<string, MatchPrediction>;
  resolved: ResolvedPrediction[];
  radar: LeagueRadarStats[];
}

let cached: AppData | null = null;
let cachedKey = "";

const HOUR = 3600000;
/** How long before kickoff a finished/live fixture's snapshot is dated. */
const PRE_MATCH_LEAD_MS = 5 * HOUR;

/** Result wrapper: pages render a progress screen while a live provider warms
 *  its cache instead of blocking the render for minutes (rate-limited APIs). */
export type AppResult =
  | { warming: true; loaded: number; total: number }
  | { warming: false; data: AppData };

/** Test/support hook — forces the next `getAppData()` to rebuild. */
export function resetAppDataCache(): void {
  cached = null;
  cachedKey = "";
}

export async function tryGetAppData(): Promise<AppResult> {
  try {
    return { warming: false, data: await getAppData() };
  } catch (e) {
    if (e instanceof WarmingUpError) return { warming: true, loaded: e.loaded, total: e.total };
    throw e; // every other failure reaches the error boundary untouched
  }
}

/**
 * Tri-state loader for pages.
 *
 * Pages must render one of exactly three things: real data, a warm-up progress
 * screen, or an explicit provider-failure panel. Never synthetic data standing
 * in for a live feed. Catching here (rather than letting the throw escape the
 * Server Component) keeps the explanation in the server-rendered HTML instead
 * of an empty 500 shell that only becomes readable after client hydration.
 */
export type PageDataResult =
  | { state: "ok"; data: AppData }
  | { state: "warming"; loaded: number; total: number }
  | { state: "error"; error: unknown };

export async function loadAppData(): Promise<PageDataResult> {
  try {
    return { state: "ok", data: await getAppData() };
  } catch (e) {
    if (e instanceof WarmingUpError) return { state: "warming", loaded: e.loaded, total: e.total };
    return { state: "error", error: e };
  }
}

export async function getAppData(): Promise<AppData> {
  const key = new Date().toISOString().slice(0, 13); // rebuild hourly
  if (cached && cachedKey === key) return applyKickoffLock(cached);

  const { provider, id: providerId } = resolveProvider();
  const built = await buildAppData(provider, providerId);

  cached = built;
  cachedKey = key;
  return applyKickoffLock(cached);
}

type ProviderLike = ReturnType<typeof resolveProvider>["provider"];

/**
 * Builds the whole app snapshot from one provider. Exported for tests: pass any
 * object shaped like a provider and the integrity rules still apply.
 */
export async function buildAppData(provider: ProviderLike, providerId: string = provider.id): Promise<AppData> {
  const declaredMode = provider.mode;

  // A provider selected as "live" must actually be live. Guards against a
  // provider implementation silently reporting synthetic data.
  if (declaredMode === "DEMO" && providerId !== "demo") {
    throw new ProviderError(
      `Provider "${providerId}" is registered as a live source but reported mode DEMO. Refusing to serve synthetic data as live.`,
      providerId, false,
    );
  }

  const [leagues, teams, rawFixtures, hist] = await Promise.all([
    provider.getLeagues(),
    provider.getTeams(),
    provider.getFixtures(),
    provider.getHistoricalMatches(),
  ]);

  // ── intake: normalize every kickoff to UTC exactly once ──────────────────
  const fixtures: Fixture[] = [];
  const rejected: string[] = [];
  for (const fx of rawFixtures) {
    try {
      fixtures.push({ ...fx, kickoff: toUtcIso(fx.kickoff) });
    } catch (e) {
      rejected.push(`${fx.id}: ${(e as Error).message}`);
    }
  }

  if (declaredMode === "LIVE" && fixtures.length === 0) {
    throw new ProviderError(
      `Live provider "${providerId}" returned zero usable fixtures${rejected.length ? ` (${rejected.length} rejected, e.g. ${rejected[0]})` : ""}. ` +
        `Nothing was substituted — fix the upstream feed or set DATA_PROVIDER=demo to opt into synthetic data explicitly.`,
      providerId,
    );
  }

  const now = Date.now();

  // Prediction timestamp policy:
  //  UPCOMING → now (capped 60s before kickoff)
  //  LIVE/FINISHED → kickoff − 5h, i.e. a snapshot that predates the match.
  const genAt = (fx: Fixture) => {
    const ko = Date.parse(fx.kickoff);
    if (fx.status === "FINISHED" || ko <= now) return new Date(ko - PRE_MATCH_LEAD_MS).toISOString();
    return new Date(Math.min(now, ko - 60000)).toISOString();
  };

  // STRICT PRE-MATCH GUARANTEE: a prediction may only ever see historical
  // matches dated BEFORE its own generation timestamp. Upcoming fixtures use a
  // "now" context; fixtures that have already kicked off get a context cut off
  // at the start of their generation day, so same-day and later results —
  // including the fixture's own — can never leak into the numbers.
  const ctx = buildContext(leagues, teams, hist, new Date(now).toISOString());
  const dayCtx = new Map<string, EngineContext>();
  const ctxFor = (fx: Fixture): EngineContext => {
    if (fx.status !== "FINISHED" && Date.parse(fx.kickoff) > now) return ctx;
    const g = genAt(fx);
    const dayKey = g.slice(0, 10);
    if (!dayCtx.has(dayKey)) {
      dayCtx.set(dayKey, buildContext(leagues, teams, hist, `${dayKey}T00:00:00.000Z`));
    }
    return dayCtx.get(dayKey)!;
  };

  // Synchronous odds lookup, preloaded from the provider. A provider with no
  // odds feed yields null — the engine then reports no value edge rather than
  // inventing a price.
  const oddsCache = new Map<string, number | null>();
  const preloadOdds = async (fxId: string) => {
    for (const m of MARKETS) {
      oddsCache.set(`${fxId}:${m.code}`, await provider.getOdds(fxId, m.code));
    }
  };
  const oddsLeagues = new Set(leagues.filter((l) => l.hasOddsFeed).map((l) => l.id));
  for (const fx of fixtures) if (oddsLeagues.has(fx.leagueId)) await preloadOdds(fx.id);
  const oddsLookup = (fxId: string, code: string) => oddsCache.get(`${fxId}:${code}`) ?? null;

  const predictions = new Map<string, MatchPrediction>();
  for (const fx of fixtures) {
    predictions.set(fx.id, predictFixture(fx, ctxFor(fx), genAt(fx), oddsLookup));
  }

  assertPreMatchIntegrity(fixtures, predictions);

  // ── resolve finished predictions (kept strictly separate from generation) ──
  const resolved: ResolvedPrediction[] = [];
  for (const fx of fixtures) {
    if (fx.status !== "FINISHED" || !fx.result) continue;
    const pred = predictions.get(fx.id);
    if (!pred || pred.noStrongEdge) continue;
    const published = new Map<string, (typeof pred.top3)[number]>();
    for (const m of [...pred.top3, ...pred.safest, ...pred.underTheRadar]) published.set(m.market.code, m);
    for (const m of published.values()) {
      const won = evalMarket(m.market.code, fx.result);
      if (won === null) continue;
      resolved.push({
        fixtureId: fx.id, leagueId: fx.leagueId,
        marketCode: m.market.code, marketLabel: m.market.label, group: m.market.group,
        probability: m.probability, edgeScore: m.edgeScore, confidenceTier: m.confidenceTier,
        generatedAt: pred.generatedAt, kickoff: fx.kickoff,
        outcome: won ? "WIN" : "LOSS",
        odds: m.odds,
      });
    }
  }

  // ── league radar ──
  const radar: LeagueRadarStats[] = leagues.map((lg) => {
    const lines = (ctx.histByLeague.get(lg.id) ?? []).map((h) => ({ hg: h.hg, ag: h.ag, hg1: h.hg1, ag1: h.ag1, corners: h.corners, cards: h.cards }));
    const rate = (code: string) => {
      let hit = 0, tot = 0;
      for (const l of lines) { const r = evalMarket(code, l); if (r !== null) { tot++; if (r) hit++; } }
      return tot ? Math.round((hit / tot) * 1000) / 10 : 0;
    };
    const cornersVals = lines.map((l) => l.corners).filter((c): c is number => c !== null);
    const cardsVals = lines.map((l) => l.cards).filter((c): c is number => c !== null);
    const upcoming = fixtures.filter((f) => f.leagueId === lg.id && f.status === "UPCOMING").length;
    const candidates = ["O1.5", "2H_O0.5", "1H_O0.5", "BTTS_Y", "O2.5", "U4.5"].map((c) => ({
      market: MARKETS.find((m) => m.code === c)!.label, rate: rate(c),
    }));
    return {
      leagueId: lg.id, upcoming,
      avgGoals: lg.avgGoals,
      o05: rate("O0.5"), o15: rate("O1.5"), o25: rate("O2.5"),
      btts: rate("BTTS_Y"),
      fh_o05: rate("1H_O0.5"), sh_o05: rate("2H_O0.5"),
      avgCorners: cornersVals.length ? Math.round((cornersVals.reduce((a, b) => a + b, 0) / cornersVals.length) * 10) / 10 : null,
      avgCards: cardsVals.length ? Math.round((cardsVals.reduce((a, b) => a + b, 0) / cardsVals.length) * 10) / 10 : null,
      homeScoringRate: rate("H_O0.5"),
      awayScoringRate: rate("A_O0.5"),
      hotMarkets: candidates.sort((a, b) => b.rate - a.rate).slice(0, 3),
    };
  });

  return {
    mode: declaredMode, providerId, builtAt: new Date(now).toISOString(),
    leagues, teams, fixtures, ctx, predictions, resolved, radar,
  };
}

/**
 * Pre-match integrity assertion. Runs on every build so a regression in the
 * engine's timestamp handling fails loudly instead of publishing a leaked
 * prediction.
 */
export function assertPreMatchIntegrity(
  fixtures: Fixture[],
  predictions: Map<string, MatchPrediction>,
): void {
  for (const fx of fixtures) {
    const pred = predictions.get(fx.id);
    if (!pred) continue;
    const ko = Date.parse(fx.kickoff);
    const gen = Date.parse(pred.generatedAt);
    if (gen >= ko) {
      throw new ProviderError(
        `Pre-match integrity violation on ${fx.id}: prediction generated at ${pred.generatedAt} is not before kickoff ${fx.kickoff}.`,
        "engine", false,
      );
    }
  }
}

/**
 * KICKOFF-TIME LOCK.
 * Re-derived on every request so a fixture flips UPCOMING → LIVE at kickoff and
 * its prediction snapshot becomes immutable:
 *   · `lockedAt` is set to the fixture's kickoff timestamp, exactly.
 *   · `generatedAt` always stays strictly before kickoff.
 *   · A fixture that has not kicked off is never marked locked.
 */
export function applyKickoffLock(data: AppData, now: number = Date.now()): AppData {
  for (const fx of data.fixtures) {
    const ko = Date.parse(fx.kickoff);
    if (fx.status !== "FINISHED") {
      fx.status = ko <= now ? (ko <= now - 2 * HOUR ? "FINISHED" : "LIVE") : "UPCOMING";
    }
    const pred = data.predictions.get(fx.id);
    if (!pred) continue;
    if (ko <= now) {
      pred.lockedAt = fx.kickoff; // locked AT kickoff — never after
    } else {
      pred.lockedAt = null;
    }
  }
  return data;
}

// ── team form windows (feeds match intelligence view) ──────────────────────
export function teamForm(ctx: EngineContext, teamId: string): TeamForm[] {
  const samples = ctx.samplesByTeam.get(teamId) ?? [];
  const build = (window: TeamForm["window"], list: typeof samples): TeamForm => {
    let scored = 0, conceded = 0, over15 = 0, btts = 0, sh = 0, fh = 0, cs = 0;
    const corners: number[] = [], cards: number[] = [];
    for (const s of list) {
      scored += s.gf; conceded += s.ga;
      if (s.gf + s.ga > 1.5) over15++;
      if (s.gf > 0 && s.ga > 0) btts++;
      if (s.gf1 !== null && s.ga1 !== null) {
        if (s.gf + s.ga - s.gf1 - s.ga1 > 0) sh++;
        if (s.gf1 + s.ga1 > 0) fh++;
      }
      if (s.ga === 0) cs++;
      if (s.corners !== null) corners.push(s.corners);
      if (s.cards !== null) cards.push(s.cards);
    }
    return {
      teamId, window, played: list.length, scored, conceded,
      over15, btts, sh_o05: sh, fh_o05: fh, cleanSheets: cs,
      avgCorners: corners.length ? Math.round((corners.reduce((a, b) => a + b, 0) / corners.length) * 10) / 10 : null,
      avgCards: cards.length ? Math.round((cards.reduce((a, b) => a + b, 0) / cards.length) * 10) / 10 : null,
    };
  };
  return [
    build("LAST5", samples.slice(0, 5)),
    build("LAST10", samples.slice(0, 10)),
    build("SEASON", samples),
    build("HOME", samples.filter((s) => s.home)),
    build("AWAY", samples.filter((s) => !s.home)),
  ];
}

// ── model performance aggregates ────────────────────────────────────────────
export interface ModelStats {
  modelVersion: string;
  total: number; wins: number; losses: number; hitRate: number;
  avgProbability: number;
  roi: number | null;
  calibration: { bucket: string; predicted: number; actual: number; n: number }[];
  byMarket: { code: string; label: string; n: number; wins: number; hitRate: number; avgProb: number }[];
  byLeague: { leagueId: string; n: number; wins: number; hitRate: number }[];
  byTier: { tier: string; n: number; wins: number; hitRate: number; avgProb: number }[];
}

export function modelStats(resolved: ResolvedPrediction[]): ModelStats {
  const total = resolved.length;
  const wins = resolved.filter((r) => r.outcome === "WIN").length;
  const avgProbability = total ? resolved.reduce((s, r) => s + r.probability, 0) / total : 0;

  const withOdds = resolved.filter((r) => r.odds !== null);
  let roi: number | null = null;
  if (withOdds.length >= 20) {
    const staked = withOdds.length;
    const returned = withOdds.reduce((s, r) => s + (r.outcome === "WIN" ? (r.odds as number) : 0), 0);
    roi = Math.round(((returned - staked) / staked) * 1000) / 10;
  }

  const buckets: [string, number, number][] = [
    ["70–74%", 70, 75], ["75–79%", 75, 80], ["80–84%", 80, 85], ["85–89%", 85, 90], ["90%+", 90, 101],
  ];
  const calibration = buckets.map(([bucket, lo, hi]) => {
    const list = resolved.filter((r) => r.probability >= lo && r.probability < hi);
    const w = list.filter((r) => r.outcome === "WIN").length;
    return {
      bucket,
      predicted: list.length ? Math.round((list.reduce((s, r) => s + r.probability, 0) / list.length) * 10) / 10 : 0,
      actual: list.length ? Math.round((w / list.length) * 1000) / 10 : 0,
      n: list.length,
    };
  }).filter((b) => b.n > 0);

  const groupBy = <K extends string>(keyOf: (r: ResolvedPrediction) => K) => {
    const map = new Map<K, ResolvedPrediction[]>();
    for (const r of resolved) {
      const k = keyOf(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return map;
  };

  const byMarket = [...groupBy((r) => r.marketCode).entries()].map(([code, list]) => ({
    code, label: list[0].marketLabel, n: list.length,
    wins: list.filter((r) => r.outcome === "WIN").length,
    hitRate: Math.round((list.filter((r) => r.outcome === "WIN").length / list.length) * 1000) / 10,
    avgProb: Math.round((list.reduce((s, r) => s + r.probability, 0) / list.length) * 10) / 10,
  })).sort((a, b) => b.n - a.n);

  const byLeague = [...groupBy((r) => r.leagueId).entries()].map(([leagueId, list]) => ({
    leagueId, n: list.length,
    wins: list.filter((r) => r.outcome === "WIN").length,
    hitRate: Math.round((list.filter((r) => r.outcome === "WIN").length / list.length) * 1000) / 10,
  })).sort((a, b) => b.n - a.n);

  const byTier = [...groupBy((r) => r.confidenceTier).entries()].map(([tier, list]) => ({
    tier, n: list.length,
    wins: list.filter((r) => r.outcome === "WIN").length,
    hitRate: Math.round((list.filter((r) => r.outcome === "WIN").length / list.length) * 1000) / 10,
    avgProb: Math.round((list.reduce((s, r) => s + r.probability, 0) / list.length) * 10) / 10,
  }));

  return {
    modelVersion: MODEL_VERSION,
    total, wins, losses: total - wins,
    hitRate: total ? Math.round((wins / total) * 1000) / 10 : 0,
    avgProbability: Math.round(avgProbability * 10) / 10,
    roi, calibration, byMarket, byLeague, byTier,
  };
}
