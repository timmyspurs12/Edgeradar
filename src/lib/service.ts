import { getProvider } from "./providers";
import { WarmingUpError } from "./providers/types";
import { buildContext, EngineContext, predictFixture, MODEL_VERSION } from "./engine";
import { evalMarket, MARKETS } from "./markets";
import {
  Fixture, League, LeagueRadarStats, MatchPrediction, ResolvedPrediction, Team, TeamForm,
} from "./types";

/**
 * Application service layer. Pulls data through the provider abstraction,
 * runs the engine, resolves finished predictions, and caches per day.
 */

export interface AppData {
  mode: "DEMO" | "LIVE";
  providerId: string;
  providerName: string;
  replay?: boolean;
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

/** Result wrapper: pages render a progress screen while a live provider warms
 *  its cache instead of blocking the render for minutes (rate-limited APIs). */
export type AppResult =
  | { warming: true; loaded: number; total: number }
  | { warming: false; data: AppData };

export async function tryGetAppData(): Promise<AppResult> {
  try {
    return { warming: false, data: await getAppData() };
  } catch (e) {
    if (e instanceof WarmingUpError) return { warming: true, loaded: e.loaded, total: e.total };
    throw e;
  }
}

export async function getAppData(): Promise<AppData> {
  const key = new Date().toISOString().slice(0, 13); // refresh hourly
  if (cached && cachedKey === key) return refreshStatuses(cached);

  const provider = getProvider();
  const [leagues, teams, fixtures, hist] = await Promise.all([
    provider.getLeagues(), provider.getTeams(), provider.getFixtures(), provider.getHistoricalMatches(),
  ]);

  const now = Date.now();

  // Prediction timestamp policy:
  //  UPCOMING → now (capped 60s before kickoff) · FINISHED/LIVE → kickoff − 5h.
  const genAt = (fx: Fixture) => {
    const ko = new Date(fx.kickoff).getTime();
    if (fx.status === "FINISHED" || ko <= now) return new Date(ko - 5 * HOUR).toISOString();
    return new Date(Math.min(now, ko - 60000)).toISOString();
  };

  // Strict pre-match guarantee with live feeds: a prediction may only see
  // historical matches dated BEFORE its generation timestamp. Upcoming fixtures
  // use a "now" context; finished fixtures (track record) get a context cut off
  // at the earliest generation timestamp of their generation day.
  const ctx = buildContext(leagues, teams, hist, new Date(now).toISOString());
  const dayCtx = new Map<string, EngineContext>();
  const ctxFor = (fx: Fixture): EngineContext => {
    if (fx.status !== "FINISHED" && new Date(fx.kickoff).getTime() > now) return ctx;
    const g = genAt(fx);
    const key = g.slice(0, 10);
    if (!dayCtx.has(key)) {
      // cutoff = start of that generation day → never sees same-day or later results
      dayCtx.set(key, buildContext(leagues, teams, hist, `${key}T00:00:00.000Z`));
    }
    return dayCtx.get(key)!;
  };

  // Synchronous odds lookup backed by provider (demo provider is sync inside).
  const oddsCache = new Map<string, number | null>();
  const preloadOdds = async (fxId: string) => {
    for (const m of MARKETS) {
      const v = await provider.getOdds(fxId, m.code);
      oddsCache.set(`${fxId}:${m.code}`, v);
    }
  };
  const oddsLeagues = new Set(leagues.filter((l) => l.hasOddsFeed).map((l) => l.id));
  for (const fx of fixtures) if (oddsLeagues.has(fx.leagueId)) await preloadOdds(fx.id);
  const oddsLookup = (fxId: string, code: string) => oddsCache.get(`${fxId}:${code}`) ?? null;

  const predictions = new Map<string, MatchPrediction>();
  for (const fx of fixtures) {
    predictions.set(fx.id, predictFixture(fx, ctxFor(fx), genAt(fx), oddsLookup));
  }

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

  cached = {
    mode: provider.mode,
    providerId: provider.id,
    providerName: provider.name,
    builtAt: new Date(now).toISOString(),
    leagues, teams, fixtures, ctx, predictions, resolved, radar,
  };
  cachedKey = key;
  return refreshStatuses(cached);
}

// Kickoff-time lock: statuses are re-derived on every request so a fixture
// flips UPCOMING → LIVE at kickoff and its snapshot becomes locked.
function refreshStatuses(data: AppData): AppData {
  const now = Date.now();
  for (const fx of data.fixtures) {
    const ko = new Date(fx.kickoff).getTime();
    if (fx.status !== "FINISHED") {
      fx.status = ko <= now ? (ko <= now - 2 * HOUR ? "FINISHED" : "LIVE") : "UPCOMING";
    }
    const pred = data.predictions.get(fx.id);
    if (pred && ko <= now && !pred.lockedAt) pred.lockedAt = fx.kickoff;
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
