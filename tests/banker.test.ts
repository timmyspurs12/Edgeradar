import { describe, expect, it } from "vitest";
import {
  BANKER_MARKET_CODES, DEFAULT_TARGET_ODDS, buildBankerSlip, collectBankerCandidates,
  fairOddsFromProbability, getBankerSlip, validateBankerLegs,
} from "@/lib/banker";
import { marketByCode } from "@/lib/markets";
import type { MarketPrediction } from "@/lib/types";
import type { AppData } from "@/lib/service";
import { NOW, makeAppData, makeFixture, makePrediction, makeTeam } from "./helpers";

function mkMarket(code: string, probability: number, over: Partial<MarketPrediction> = {}): MarketPrediction {
  const market = marketByCode.get(code);
  if (!market) throw new Error(`unknown market ${code}`);
  return {
    market, probability, rawProbability: probability,
    confidenceTier: "HIGH", edgeScore: Math.round(probability * 0.9),
    sampleSize: 40, recentHits: 8, recentTotal: 10,
    seasonHits: Math.round(probability * 0.4), seasonTotal: 40, leagueRate: probability - 4,
    dataStrength: "STRONG",
    components: { season: 0.8, last10: 0.8, last5: 0.8, homeAway: 0.8, opponent: 0.8, league: 0.8 },
    explanation: [], flags: [], odds: null, valueEdge: null,
    ...over,
  } as MarketPrediction;
}

interface Spec { id: string; home: string; away: string; markets: MarketPrediction[]; status?: "UPCOMING" | "LIVE" | "FINISHED"; kickoff?: string }

/**
 * Six upcoming matches across three days of the WAT window:
 *   f1  h1 v a1   O1.5 86 · 2H_O0.5 84 · BTTS_Y 99 (off-whitelist, must be ignored)
 *   f2  h2 v a2   O1.5 85 @1.30 (feed odds) · 2H_O0.5 80
 *   f3  h1 v a2   O1.5 90 — shares h1 with f1 and a2 with f2
 *   f4  h3 v a3   O1.5 60 — below the probability floor
 *   f5  h4 v a4   O1.5 84
 *   f6  h5 v a5   O1.5 83
 * Plus a live and a finished match that must never be offered.
 */
function dataset(specs: Spec[]): AppData {
  const teamIds = [...new Set(specs.flatMap((s) => [s.home, s.away]))];
  const fixtures = specs.map((s) => makeFixture({
    id: s.id, homeId: s.home, awayId: s.away,
    kickoff: s.kickoff ?? "2026-09-03T18:00:00.000Z",
    status: s.status ?? "UPCOMING",
  }));
  const predictions = new Map(specs.map((s) => [
    s.id,
    makePrediction(s.id, { markets: s.markets, matchConfidence: Math.max(...s.markets.map((m) => m.probability)) }),
  ]));
  return makeAppData({
    teams: teamIds.map((id) => makeTeam(id)),
    fixtures,
    predictions,
  });
}

const base: Spec[] = [
  { id: "f1", home: "h1", away: "a1", markets: [mkMarket("O1.5", 86), mkMarket("2H_O0.5", 84), mkMarket("BTTS_Y", 99)] },
  { id: "f2", home: "h2", away: "a2", markets: [mkMarket("O1.5", 85, { odds: 1.3 }), mkMarket("2H_O0.5", 80)] },
  { id: "f3", home: "h1", away: "a2", markets: [mkMarket("O1.5", 90)] },
  { id: "f4", home: "h3", away: "a3", markets: [mkMarket("O1.5", 60)] },
  { id: "f5", home: "h4", away: "a4", markets: [mkMarket("O1.5", 84)] },
  { id: "f6", home: "h5", away: "a5", markets: [mkMarket("O1.5", 83)] },
];

describe("market whitelist", () => {
  it("only ever offers Over 1.5 Goals and 2nd Half Over 0.5 Goals", () => {
    expect([...BANKER_MARKET_CODES]).toEqual(["O1.5", "2H_O0.5"]);
    const legs = collectBankerCandidates(dataset(base), { now: NOW });
    expect(legs.length).toBeGreaterThan(0);
    for (const leg of legs) expect(BANKER_MARKET_CODES).toContain(leg.marketCode);
  });

  it("ignores a 99% off-whitelist market", () => {
    const legs = collectBankerCandidates(dataset(base), { now: NOW });
    const codes = legs.map((l) => l.marketCode as string);
    expect(codes).not.toContain("BTTS_Y");
    expect(legs.some((l) => l.fixtureId === "f1" && (l.marketCode as string) === "BTTS_Y")).toBe(false);
  });

  it("rejects an off-whitelist leg injected by hand", () => {
    const violations = validateBankerLegs([
      { fixtureId: "x", homeTeamId: "h", awayTeamId: "a", marketCode: "BTTS_Y" as never, match: "H v A" },
    ]);
    expect(violations.map((v) => v.rule)).toEqual(["OFF_WHITELIST"]);
  });
});

