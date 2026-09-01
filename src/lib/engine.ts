import {
  ComponentBreakdown, ConfidenceTier, Fixture, HistoricalMatch, League,
  MarketDef, MarketPrediction, MatchPrediction, Team,
} from "./types";
import { MARKETS, StatLine, areCorrelated, evalMarket } from "./markets";

export const MODEL_VERSION = "EdgeRadar v1.0";

/**
 * PRE-MATCH STATISTICAL ENGINE
 * ----------------------------
 * Deterministic, evidence-based probability model. No generative AI, no
 * fabricated numbers. Every probability is a weighted blend of measurable
 * frequencies, shrunk toward the league baseline in proportion to sample size
 * (small samples can never manufacture extreme confidence).
 *
 * Components blended per market:
 *   season          — combined both-team season frequency
 *   last10 / last5  — weighted recent form
 *   homeAway        — home team @home + away team @away frequency
 *   opponent        — mirror-side (defensive/conceding) frequency
 *   league          — league-wide baseline frequency
 *
 * Strict pre-match rule: only historical matches dated BEFORE the prediction
 * timestamp are ever passed into this engine. Fixture results never enter.
 */

// A historical match viewed from one team's perspective.
interface Sample {
  date: string;
  home: boolean; // was this team at home?
  gf: number; ga: number;
  gf1: number | null; ga1: number | null; // null when the source lacks HT data
  corners: number | null; cards: number | null;
}

export interface EngineContext {
  leagues: Map<string, League>;
  teams: Map<string, Team>;
  samplesByTeam: Map<string, Sample[]>; // sorted newest first
  histByLeague: Map<string, HistoricalMatch[]>;
}

export function buildContext(leagues: League[], teams: Team[], hist: HistoricalMatch[], cutoffISO: string): EngineContext {
  const cutoff = new Date(cutoffISO).getTime();
  const samplesByTeam = new Map<string, Sample[]>();
  const histByLeague = new Map<string, HistoricalMatch[]>();
  for (const h of hist) {
    if (new Date(h.date).getTime() >= cutoff) continue; // pre-match guard
    if (!histByLeague.has(h.leagueId)) histByLeague.set(h.leagueId, []);
    histByLeague.get(h.leagueId)!.push(h);
    const push = (teamId: string, home: boolean) => {
      if (!samplesByTeam.has(teamId)) samplesByTeam.set(teamId, []);
      samplesByTeam.get(teamId)!.push({
        date: h.date, home,
        gf: home ? h.hg : h.ag, ga: home ? h.ag : h.hg,
        gf1: home ? h.hg1 : h.ag1, ga1: home ? h.ag1 : h.hg1,
        corners: h.corners, cards: h.cards,
      });
    };
    push(h.homeId, true);
    push(h.awayId, false);
  }
  for (const arr of samplesByTeam.values()) arr.sort((a, b) => b.date.localeCompare(a.date));
  return {
    leagues: new Map(leagues.map((l) => [l.id, l])),
    teams: new Map(teams.map((t) => [t.id, t])),
    samplesByTeam, histByLeague,
  };
}

// Map a sample into a fixture-shaped stat line, with the sampled team placed
// in the given fixture slot (home or away).
function asLine(s: Sample, slot: "home" | "away") {
  return slot === "home"
    ? { hg: s.gf, ag: s.ga, hg1: s.gf1, ag1: s.ga1, corners: s.corners, cards: s.cards }
    : { hg: s.ga, ag: s.gf, hg1: s.ga1, ag1: s.gf1, corners: s.corners, cards: s.cards };
}

function freq(code: string, lines: StatLine[]): { rate: number | null; hits: number; total: number } {
  let hits = 0, total = 0;
  for (const l of lines) {
    const r = evalMarket(code, l);
    if (r === null) continue;
    total++;
    if (r) hits++;
  }
  return { rate: total >= 3 ? hits / total : null, hits, total };
}

function tier(p: number): ConfidenceTier {
  if (p >= 90) return "EXTREME";
  if (p >= 85) return "VERY_HIGH";
  if (p >= 80) return "HIGH";
  if (p >= 75) return "MODERATE_HIGH";
  if (p >= 70) return "MODERATE";
  return "LOW";
}

const MIN_TEAM_SAMPLE = 8;
const SHRINK_K = 12;

export interface OddsLookup { (fixtureId: string, marketCode: string): number | null }

