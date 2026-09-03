import { queryFixtures, EnrichedFixture, FixtureFilterOptions } from "./repository";
import { marketByCode } from "./markets";
import { displayTz } from "./time";
import { AppData } from "./service";

/**
 * 2.00 ODDS BANKER ENGINE
 * -----------------------
 * Builds a small, high-confidence accumulator whose combined decimal odds land
 * on (or just above) a target — 2.00 by default — using **exactly two market
 * families**:
 *
 *   · `O1.5`     — Over 1.5 Total Goals
 *   · `2H_O0.5`  — 2nd Half Over 0.5 Goals
 *
 * Nothing else is ever eligible. If a fixture has no qualifying pick in one of
 * those two markets it is simply not offered; the slip is returned short rather
 * than padded with a weaker or off-whitelist selection.
 *
 * ANTI-CORRELATION RULES (hard constraints, enforced while building)
 *   1. Never two legs from the same fixture — same-match outcomes are the most
 *      strongly correlated thing in an accumulator.
 *   2. Never two legs involving a shared team — a team's scoring environment
 *      drives both of its fixtures in the same direction.
 *   3. Legs sharing a league are allowed but flagged: a league-wide environment
 *      shift would move them together.
 *
 * ODDS PROVENANCE
 *   A leg uses the bookmaker price when the provider supplies one
 *   (`oddsSource: "FEED"`). With no odds feed, the leg is priced at its
 *   model-derived *fair* odds (100 ÷ probability) and labelled `"MODEL"` — the
 *   engine never presents a derived number as a bookmaker price.
 */

export const BANKER_MARKET_CODES = ["O1.5", "2H_O0.5"] as const;
export type BankerMarketCode = (typeof BANKER_MARKET_CODES)[number];

export const BANKER_MARKET_LABELS: Record<BankerMarketCode, string> = {
  "O1.5": "Over 1.5 Goals",
  "2H_O0.5": "2nd Half Over 0.5 Goals",
};

export const DEFAULT_TARGET_ODDS = 2.0;
export const DEFAULT_MIN_PROBABILITY = 78;
export const DEFAULT_MAX_LEGS = 6;

export type BankerOddsSource = "FEED" | "MODEL" | "MIXED" | "NONE";

export interface BankerOptions {
  /** Combined decimal odds to reach. Default 2.00. */
  targetOdds?: number;
  /** Per-leg probability floor. Default 78%. */
  minProbability?: number;
  /** Hard cap on legs. Default 6. */
  maxLegs?: number;
  /** Forward window: 1, 3 or 7 calendar days. Default 3. */
  horizonDays?: 1 | 3 | 7;
  leagueId?: string;
  tier?: number;
  timezone?: string;
  /** Injectable clock (epoch ms). */
  now?: number;
}

export interface BankerLeg {
  fixtureId: string;
  match: string;
  homeTeamId: string;
  awayTeamId: string;
  leagueId: string;
  leagueName: string;
  kickoffUtc: string;
  marketCode: BankerMarketCode;
  marketLabel: string;
  probability: number;
  edgeScore: number;
  confidenceTier: string;
  odds: number;
  oddsSource: "FEED" | "MODEL";
  sampleSize: number;
  seasonHits: number;
  seasonTotal: number;
  leagueRate: number;
  dataStrength: "STRONG" | "MODERATE" | "WEAK";
}