describe("anti-correlation rules", () => {
  it("never takes two selections from the same fixture", () => {
    const legs = collectBankerCandidates(dataset(base), { now: NOW });
    const slip = buildBankerSlip(legs, { targetOdds: 99, maxLegs: 6, now: NOW }); // force it to take everything legal
    const fixtureIds = slip.legs.map((l) => l.fixtureId);
    expect(new Set(fixtureIds).size).toBe(fixtureIds.length);
  });

  it("never takes two selections involving a shared team", () => {
    const legs = collectBankerCandidates(dataset(base), { targetOdds: 99, maxLegs: 6, now: NOW });
    const slip = buildBankerSlip(legs, { targetOdds: 99, maxLegs: 6, now: NOW });
    const teams = slip.legs.flatMap((l) => [l.homeTeamId, l.awayTeamId]);
    expect(new Set(teams).size).toBe(teams.length);
    // f3 (h1 v a2) collides with both f1 (h1) and f2 (a2), so only the highest
    // confidence of that triangle survives.
    expect(slip.legs.filter((l) => ["f1", "f2", "f3"].includes(l.fixtureId))).toHaveLength(1);
  });

  it("validateBankerLegs flags a same-fixture pair", () => {
    const v = validateBankerLegs([
      { fixtureId: "f1", homeTeamId: "h1", awayTeamId: "a1", marketCode: "O1.5", match: "A" },
      { fixtureId: "f1", homeTeamId: "h1", awayTeamId: "a1", marketCode: "2H_O0.5", match: "A" },
    ]);
    expect(v.map((x) => x.rule)).toEqual(["SAME_FIXTURE"]);
  });

  it("validateBankerLegs flags an overlapping-team pair", () => {
    const v = validateBankerLegs([
      { fixtureId: "f1", homeTeamId: "h1", awayTeamId: "a1", marketCode: "O1.5", match: "A v B" },
      { fixtureId: "f2", homeTeamId: "h1", awayTeamId: "a9", marketCode: "O1.5", match: "A v C" },
    ]);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe("OVERLAPPING_TEAMS");
  });

  it("returns no violations for a clean slip", () => {
    const legs = collectBankerCandidates(dataset(base), { now: NOW });
    const slip = buildBankerSlip(legs, { targetOdds: 99, maxLegs: 6, now: NOW });
    expect(validateBankerLegs(slip.legs)).toEqual([]);
  });
});

/**
 * Five matches with completely disjoint squads, so the anti-correlation rules
 * never bite and the odds target is genuinely reachable:
 *   1.11 × 1.14 × 1.16 × 1.19 × 1.20 = 2.10
 */
const disjoint: Spec[] = [
  { id: "d1", home: "p1", away: "q1", markets: [mkMarket("O1.5", 90)] },
  { id: "d2", home: "p2", away: "q2", markets: [mkMarket("O1.5", 88)] },
  { id: "d3", home: "p3", away: "q3", markets: [mkMarket("O1.5", 86)] },
  { id: "d4", home: "p4", away: "q4", markets: [mkMarket("O1.5", 84)] },
  { id: "d5", home: "p5", away: "q5", markets: [mkMarket("O1.5", 83)] },
];

describe("odds target", () => {
  it("stops as soon as the combined odds reach the target", () => {
    const slip = getBankerSlip(dataset(disjoint), { targetOdds: DEFAULT_TARGET_ODDS, now: NOW });
    expect(slip.status).toBe("READY");
    expect(slip.targetReached).toBe(true);
    expect(slip.combinedOdds).toBeGreaterThanOrEqual(2.0);
    // It must not keep adding legs past the target — the slip is the smallest
    // set that gets there.
    const withoutLast = slip.legs.slice(0, -1).reduce((a, l) => a * l.odds, 1);
    expect(withoutLast).toBeLessThan(2.0);
    expect(slip.legs).toHaveLength(5);
  });

  it("needs more legs when the target is higher", () => {
    const small = getBankerSlip(dataset(disjoint), { targetOdds: 1.2, now: NOW });
    const large = getBankerSlip(dataset(disjoint), { targetOdds: 2.0, now: NOW });
    expect(small.legs.length).toBeLessThan(large.legs.length);
  });

  it("combines leg probabilities and implied probability correctly", () => {
    const slip = getBankerSlip(dataset(base), { targetOdds: 2.0, now: NOW });
    const prob = slip.legs.reduce((a, l) => a * (l.probability / 100), 1) * 100;
    expect(slip.combinedProbability).toBeCloseTo(prob, 1);
    expect(slip.impliedProbability).toBeCloseTo((1 / slip.combinedOdds!) * 100, 1);
  });

  it("returns SHORT — never a padded slip — when the target is unreachable", () => {
    const slip = getBankerSlip(dataset([base[0], base[4]]), { targetOdds: 5, minProbability: 78, now: NOW });
    expect(slip.status).toBe("SHORT");
    expect(slip.targetReached).toBe(false);
    expect(slip.combinedOdds).toBeLessThan(5);
    expect(slip.warnings.join(" ")).toMatch(/NOT padded/);
    // Every leg still clears the floor.
    expect(slip.legs.every((l) => l.probability >= 78)).toBe(true);
  });

  it("returns EMPTY when nothing clears the floor", () => {
    const slip = getBankerSlip(dataset([base[3]]), { minProbability: 78, now: NOW });
    expect(slip.status).toBe("EMPTY");
    expect(slip.legs).toEqual([]);
    expect(slip.combinedOdds).toBeNull();
    expect(slip.combinedProbability).toBeNull();
    expect(slip.impliedProbability).toBeNull();
  });

  it("respects maxLegs even when more would fit", () => {
    const slip = getBankerSlip(dataset(base), { targetOdds: 99, maxLegs: 2, now: NOW });
    expect(slip.legs).toHaveLength(2);
  });

  it("raises the floor when minProbability is raised", () => {
    const slip = getBankerSlip(dataset(base), { minProbability: 86, targetOdds: 99, maxLegs: 6, now: NOW });
    expect(slip.legs.every((l) => l.probability >= 86)).toBe(true);
  });
});

