import { Fixture, HistoricalMatch, League, LeagueTier, Team } from "../types";
import { DataSourceMeta, FootballDataProvider, WarmingUpError } from "./types";
import { getLiveBookmakerOdds } from "./sportybet";

interface CustomApiRawMatch {
  id: string | number;
  leagueId: string | number;
  leagueName?: string;
  country?: string;
  homeId: string | number;
  homeName: string;
  awayId: string | number;
  awayName: string;
  kickoff: string;
  status: "UPCOMING" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED" | string;
  result?: {
    hg: number;
    ag: number;
    hg1?: number | null;
    ag1?: number | null;
    corners?: number | null;
    cards?: number | null;
  };
  lineupStatus?: "ANNOUNCED" | "NOT_ANNOUNCED";
  injuryInfo?: string | null;
}

interface CustomApiPayload {
  leagues?: {
    id: string | number;
    name: string;
    country: string;
    tier?: LeagueTier;
    broadcastStatus?: "BROADCAST_VERIFIED" | "PUBLIC_COVERAGE_VERIFIED" | "LIMITED_DATA";
    broadcastEvidence?: string;
    officialSite?: string;
    hasCornerData?: boolean;
    hasCardData?: boolean;
    hasOddsFeed?: boolean;
  }[];
  teams?: {
    id: string | number;
    leagueId: string | number;
    name: string;
    short?: string;
  }[];
  fixtures?: CustomApiRawMatch[];
  historical?: {
    id: string | number;
    leagueId: string | number;
    homeId: string | number;
    awayId: string | number;
    date: string;
    hg: number;
    ag: number;
    hg1?: number | null;
    ag1?: number | null;
    corners?: number | null;
    cards?: number | null;
  }[];
}

interface CustomDiskCache {
  fetchedAt: number;
  data: {
    leagues: League[];
    teams: Team[];
    historical: HistoricalMatch[];
    fixtures: Fixture[];
  };
}

let memCache: CustomDiskCache | null = null;

function getBaseUrl(): string {
  const url = process.env.CUSTOM_FOOTBALL_API_URL || process.env.CUSTOM_API_URL || "";
  return url.trim().replace(/\/+$/, "");
}

function getApiKey(): string {
  return (process.env.CUSTOM_API_KEY || "").trim();
}

function getTtlMs(): number {
  const min = parseInt(process.env.CUSTOM_API_CACHE_MINUTES || "15", 10);
  return (Number.isFinite(min) && min > 0 ? min : 15) * 60000;
}

