import { AppData, getAppData, tryGetAppData } from "./service";
import { Fixture, League, MatchPrediction, Team } from "./types";
import { dayKeyInTz, APP_TZ } from "./format";

export interface FixtureFilterOptions {
  range?: "today" | "tomorrow" | "3d" | "7d" | "all" | "finished";
  leagueId?: string;
  tier?: number;
  status?: "UPCOMING" | "LIVE" | "FINISHED" | "ALL";
  minConfidence?: number;
  cast?: "all" | "verified";
  searchQuery?: string;
  timezone?: string;
}

export interface EnrichedFixture {
  fixture: Fixture;
  homeTeam: Team;
  awayTeam: Team;
  league: League;
  prediction: MatchPrediction | null;
  isLocked: boolean;
  kickoffTime: number;
  kickoffIso: string;
  dayKey: string;
}

export function queryFixtures(data: AppData, options: FixtureFilterOptions = {}): EnrichedFixture[] {
  const {
    range = "all",
    leagueId,
    tier = 0,
    status,
    minConfidence = 0,
    cast = "all",
    searchQuery = "",
    timezone = APP_TZ,
  } = options;

  const now = Date.now();
  const todayKey = dayKeyInTz(new Date());
  const tomorrowKey = dayKeyInTz(new Date(now + 86400000));
  const q = searchQuery.toLowerCase().trim();

  const teamsMap = new Map<string, Team>();
  for (const t of data.teams) teamsMap.set(t.id, t);

  const leaguesMap = new Map<string, League>();
  for (const l of data.leagues) leaguesMap.set(l.id, l);

  const enriched: EnrichedFixture[] = [];

  for (const f of data.fixtures) {
    const homeTeam = teamsMap.get(f.homeId);
    const awayTeam = teamsMap.get(f.awayId);
    const league = leaguesMap.get(f.leagueId);

    if (!homeTeam || !awayTeam || !league) continue;

    const koTime = new Date(f.kickoff).getTime();
    const fixtureDayKey = dayKeyInTz(f.kickoff);
    const pred = data.predictions.get(f.id) ?? null;
    const isLocked = pred ? pred.lockedAt !== null || koTime <= now : koTime <= now;

    if (status && status !== "ALL") {
      if (f.status !== status) continue;
    }

    if (range === "finished") {
      if (f.status !== "FINISHED") continue;
    } else if (range === "today") {
      if (fixtureDayKey !== todayKey) continue;
    } else if (range === "tomorrow") {
      if (fixtureDayKey !== tomorrowKey) continue;
    } else if (range === "3d") {
      if (f.status === "FINISHED" && fixtureDayKey !== todayKey) continue;
      if (koTime < now - 3600000 || koTime > now + 3 * 86400000) continue;
    } else if (range === "7d") {
      if (f.status === "FINISHED" && fixtureDayKey !== todayKey) continue;
      if (koTime < now - 3600000 || koTime > now + 7 * 86400000) continue;
    }

    if (leagueId && f.leagueId !== leagueId) continue;
    if (tier && league.tier !== tier) continue;
    if (cast === "verified" && league.broadcastStatus !== "BROADCAST_VERIFIED") continue;

    if (minConfidence > 0) {
      if (!pred || pred.matchConfidence < minConfidence) continue;
    }

    if (q) {
      const haystack = `${homeTeam.name} ${awayTeam.name} ${league.name} ${league.country}`.toLowerCase();
      if (!haystack.includes(q)) continue;
    }

    enriched.push({
      fixture: f,
      homeTeam,
      awayTeam,
      league,
      prediction: pred,
      isLocked,
      kickoffTime: koTime,
      kickoffIso: f.kickoff,
      dayKey: fixtureDayKey,
    });
  }

  enriched.sort((a, b) => a.kickoffTime - b.kickoffTime);
  return enriched;
}

export function getTodayFixtures(data: AppData): EnrichedFixture[] {
  return queryFixtures(data, { range: "today" });
}

export function getTopEdges(data: AppData, horizonDays: number = 3, limit: number = 10): EnrichedFixture[] {
  const range = horizonDays <= 3 ? "3d" : "7d";
  const candidates = queryFixtures(data, { range });

  return candidates
    .filter((item) => item.prediction && item.prediction.headline && !item.prediction.noStrongEdge)
    .sort((a, b) => {
      const edgeA = a.prediction?.headline?.edgeScore ?? 0;
      const edgeB = b.prediction?.headline?.edgeScore ?? 0;
      return edgeB - edgeA;
    })
    .slice(0, limit);
}