export interface BankerSlip {
  legs: BankerLeg[];
  /** Product of leg odds, 2dp. `null` when the slip is empty. */
  combinedOdds: number | null;
  /** Product of leg probabilities, 1dp. `null` when the slip is empty. */
  combinedProbability: number | null;
  /** 1 ÷ combinedOdds, as a percentage — the market's own view. */
  impliedProbability: number | null;
  targetOdds: number;
  targetReached: boolean;
  marketWhitelist: readonly BankerMarketCode[];
  oddsSource: BankerOddsSource;
  candidateCount: number;
  status: "READY" | "SHORT" | "EMPTY";
  warnings: string[];
  timezone: string;
  mode: AppData["mode"];
  providerId: string;
  generatedAt: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Fair decimal odds implied by a probability, e.g. 84% → 1.19. */
export function fairOddsFromProbability(probability: number): number {
  if (probability <= 0) return 0;
  return round2(100 / probability);
}

export interface BankerCandidate extends BankerLeg {
  /** Kept so the builder can rank without re-deriving. */
  rankScore: number;
}

/**
 * Pull every eligible leg out of the app snapshot.
 *
 * Only UPCOMING fixtures are considered: a locked, in-play or finished match
 * must never be offered as a pre-match banker pick.
 */
export function collectBankerCandidates(
  data: AppData,
  options: BankerOptions = {},
): BankerCandidate[] {
  const {
    minProbability = DEFAULT_MIN_PROBABILITY,
    horizonDays = 3,
    leagueId,
    tier = 0,
    timezone = displayTz(),
    now = Date.now(),
  } = options;

  const queryOptions: FixtureFilterOptions = {
    range: horizonDays <= 3 ? "3d" : "7d",
    status: "UPCOMING",
    leagueId,
    tier,
    timezone,
    now,
    withPrediction: true,
  };

  const fixtures: EnrichedFixture[] = queryFixtures(data, queryOptions);
  const out: BankerCandidate[] = [];

  for (const item of fixtures) {
    const pred = item.prediction;
    if (!pred || pred.noStrongEdge) continue;

    for (const code of BANKER_MARKET_CODES) {
      const m = pred.markets.find((x) => x.market.code === code);
      if (!m) continue;                                  // market not modelled for this fixture
      if (m.probability < minProbability) continue;      // below the confidence floor
      if (m.dataStrength === "WEAK") continue;           // thin sample — not a banker
      if (m.sampleSize < 12) continue;                   // explicit sample floor
      const def = marketByCode.get(code);
      if (!def) continue;

      const feedOdds = m.odds;
      const odds = feedOdds !== null && feedOdds > 1 ? feedOdds : fairOddsFromProbability(m.probability);
      const oddsSource: "FEED" | "MODEL" = feedOdds !== null && feedOdds > 1 ? "FEED" : "MODEL";

      out.push({
        fixtureId: item.fixture.id,
        match: `${item.homeTeam.name} v ${item.awayTeam.name}`,
        homeTeamId: item.homeTeam.id,
        awayTeamId: item.awayTeam.id,
        leagueId: item.league.id,
        leagueName: item.league.name,
        kickoffUtc: item.kickoffIso,
        marketCode: code,
        marketLabel: BANKER_MARKET_LABELS[code],
        probability: m.probability,
        edgeScore: m.edgeScore,
        confidenceTier: m.confidenceTier,
        odds: round2(odds),
        oddsSource,
        sampleSize: m.sampleSize,
        seasonHits: m.seasonHits,
        seasonTotal: m.seasonTotal,
        leagueRate: m.leagueRate,
        dataStrength: m.dataStrength,
        // Highest probability first; ties broken by edge score then by kickoff
        // so the slip is deterministic for a given snapshot.
        rankScore: m.probability * 1000 + m.edgeScore - item.kickoffTime / 1e11,
      });
    }
  }

  out.sort((a, b) => b.rankScore - a.rankScore);
  return out;
}

export interface ConstraintViolation {
  rule: "SAME_FIXTURE" | "OVERLAPPING_TEAMS" | "OFF_WHITELIST";
  a: string;
  b: string;
  detail: string;
}

/**
 * Verify a leg set against the anti-correlation and whitelist rules.
 * Returns an empty array when the slip is clean. Used by the builder, the API
 * route and the unit tests.
 */
export function validateBankerLegs(legs: Pick<BankerLeg, "fixtureId" | "homeTeamId" | "awayTeamId" | "marketCode" | "match">[]): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const whitelist = new Set<string>(BANKER_MARKET_CODES);

  for (const leg of legs) {
    if (!whitelist.has(leg.marketCode)) {
      violations.push({
        rule: "OFF_WHITELIST", a: leg.fixtureId, b: leg.marketCode,
        detail: `${leg.marketCode} is not in the banker whitelist (${BANKER_MARKET_CODES.join(", ")}).`,
      });
    }
  }

  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i], b = legs[j];
      if (a.fixtureId === b.fixtureId) {
        violations.push({
          rule: "SAME_FIXTURE", a: a.fixtureId, b: b.fixtureId,
          detail: `Two selections from ${a.match}.`,
        });
        continue;
      }
      const shared = [a.homeTeamId, a.awayTeamId].filter((t) => t === b.homeTeamId || t === b.awayTeamId);
      if (shared.length > 0) {
        violations.push({
          rule: "OVERLAPPING_TEAMS", a: a.fixtureId, b: b.fixtureId,
          detail: `${a.match} and ${b.match} share a team (${shared.join(", ")}).`,
        });
      }
    }
  }
  return violations;
}