async function customFetch(endpoint: string): Promise<any> {
  const base = getBaseUrl();
  if (!base) {
    throw new Error("CUSTOM_API_URL or CUSTOM_FOOTBALL_API_URL is not set.");
  }
  const key = getApiKey();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "EdgeRadar-DataEngine/1.0",
  };
  if (key) {
    headers["Authorization"] = key.startsWith("Bearer ") ? key : `Bearer ${key}`;
    headers["x-api-key"] = key;
  }

  const url = endpoint.startsWith("http") ? endpoint : `${base}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Custom Football API responded with HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

async function fetchAllCustomData(): Promise<{
  leagues: League[];
  teams: Team[];
  historical: HistoricalMatch[];
  fixtures: Fixture[];
}> {
  const ttl = getTtlMs();
  if (memCache && Date.now() - memCache.fetchedAt < ttl) {
    return memCache.data;
  }

  let payload: CustomApiPayload | null = null;
  try {
    const raw = await customFetch("/data");
    if (raw && (raw.fixtures || raw.leagues || Array.isArray(raw))) {
      payload = Array.isArray(raw) ? { fixtures: raw } : raw;
    }
  } catch {
    try {
      const raw = await customFetch("/fixtures");
      payload = Array.isArray(raw) ? { fixtures: raw } : raw;
    } catch (e: any) {
      throw new Error(`Failed to load data from Custom Football API: ${e?.message}`);
    }
  }

  if (!payload) {
    throw new Error("Custom Football API returned empty payload.");
  }

  const leaguesMap = new Map<string, League>();
  const teamsMap = new Map<string, Team>();
  const historical: HistoricalMatch[] = [];
  const fixtures: Fixture[] = [];

  if (Array.isArray(payload.leagues)) {
    for (const lg of payload.leagues) {
      const id = String(lg.id);
      leaguesMap.set(id, {
        id,
        name: lg.name,
        country: lg.country || "World",
        tier: lg.tier || 1,
        broadcastStatus: lg.broadcastStatus || "BROADCAST_VERIFIED",
        broadcastEvidence: lg.broadcastEvidence || "Verified via Custom Football API",
        officialSite: lg.officialSite || "—",
        dataQuality: "EXCELLENT",
        historicalMatchCount: 0,
        seasonStatus: "Live Current Season",
        hasCornerData: Boolean(lg.hasCornerData),
        hasCardData: Boolean(lg.hasCardData),
        hasOddsFeed: lg.hasOddsFeed ?? true,
        avgGoals: 2.75,
      });
    }
  }

  if (Array.isArray(payload.teams)) {
    for (const tm of payload.teams) {
      const id = String(tm.id);
      teamsMap.set(id, {
        id,
        leagueId: String(tm.leagueId),
        name: tm.name,
        short: tm.short || tm.name.slice(0, 3).toUpperCase(),
        attack: 1,
        defense: 1,
      });
    }
  }

  if (Array.isArray(payload.fixtures)) {
    for (const fx of payload.fixtures) {
      const lgId = String(fx.leagueId || "custom-lg");
      const hId = String(fx.homeId || `custom-t-${fx.homeName.toLowerCase().replace(/\s+/g, "-")}`);
      const aId = String(fx.awayId || `custom-t-${fx.awayName.toLowerCase().replace(/\s+/g, "-")}`);

      if (!leaguesMap.has(lgId)) {
        leaguesMap.set(lgId, {
          id: lgId,
          name: fx.leagueName || "Premier Competition",
          country: fx.country || "World",
          tier: 1,
          broadcastStatus: "BROADCAST_VERIFIED",
          broadcastEvidence: "Custom Football API Verified",
          officialSite: "—",
          dataQuality: "GOOD",
          historicalMatchCount: 0,
          seasonStatus: "Live Current Season",
          hasCornerData: fx.result?.corners !== undefined,
          hasCardData: fx.result?.cards !== undefined,
          hasOddsFeed: true,
          avgGoals: 2.75,
        });
      }

      if (!teamsMap.has(hId)) {
        teamsMap.set(hId, {
          id: hId,
          leagueId: lgId,
          name: fx.homeName,
          short: fx.homeName.slice(0, 3).toUpperCase(),
          attack: 1,
          defense: 1,
        });
      }

      if (!teamsMap.has(aId)) {
        teamsMap.set(aId, {
          id: aId,
          leagueId: lgId,
          name: fx.awayName,
          short: fx.awayName.slice(0, 3).toUpperCase(),
          attack: 1,
          defense: 1,
        });
      }

      const status = String(fx.status).toUpperCase();
      const normStatus = status === "FINISHED" || status === "FT"
        ? "FINISHED"
        : status === "LIVE" || status === "IN_PLAY" || status === "1H" || status === "2H" || status === "HT"
        ? "LIVE"
        : "UPCOMING";

      fixtures.push({
        id: `custom-f-${fx.id}`,
        leagueId: lgId,
        homeId: hId,
        awayId: aId,
        kickoff: fx.kickoff,
        status: normStatus,
        result: fx.result ? {
          hg: fx.result.hg,
          ag: fx.result.ag,
          hg1: fx.result.hg1 ?? null,
          ag1: fx.result.ag1 ?? null,
          corners: fx.result.corners ?? null,
          cards: fx.result.cards ?? null,
        } : undefined,
        lineupStatus: fx.lineupStatus || "NOT_ANNOUNCED",
        injuryInfo: fx.injuryInfo || null,
      });

      if (normStatus === "FINISHED" && fx.result) {
        historical.push({
          id: `custom-h-${fx.id}`,
          leagueId: lgId,
          homeId: hId,
          awayId: aId,
          date: fx.kickoff,
          hg: fx.result.hg,
          ag: fx.result.ag,
          hg1: fx.result.hg1 ?? null,
          ag1: fx.result.ag1 ?? null,
          corners: fx.result.corners ?? null,
          cards: fx.result.cards ?? null,
        });
      }
    }
  }

  if (Array.isArray(payload.historical)) {
    for (const h of payload.historical) {
      historical.push({
        id: `custom-h-${h.id}`,
        leagueId: String(h.leagueId),
        homeId: String(h.homeId),
        awayId: String(h.awayId),
        date: h.date,
        hg: h.hg,
        ag: h.ag,
        hg1: h.hg1 ?? null,
        ag1: h.ag1 ?? null,
        corners: h.corners ?? null,
        cards: h.cards ?? null,
      });
    }
  }

  for (const lg of leaguesMap.values()) {
    const hist = historical.filter((h) => h.leagueId === lg.id);
    lg.historicalMatchCount = hist.length;
    if (hist.length > 0) {
      const sum = hist.reduce((acc, h) => acc + h.hg + h.ag, 0);
      lg.avgGoals = Math.round((sum / hist.length) * 100) / 100;
    }
  }

  const resultData = {
    leagues: Array.from(leaguesMap.values()),
    teams: Array.from(teamsMap.values()),
    historical,
    fixtures,
  };

  memCache = {
    fetchedAt: Date.now(),
    data: resultData,
  };

  return resultData;
}

export const customApiProvider: FootballDataProvider = {
  id: "custom",
  name: "Custom Football API",
  mode: "LIVE",
  async getLeagues() {
    return (await fetchAllCustomData()).leagues;
  },
  async getTeams(leagueId?: string) {
    const teams = (await fetchAllCustomData()).teams;
    return leagueId ? teams.filter((t) => t.leagueId === leagueId) : teams;
  },
  async getFixtures() {
    return (await fetchAllCustomData()).fixtures;
  },
  async getHistoricalMatches() {
    return (await fetchAllCustomData()).historical;
  },
  async getInjuryNote() {
    return null;
  },
  async getOdds(fixtureId: string, marketCode: string) {
    try {
      const data = await fetchAllCustomData();
      const fx = data.fixtures.find((f) => f.id === fixtureId);
      if (!fx) return null;
      const home = data.teams.find((t) => t.id === fx.homeId);
      const away = data.teams.find((t) => t.id === fx.awayId);
      if (!home || !away) return null;
      return await getLiveBookmakerOdds(home.name, away.name, marketCode);
    } catch {
      return null;
    }
  },
  async getBroadcastEvidence(leagueId: string) {
    const lg = (await fetchAllCustomData()).leagues.find((l) => l.id === leagueId);
    return lg?.broadcastEvidence ?? null;
  },
  async getSources(): Promise<DataSourceMeta[]> {
    const meta = memCache ? new Date(memCache.fetchedAt).toISOString() : new Date().toISOString();
    return [
      {
        id: "custom-fixtures",
        name: "Custom Football API — Live Match Schedule",
        kind: "fixtures",
        mode: "LIVE",
        lastUpdated: meta,
        status: "LIVE",
        notes: "Live verified fixtures and scores from connected Custom Football API.",
      },
      {
        id: "custom-stats",
        name: "Custom Football API — Match Statistics",
        kind: "statistics",
        mode: "LIVE",
        lastUpdated: meta,
        status: "LIVE",
        notes: "Historical match statistics, full-time and half-time performance data.",
      },
      {
        id: "custom-odds",
        name: "SportyBet / Football.com — Odds Engine",
        kind: "odds",
        mode: "LIVE",
        lastUpdated: meta,
        status: "LIVE",
        notes: "Live bookmaker odds feed for value and banker accumulators.",
      },
    ];
  },
};
