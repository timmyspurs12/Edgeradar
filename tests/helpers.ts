import type { AppData } from "@/lib/service";
import { buildContext } from "@/lib/engine";
import type {
  Fixture, FixtureStatus, HistoricalMatch, League, MatchPrediction, Team,
} from "@/lib/types";
import type { DataSourceMeta, FootballDataProvider, ProviderId } from "@/lib/providers/types";
import { marketByCode } from "@/lib/markets";

/** Deterministic clock: 2026-09-03T12:00:00Z === 13:00 WAT (Africa/Lagos). */
export const NOW = Date.parse("2026-09-03T12:00:00.000Z");

/** Start of the 2026-09-03 WAT day, in UTC. */
export const WAT_DAY_START_UTC = Date.parse("2026-09-02T23:00:00.000Z");
export const WAT_DAY_END_UTC = Date.parse("2026-09-03T23:00:00.000Z");

export function makeLeague(over: Partial<League> & { id: string }): League {
  return {
    name: `League ${over.id}`, country: "Nigeria", tier: 1,
    broadcastStatus: "BROADCAST_VERIFIED", broadcastEvidence: "test",
    officialSite: "—", dataQuality: "EXCELLENT", historicalMatchCount: 40,
    seasonStatus: "2026", hasCornerData: true, hasCardData: true,
    hasOddsFeed: false, avgGoals: 2.7,
    ...over,
  } as League;
}

export function makeTeam(id: string, leagueId = "lg1", over: Partial<Team> = {}): Team {
  return { id, leagueId, name: `Team ${id.toUpperCase()}`, short: id.slice(0, 3).toUpperCase(), attack: 1, defense: 1, ...over };
}

export function makeFixture(over: Partial<Fixture> & { id: string }): Fixture {
  return {
    leagueId: "lg1", homeId: "h1", awayId: "a1",
    kickoff: "2026-09-03T18:00:00.000Z",
    status: "UPCOMING" as FixtureStatus,
    lineupStatus: "NOT_ANNOUNCED", injuryInfo: null,
    ...over,
  } as Fixture;
}

export function makePrediction(fixtureId: string, over: Partial<MatchPrediction> = {}): MatchPrediction {
  const headline = marketByCode.get("O1.5")!;
  const headlinePrediction = {
    market: headline, probability: 84, rawProbability: 84, confidenceTier: "HIGH" as const,
    edgeScore: 80, sampleSize: 40, recentHits: 8, recentTotal: 10,
    seasonHits: 33, seasonTotal: 40, leagueRate: 78, dataStrength: "STRONG" as const,
    components: { season: 0.84, last10: 0.8, last5: 0.8, homeAway: 0.85, opponent: 0.8, league: 0.78 },
    explanation: [], flags: [], odds: null, valueEdge: null,
  };
  return {
    fixtureId,
    generatedAt: "2026-09-03T07:00:00.000Z",
    lockedAt: null,
    modelVersion: "EdgeRadar v1.0 (test)",
    dataStatus: "LIVE",
    dataUpdatedAt: "2026-09-03T07:00:00.000Z",
    confidencePenalty: 0,
    markets: [headlinePrediction],
    safest: [], underTheRadar: [], value: [], avoid: [], top3: [headlinePrediction],
    headline: headlinePrediction,
    noStrongEdge: false,
    matchConfidence: 84,
    ...over,
  };
}

export function makeAppData(parts: {
  leagues?: League[];
  teams?: Team[];
  fixtures?: Fixture[];
  predictions?: Map<string, MatchPrediction>;
  historical?: HistoricalMatch[];
  mode?: AppData["mode"];
  providerId?: string;
}): AppData {
  const leagues = parts.leagues ?? [makeLeague({ id: "lg1" })];
  const teams = parts.teams ?? [makeTeam("h1"), makeTeam("a1")];
  const fixtures = parts.fixtures ?? [];
  const historical = parts.historical ?? [];
  return {
    mode: parts.mode ?? "DEMO",
    providerId: parts.providerId ?? "demo",
    builtAt: new Date(NOW).toISOString(),
    leagues,
    teams,
    fixtures,
    ctx: buildContext(leagues, teams, historical, new Date(NOW).toISOString()),
    predictions: parts.predictions ?? new Map(),
    resolved: [],
    radar: [],
  };
}

/** A provider double — every method overridable, safe defaults otherwise. */
export function fakeProvider(over: Partial<FootballDataProvider> & { id: ProviderId }): FootballDataProvider {
  const empty: DataSourceMeta[] = [];
  return {
    name: `Fake ${over.id}`,
    mode: "LIVE",
    getLeagues: async () => [makeLeague({ id: "lg1" })],
    getTeams: async () => [makeTeam("h1"), makeTeam("a1"), makeTeam("h2"), makeTeam("a2")],
    getFixtures: async () => [
      makeFixture({ id: "f1", homeId: "h1", awayId: "a1", kickoff: "2026-09-03T18:00:00.000Z" }),
    ],
    getHistoricalMatches: async () => [],
    getInjuryNote: async () => null,
    getOdds: async () => null,
    getBroadcastEvidence: async () => null,
    getSources: async () => empty,
    ...over,
  } as FootballDataProvider;
}