/**
 * Greedily assemble the slip.
 *
 * Picks are taken in confidence order and rejected the moment they would
 * breach an anti-correlation rule. Accumulation stops as soon as the combined
 * odds reach the target, so the slip is the smallest set that gets there —
 * every extra leg is extra variance for no extra return.
 */
export function buildBankerSlip(
  candidates: BankerCandidate[],
  options: BankerOptions & { mode?: AppData["mode"]; providerId?: string } = {},
): BankerSlip {
  const {
    targetOdds = DEFAULT_TARGET_ODDS,
    maxLegs = DEFAULT_MAX_LEGS,
    timezone = displayTz(),
    mode = "DEMO",
    providerId = "unknown",
    now = Date.now(),
  } = options;

  const warnings: string[] = [];
  const legs: BankerLeg[] = [];
  const usedFixtures = new Set<string>();
  const usedTeams = new Set<string>();
  let combined = 1;

  for (const c of candidates) {
    if (legs.length >= maxLegs) break;
    if (combined >= targetOdds) break;
    if (usedFixtures.has(c.fixtureId)) continue;                       // rule 1
    if (usedTeams.has(c.homeTeamId) || usedTeams.has(c.awayTeamId)) continue; // rule 2

    const { rankScore, ...leg } = c;
    void rankScore;
    legs.push(leg);
    usedFixtures.add(c.fixtureId);
    usedTeams.add(c.homeTeamId);
    usedTeams.add(c.awayTeamId);
    combined *= c.odds;
  }

  const combinedOdds = legs.length ? round2(combined) : null;
  const combinedProbability = legs.length
    ? round1(legs.reduce((acc, l) => acc * (l.probability / 100), 1) * 100)
    : null;
  const targetReached = combinedOdds !== null && combinedOdds >= targetOdds;

  const sources = new Set(legs.map((l) => l.oddsSource));
  const oddsSource: BankerOddsSource =
    legs.length === 0 ? "NONE" : sources.size > 1 ? "MIXED" : (legs[0].oddsSource as BankerOddsSource);

  // ── warnings ─────────────────────────────────────────────────────────────
  if (oddsSource === "MODEL" || oddsSource === "MIXED") {
    warnings.push(
      "No bookmaker odds feed is configured for at least one leg: its price is a MODEL-DERIVED FAIR ODDS figure (100 ÷ probability), not a bookmaker quote.",
    );
  }
  if (!targetReached) {
    warnings.push(
      legs.length === 0
        ? `No leg cleared the ${options.minProbability ?? DEFAULT_MIN_PROBABILITY}% floor in the selected window — nothing was substituted.`
        : `Combined odds ${combinedOdds?.toFixed(2)} fell short of the ${targetOdds.toFixed(2)} target with ${legs.length} eligible leg(s). The slip was NOT padded with weaker or off-whitelist picks.`,
    );
  }

  const perLeague = new Map<string, number>();
  for (const l of legs) perLeague.set(l.leagueId, (perLeague.get(l.leagueId) ?? 0) + 1);
  for (const [leagueId, n] of perLeague) {
    if (n > 1) {
      const name = legs.find((l) => l.leagueId === leagueId)?.leagueName ?? leagueId;
      warnings.push(`⚠ ${n} legs share the ${name} league environment — treat the combined figure as an upper bound.`);
    }
  }

  const violations = validateBankerLegs(legs);
  if (violations.length) {
    // Should be unreachable; surfaced rather than swallowed if the builder
    // logic ever regresses.
    warnings.push(`⚠ INTERNAL: ${violations.length} anti-correlation violation(s) detected: ${violations[0].detail}`);
  }

  if (mode === "DEMO") {
    warnings.push("DEMO DATA: this slip is generated from the synthetic demo dataset, not live football data.");
  }

  return {
    legs,
    combinedOdds,
    combinedProbability,
    impliedProbability: combinedOdds !== null && combinedOdds > 0 ? round1((1 / combinedOdds) * 100) : null,
    targetOdds,
    targetReached,
    marketWhitelist: BANKER_MARKET_CODES,
    oddsSource,
    candidateCount: candidates.length,
    status: legs.length === 0 ? "EMPTY" : targetReached ? "READY" : "SHORT",
    warnings,
    timezone,
    mode,
    providerId,
    generatedAt: new Date(now).toISOString(),
  };
}

/** One-shot helper used by the page and the API route. */
export function getBankerSlip(data: AppData, options: BankerOptions = {}): BankerSlip {
  const candidates = collectBankerCandidates(data, options);
  return buildBankerSlip(candidates, {
    ...options,
    mode: data.mode,
    providerId: data.providerId,
  });
}