describe("eligibility filters", () => {
  it("excludes fixtures that have already kicked off", () => {
    const specs: Spec[] = [
      { ...base[0], status: "LIVE", kickoff: "2026-09-03T09:00:00.000Z" },
      { ...base[1], status: "FINISHED", kickoff: "2026-09-03T08:00:00.000Z" },
    ];
    expect(collectBankerCandidates(dataset(specs), { now: NOW })).toEqual([]);
  });

  it("excludes thin samples and weak data strength", () => {
    const specs: Spec[] = [
      { id: "thin", home: "h9", away: "a9", markets: [mkMarket("O1.5", 90, { sampleSize: 8 })] },
      { id: "weak", home: "h8", away: "a8", markets: [mkMarket("O1.5", 90, { dataStrength: "WEAK" })] },
    ];
    expect(collectBankerCandidates(dataset(specs), { now: NOW })).toEqual([]);
  });

  it("excludes fixtures outside the requested horizon", () => {
    const specs: Spec[] = [
      { id: "far", home: "h7", away: "a7", kickoff: "2026-09-20T18:00:00.000Z", markets: [mkMarket("O1.5", 90)] },
    ];
    expect(collectBankerCandidates(dataset(specs), { horizonDays: 3, now: NOW })).toEqual([]);
    expect(collectBankerCandidates(dataset(specs), { horizonDays: 7, now: NOW })).toEqual([]);
  });

  it("can be restricted to a league or tier", () => {
    const legs = collectBankerCandidates(dataset(base), { leagueId: "nope", now: NOW });
    expect(legs).toEqual([]);
    expect(collectBankerCandidates(dataset(base), { tier: 2, now: NOW })).toEqual([]);
    expect(collectBankerCandidates(dataset(base), { tier: 1, now: NOW }).length).toBeGreaterThan(0);
  });
});

describe("odds provenance", () => {
  it("uses the bookmaker price when the provider supplies one", () => {
    const legs = collectBankerCandidates(dataset(base), { now: NOW });
    const fed = legs.find((l) => l.fixtureId === "f2" && l.marketCode === "O1.5")!;
    expect(fed.odds).toBe(1.3);
    expect(fed.oddsSource).toBe("FEED");
  });

  it("falls back to clearly labeled model-derived fair odds", () => {
    const legs = collectBankerCandidates(dataset(base), { now: NOW });
    const derived = legs.find((l) => l.fixtureId === "f1" && l.marketCode === "O1.5")!;
    expect(derived.oddsSource).toBe("MODEL");
    expect(derived.odds).toBe(fairOddsFromProbability(86));
    const slip = getBankerSlip(dataset(base), { now: NOW });
    expect(slip.oddsSource === "MIXED" || slip.oddsSource === "MODEL").toBe(true);
    expect(slip.warnings.join(" ")).toMatch(/MODEL-DERIVED FAIR ODDS/);
  });

  it("computes fair odds from probability", () => {
    expect(fairOddsFromProbability(84)).toBe(1.19);
    expect(fairOddsFromProbability(50)).toBe(2);
    expect(fairOddsFromProbability(0)).toBe(0);
  });
});

describe("slip metadata", () => {
  it("carries the mode and provider through for labelling", () => {
    const slip = getBankerSlip(dataset(base), { now: NOW });
    expect(slip.mode).toBe("DEMO");
    expect(slip.providerId).toBe("demo");
    expect(slip.marketWhitelist).toEqual(BANKER_MARKET_CODES);
    expect(slip.warnings.join(" ")).toMatch(/DEMO DATA/);
    expect(slip.generatedAt).toBe(new Date(NOW).toISOString());
  });

  it("warns when several legs share a league environment", () => {
    const slip = getBankerSlip(dataset(base), { targetOdds: 99, maxLegs: 6, now: NOW });
    expect(slip.legs.length).toBeGreaterThan(1);
    expect(slip.warnings.join(" ")).toMatch(/league environment/);
  });

  it("ranks candidates by probability", () => {
    const legs = collectBankerCandidates(dataset(base), { now: NOW });
    const probs = legs.map((l) => l.probability);
    expect(probs).toEqual([...probs].sort((a, b) => b - a));
  });
});