export function predictFixture(
  fx: Fixture,
  ctx: EngineContext,
  generatedAt: string,
  oddsLookup?: OddsLookup
): MatchPrediction {
  const league = ctx.leagues.get(fx.leagueId)!;
  const homeS = ctx.samplesByTeam.get(fx.homeId) ?? [];
  const awayS = ctx.samplesByTeam.get(fx.awayId) ?? [];
  const kickoffTs = new Date(fx.kickoff).getTime();
  const lockedAt = Date.now() >= kickoffTs ? fx.kickoff : null;

  const empty: MatchPrediction = {
    fixtureId: fx.id, generatedAt, lockedAt,
    modelVersion: MODEL_VERSION,
    dataStatus: "LIVE", dataUpdatedAt: generatedAt, confidencePenalty: 0,
    markets: [], safest: [], underTheRadar: [], value: [], avoid: [], top3: [],
    headline: null, noStrongEdge: true, matchConfidence: 0,
  };

  // INSUFFICIENT DATA: never fake a confidence score from a thin sample.
  if (homeS.length < MIN_TEAM_SAMPLE || awayS.length < MIN_TEAM_SAMPLE) return empty;

  const leagueHist = ctx.histByLeague.get(fx.leagueId) ?? [];
  const leagueLines = leagueHist.map((h) => ({ hg: h.hg, ag: h.ag, hg1: h.hg1, ag1: h.ag1, corners: h.corners, cards: h.cards }));

  const homeAll = homeS.map((s) => asLine(s, "home"));
  const awayAll = awayS.map((s) => asLine(s, "away"));
  const homeL10 = homeS.slice(0, 10).map((s) => asLine(s, "home"));
  const awayL10 = awayS.slice(0, 10).map((s) => asLine(s, "away"));
  const homeL5 = homeS.slice(0, 5).map((s) => asLine(s, "home"));
  const awayL5 = awayS.slice(0, 5).map((s) => asLine(s, "away"));
  const homeAtHome = homeS.filter((s) => s.home).map((s) => asLine(s, "home"));
  const awayAtAway = awayS.filter((s) => !s.home).map((s) => asLine(s, "away"));

  const homeName = ctx.teams.get(fx.homeId)?.name ?? "Home";
  const awayName = ctx.teams.get(fx.awayId)?.name ?? "Away";

  const markets: MarketPrediction[] = [];

  for (const def of MARKETS) {
    if (def.group === "CORNERS" && !league.hasCornerData) continue;
    if (def.group === "CARDS" && !league.hasCardData) continue;

    const season = freq(def.code, [...homeAll, ...awayAll]);
    const last10 = freq(def.code, [...homeL10, ...awayL10]);
    const last5 = freq(def.code, [...homeL5, ...awayL5]);
    const homeAway = freq(def.code, [...homeAtHome, ...awayAtAway]);
    // Mirror/opponent view: home team's samples evaluated from the away slot &
    // vice-versa — captures how each side's opponents fare (conceding view).
    const opponent = freq(def.code, [
      ...homeS.map((s) => asLine(s, "away")),
      ...awayS.map((s) => asLine(s, "home")),
    ]);
    const leagueF = freq(def.code, leagueLines);

    if (season.total < 6 || leagueF.rate === null) continue; // not enough data for this market

    const comp: ComponentBreakdown = {
      season: season.rate, last10: last10.rate, last5: last5.rate,
      homeAway: homeAway.rate, opponent: opponent.rate, league: leagueF.rate,
    };

    const weights: [number | null, number][] = [
      [comp.season, 0.22], [comp.last10, 0.20], [comp.last5, 0.10],
      [comp.homeAway, 0.22], [comp.opponent, 0.16], [comp.league, 0.10],
    ];
    let wsum = 0, acc = 0;
    for (const [v, w] of weights) if (v !== null) { acc += v * w; wsum += w; }
    const raw = acc / wsum;

    // Shrink toward league baseline in proportion to effective sample size.
    const nEff = season.total + homeAway.total * 0.5;
    const shrunk = (raw * nEff + leagueF.rate * SHRINK_K) / (nEff + SHRINK_K);
    const probability = Math.round(Math.min(0.97, Math.max(0.03, shrunk)) * 1000) / 10;

    // Consistency across evidence components (low spread → high consistency).
    const vals = Object.values(comp).filter((v): v is number => v !== null);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    const consistency = Math.max(0, 1 - sd * 3.2);

    const sampleFactor = Math.min(1, nEff / 45);
    const recentAlign = last10.rate !== null ? Math.max(0, 1 - Math.abs(last10.rate - raw) * 2.4) : 0.5;
    const dq = league.dataQuality === "EXCELLENT" ? 1 : league.dataQuality === "GOOD" ? 0.85 : league.dataQuality === "FAIR" ? 0.65 : 0.4;

    const edgeScore = Math.round(
      (probability / 100) * 42 + sampleFactor * 18 + consistency * 18 + recentAlign * 12 + dq * 10
    );

    const dataStrength: MarketPrediction["dataStrength"] =
      nEff >= 35 && dq >= 0.85 ? "STRONG" : nEff >= 18 ? "MODERATE" : "WEAK";

    const flags: string[] = [];
    if (nEff < 18) flags.push("LOW_SAMPLE");

    const odds = oddsLookup ? oddsLookup(fx.id, def.code) : null;
    const valueEdge = odds !== null ? Math.round((probability - 100 / odds) * 10) / 10 : null;

    const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);
    const explanation: string[] = [
      `Combined season frequency: ${season.hits}/${season.total} matches (${pct(season.rate)}).`,
      last10.rate !== null ? `Recent form (both teams, last 10 each): ${last10.hits}/${last10.total} (${pct(last10.rate)}).` : `Recent-form sample too small to weight.`,
      homeAway.rate !== null ? `${homeName} at home + ${awayName} away: ${homeAway.hits}/${homeAway.total} (${pct(homeAway.rate)}).` : `Home/away split sample too small to weight.`,
      `League baseline (${league.name}): ${pct(leagueF.rate)} across ${leagueF.total} matches.`,
      `Shrunk toward league baseline with k=${SHRINK_K} on effective sample n≈${Math.round(nEff)}.`,
    ];

    markets.push({
      market: def, probability, rawProbability: Math.round(raw * 1000) / 10,
      confidenceTier: tier(probability), edgeScore,
      sampleSize: Math.round(nEff),
      recentHits: last10.hits, recentTotal: last10.total,
      seasonHits: season.hits, seasonTotal: season.total,
      leagueRate: Math.round((leagueF.rate ?? 0) * 1000) / 10,
      dataStrength, components: comp, explanation, flags,
      odds, valueEdge,
    });
  }

  markets.sort((a, b) => b.edgeScore - a.edgeScore);

  // ── categories ──
  const eligible = markets.filter((m) => m.probability >= 70 && m.dataStrength !== "WEAK");

  const diverse = (list: MarketPrediction[], n: number) => {
    const out: MarketPrediction[] = [];
    for (const m of list) {
      if (out.length >= n) break;
      if (out.some((o) => o.market.group === m.market.group)) continue;
      out.push(m);
    }
    return out;
  };

  const safest = diverse([...eligible].sort((a, b) => b.probability - a.probability || b.edgeScore - a.edgeScore), 3);

  const radarScore = (m: MarketPrediction) => (m.probability / 100) * (1 - m.market.obviousness) * (m.edgeScore / 100);
  const underTheRadar = diverse(
    [...eligible].filter((m) => m.market.obviousness <= 0.5).sort((a, b) => radarScore(b) - radarScore(a)),
    4
  );

  const value = eligible
    .filter((m) => m.odds !== null && m.valueEdge !== null && m.valueEdge >= 4 && m.probability >= 65)
    .sort((a, b) => (b.valueEdge ?? 0) - (a.valueEdge ?? 0))
    .slice(0, 3);

  // AVOID: popular-looking markets with weak statistical support.
  const avoid = markets
    .filter((m) => m.market.obviousness >= 0.55 && m.probability < 55 && m.probability > 30)
    .sort((a, b) => a.probability - b.probability)
    .slice(0, 3)
    .map((m) => ({
      market: m.market,
      probability: m.probability,
      reason: `Only ${m.seasonHits}/${m.seasonTotal} (${Math.round((m.seasonHits / Math.max(1, m.seasonTotal)) * 100)}%) of comparable matches produced this outcome. Model probability ${m.probability}% is below the recommendation floor.`,
    }));

  // TOP 3 by Edge Score, correlation-aware (never two markets from one cluster).
  const top3: MarketPrediction[] = [];
  for (const m of eligible.filter((x) => x.probability >= 75)) {
    if (top3.length >= 3) break;
    if (top3.some((o) => areCorrelated(o.market.code, m.market.code))) continue;
    top3.push(m);
  }
  if (top3[0]) top3[0].flags = [...new Set([...top3[0].flags, "TOP_EDGE"])];

  const headline = top3[0] ?? null;
  const noStrongEdge = headline === null;

  return {
    fixtureId: fx.id, generatedAt, lockedAt,
    modelVersion: MODEL_VERSION,
    dataStatus: "LIVE", dataUpdatedAt: generatedAt, confidencePenalty: 0,
    markets, safest, underTheRadar, value, avoid, top3,
    headline, noStrongEdge,
    matchConfidence: headline ? headline.probability : 0,
  };
}
