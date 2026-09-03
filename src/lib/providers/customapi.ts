import { Fixture, HistoricalMatch, League, LeagueTier, Team } from "../types";
import { dayKeyInTz, toUtcIso } from "../time";
import {
  DataSourceMeta, FootballDataProvider, ProviderConfigError, ProviderError,
} from "./types";

/**
 * CUSTOM FOOTBALL API PROVIDER
 * ----------------------------
 * Point EdgeRadar at any HTTP JSON endpoint that speaks the shape below and it
 * becomes the single authoritative data layer — no vendor lock-in.
 *
 *   CUSTOM_API_URL / CUSTOM_FOOTBALL_API_URL   base URL (either one; first wins)
 *   CUSTOM_API_KEY                             optional bearer + x-api-key secret
 *   CUSTOM_API_CACHE_MINUTES                   in-memory TTL, default 15
 *   CUSTOM_API_DATA_PATH                       default "/data"
 *   CUSTOM_API_FIXTURES_PATH                   default "/fixtures"
 *   CUSTOM_API_ODDS_PATH                       optional "/odds" (fixture odds)
 *
 * Contract (all fields optional except where noted):
 *
 *   {
 *     "leagues":  [{ id, name, country, tier?, broadcastStatus?, hasCornerData?,
 *                    hasCardData?, hasOddsFeed?, officialSite?, broadcastEvidence? }],
 *     "teams":    [{ id, leagueId, name, short? }],
 *     "fixtures": [{ id, leagueId, homeId?, awayId?, homeName, awayName,
 *                    kickoff,                      // any ISO-8601 → normalized to UTC
 *                    status,                       // UPCOMING|LIVE|FINISHED|FT|1H|2H|HT|NS|…
 *                    result?: { hg, ag, hg1?, ag1?, corners?, cards? },
 *                    odds?: { "O1.5": 1.35, "2H_O0.5": 1.42, … },
 *                    lineupStatus?, injuryInfo? }],
 *     "historical": [{ id, leagueId, homeId, awayId, date, hg, ag,
 *                      hg1?, ag1?, corners?, cards? }],
 *     "odds":     { "<fixtureId>": { "O1.5": 1.35, … } }
 *   }
 *
 * DATA INTEGRITY RULES
 *  · Kickoffs are normalized to UTC (naive timestamps are read as UTC).
 *  · Odds are only ever taken from the payload. Absent odds are `null` — this
 *    provider never invents a price and never scrapes a bookmaker.
 *  · Half-time / corner / card values that the payload omits stay `null`.
 *  · Every failure throws `ProviderError`/`ProviderConfigError`. There is no
 *    path that quietly degrades to synthetic data.
 */

interface CustomApiRawOdds { [marketCode: string]: number | string | null }

interface CustomApiRawMatch {
  id: string | number;
  leagueId?: string | number;
  leagueName?: string;
  country?: string;
  homeId?: string | number;
  homeName: string;
  awayId?: string | number;
  awayName: string;
  kickoff: string;
  status?: string;
  result?: {
    hg: number; ag: number;
    hg1?: number | null; ag1?: number | null;
    corners?: number | null; cards?: number | null;
  };
  odds?: CustomApiRawOdds;
  lineupStatus?: "ANNOUNCED" | "NOT_ANNOUNCED";
  injuryInfo?: string | null;
}

interface CustomApiPayload {
  leagues?: {
    id: string | number;
    name: string;
    country?: string;
    tier?: LeagueTier;
    broadcastStatus?: "BROADCAST_VERIFIED" | "PUBLIC_COVERAGE_VERIFIED" | "LIMITED_DATA";
    broadcastEvidence?: string;
    officialSite?: string;
    hasCornerData?: boolean;
    hasCardData?: boolean;
    hasOddsFeed?: boolean;
  }[];
  teams?: { id: string | number; leagueId: string | number; name: string; short?: string }[];
  fixtures?: CustomApiRawMatch[];
  historical?: {
    id: string | number; leagueId: string | number;
    homeId: string | number; awayId: string | number;
    date: string; hg: number; ag: number;
    hg1?: number | null; ag1?: number | null;
    corners?: number | null; cards?: number | null;
  }[];
  odds?: Record<string, CustomApiRawOdds>;
}

export interface CustomApiSnapshot {
  fetchedAt: number;
  source: string;
  leagues: League[];
  teams: Team[];
  historical: HistoricalMatch[];
  fixtures: Fixture[];
  odds: Map<string, Map<string, number>>;
  skipped: { fixtures: number; reasons: string[] };
}

let cache: CustomApiSnapshot | null = null;

/** Test/support hook — drops the in-memory snapshot so the next call refetches. */
export function resetCustomApiCache(): void {
  cache = null;
}

export function customApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.CUSTOM_API_URL || env.CUSTOM_FOOTBALL_API_URL || "";
  return raw.trim().replace(/\/+$/, "");
}

export function customApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return (env.CUSTOM_API_KEY || "").trim();
}

function cacheTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const min = parseInt(env.CUSTOM_API_CACHE_MINUTES || "15", 10);
  return (Number.isFinite(min) && min > 0 ? min : 15) * 60000;
}

/** Throws unless the environment actually points at a Custom Football API. */
export function assertCustomApiConfigured(env: NodeJS.ProcessEnv = process.env): string {
  const base = customApiBaseUrl(env);
  if (!base) {
    throw new ProviderConfigError(
      "DATA_PROVIDER=custom but no endpoint is configured. Set CUSTOM_API_URL (or CUSTOM_FOOTBALL_API_URL) to your football JSON API, and CUSTOM_API_KEY if it requires a secret.",
      "custom",
      ["CUSTOM_API_URL", "CUSTOM_FOOTBALL_API_URL"],
    );
  }
  return base;
}

export function customApiRequest(url: string, env: NodeJS.ProcessEnv = process.env): Request {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "EdgeRadar-DataEngine/1.0",
  };
  const key = customApiKey(env);
  if (key) {
    headers.Authorization = key.startsWith("Bearer ") ? key : `Bearer ${key}`;
    headers["x-api-key"] = key;
  }
  return new Request(url, { headers, cache: "no-store" });
}

async function getJson(
  url: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(customApiRequest(url, env));
  } catch (e) {
    throw new ProviderError(
      `Custom Football API unreachable at ${url}: ${(e as Error)?.message ?? e}`,
      "custom",
    );
  }
  if (!res.ok) {
    throw new ProviderError(
      `Custom Football API responded HTTP ${res.status} ${res.statusText} for ${url}`,
      "custom",
      res.status >= 500 || res.status === 429,
    );
  }
  try {
    return await res.json();
  } catch (e) {
    throw new ProviderError(
      `Custom Football API returned non-JSON from ${url}: ${(e as Error)?.message ?? e}`,
      "custom", false,
    );
  }
}

function asPayload(raw: unknown, source: string): CustomApiPayload {
  if (Array.isArray(raw)) return { fixtures: raw as CustomApiRawMatch[] };
  if (raw && typeof raw === "object") {
    const p = raw as CustomApiPayload;
    if (p.fixtures || p.leagues || p.historical || p.odds) return p;
  }
  throw new ProviderError(
    `Custom Football API payload from ${source} has no fixtures/leagues/historical key.`,
    "custom", false,
  );
}

const LIVE_STATUS = new Set(["LIVE", "IN_PLAY", "INPLAY", "1H", "2H", "HT", "ET", "P", "LIVE_1H", "LIVE_2H", "INT"]);
const FINISHED_STATUS = new Set(["FINISHED", "FT", "AET", "PEN", "ENDED", "COMPLETE"]);
const ABANDONED_STATUS = new Set(["POSTPONED", "PST", "CANCELLED", "CAN", "ABANDONED", "ABD", "SUSPENDED", "INTERRUPTED", "TBD", "AWARDED", "WO", "TBD"]);

export function normalizeFixtureStatus(raw: string | undefined): "UPCOMING" | "LIVE" | "FINISHED" | null {
  const s = String(raw ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!s || s === "NS" || s === "NOT_STARTED" || s === "SCHEDULED" || s === "UPCOMING" || s === "TODAY") return s ? "UPCOMING" : null;
  if (FINISHED_STATUS.has(s)) return "FINISHED";
  if (LIVE_STATUS.has(s)) return "LIVE";
  if (ABANDONED_STATUS.has(s)) return null; // dropped: no prediction is issued for it
  return s.startsWith("LIVE") ? "LIVE" : "UPCOMING";
}

function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "team";
}

function buildSnapshot(payload: CustomApiPayload, source: string, fetchedAt: number): CustomApiSnapshot {
  const leagues = new Map<string, League>();
  const teams = new Map<string, Team>();
  const historical: HistoricalMatch[] = [];
  const fixtures: Fixture[] = [];
  const odds = new Map<string, Map<string, number>>();
  const skipped = { fixtures: 0, reasons: [] as string[] };

  const ensureLeague = (id: string, seed?: Partial<League> & { name?: string; country?: string }): League => {
    const existing = leagues.get(id);
    if (existing) return existing;
    const created: League = {
      id,
      name: seed?.name || id,
      country: seed?.country || "World",
      tier: (seed?.tier ?? 1) as LeagueTier,
      broadcastStatus: seed?.broadcastStatus ?? "LIMITED_DATA",
      broadcastEvidence: seed?.broadcastEvidence ?? "Not independently verified by EdgeRadar",
      officialSite: seed?.officialSite || "—",
      dataQuality: "GOOD",
      historicalMatchCount: 0,
      seasonStatus: "Current season",
      hasCornerData: Boolean(seed?.hasCornerData),
      hasCardData: Boolean(seed?.hasCardData),
      hasOddsFeed: Boolean(seed?.hasOddsFeed),
      avgGoals: 0,
    };
    leagues.set(id, created);
    return created;
  };

  const ensureTeam = (id: string, leagueId: string, name: string, short?: string): Team => {
    const existing = teams.get(id);
    if (existing) return existing;
    const created: Team = {
      id, leagueId, name,
      short: short?.trim() || name.trim().slice(0, 3).toUpperCase(),
      attack: 1, defense: 1, // unused outside the demo generator
    };
    teams.set(id, created);
    return created;
  };

  for (const lg of payload.leagues ?? []) {
    const id = String(lg.id);
    ensureLeague(id, {
      name: lg.name, country: lg.country || "World", tier: lg.tier,
      broadcastStatus: lg.broadcastStatus, broadcastEvidence: lg.broadcastEvidence,
      officialSite: lg.officialSite, hasCornerData: lg.hasCornerData,
      hasCardData: lg.hasCardData, hasOddsFeed: lg.hasOddsFeed,
    });
  }

  for (const tm of payload.teams ?? []) {
    ensureTeam(String(tm.id), String(tm.leagueId), tm.name, tm.short);
  }

  const seenFixtureIds = new Set<string>();
  for (const fx of payload.fixtures ?? []) {
    const id = `custom-${String(fx.id)}`;
    if (seenFixtureIds.has(id)) continue;

    let kickoff: string;
    try {
      kickoff = toUtcIso(fx.kickoff);
    } catch (e) {
      skipped.fixtures++;
      skipped.reasons.push(`${id}: ${(e as Error).message}`);
      continue; // an unparseable kickoff must never enter the pipeline
    }

    const status = normalizeFixtureStatus(fx.status);
    if (status === null) {
      skipped.fixtures++;
      skipped.reasons.push(`${id}: status "${fx.status}" is not a schedulable fixture`);
      continue;
    }

    const homeName = String(fx.homeName ?? "").trim();
    const awayName = String(fx.awayName ?? "").trim();
    if (!homeName || !awayName) {
      skipped.fixtures++;
      skipped.reasons.push(`${id}: missing team name`);
      continue;
    }

    const leagueId = String(fx.leagueId ?? "custom-league");
    const lg = ensureLeague(leagueId, {
      name: fx.leagueName || "Custom Competition", country: fx.country || "World",
      hasCornerData: fx.result?.corners != null, hasCardData: fx.result?.cards != null,
      hasOddsFeed: Boolean(fx.odds),
    });
    const homeId = String(fx.homeId ?? `${leagueId}-${slug(homeName)}`);
    const awayId = String(fx.awayId ?? `${leagueId}-${slug(awayName)}`);
    ensureTeam(homeId, leagueId, homeName);
    ensureTeam(awayId, leagueId, awayName);
    if (fx.odds) lg.hasOddsFeed = true;

    const result = fx.result
      ? {
          hg: fx.result.hg, ag: fx.result.ag,
          hg1: fx.result.hg1 ?? null, ag1: fx.result.ag1 ?? null,
          corners: fx.result.corners ?? null, cards: fx.result.cards ?? null,
        }
      : undefined;

    seenFixtureIds.add(id);
    fixtures.push({
      id, leagueId, homeId, awayId, kickoff, status, result,
      lineupStatus: fx.lineupStatus === "ANNOUNCED" ? "ANNOUNCED" : "NOT_ANNOUNCED",
      injuryInfo: fx.injuryInfo ?? null,
    });

    if (fx.odds) {
      const perFixture = odds.get(id) ?? new Map<string, number>();
      for (const [code, raw] of Object.entries(fx.odds)) {
        const n = toNumber(raw);
        if (n !== null && n > 1) perFixture.set(code, n);
      }
      if (perFixture.size) odds.set(id, perFixture);
    }

    // Finished fixtures double as historical samples for the engine.
    if (status === "FINISHED" && result) {
      historical.push({
        id: `custom-h-${String(fx.id)}`, leagueId, homeId, awayId, date: kickoff,
        hg: result.hg, ag: result.ag, hg1: result.hg1, ag1: result.ag1,
        corners: result.corners, cards: result.cards,
      });
    }
  }

  for (const h of payload.historical ?? []) {
    const id = `custom-h-${String(h.id)}`;
    if (historical.some((x) => x.id === id)) continue;
    const leagueId = String(h.leagueId);
    const homeId = String(h.homeId);
    const awayId = String(h.awayId);
    ensureLeague(leagueId);
    ensureTeam(homeId, leagueId, teams.get(homeId)?.name ?? homeId);
    ensureTeam(awayId, leagueId, teams.get(awayId)?.name ?? awayId);
    let date: string;
    try {
      date = toUtcIso(h.date);
    } catch {
      continue;
    }
    historical.push({
      id, leagueId, homeId, awayId, date,
      hg: h.hg, ag: h.ag, hg1: h.hg1 ?? null, ag1: h.ag1 ?? null,
      corners: h.corners ?? null, cards: h.cards ?? null,
    });
  }

  for (const [fixtureId, markets] of Object.entries(payload.odds ?? {})) {
    const perFixture = odds.get(fixtureId) ?? new Map<string, number>();
    for (const [code, raw] of Object.entries(markets ?? {})) {
      const n = toNumber(raw);
      if (n !== null && n > 1) perFixture.set(code, n);
    }
    if (perFixture.size) odds.set(fixtureId, perFixture);
  }

  // League baselines are computed from the historical sample that was actually
  // supplied — never a hard-coded constant.
  for (const lg of leagues.values()) {
    const hist = historical.filter((h) => h.leagueId === lg.id);
    lg.historicalMatchCount = hist.length;
    if (hist.length > 0) {
      const sum = hist.reduce((acc, h) => acc + h.hg + h.ag, 0);
      lg.avgGoals = Math.round((sum / hist.length) * 100) / 100;
    }
  }

  return {
    fetchedAt, source,
    leagues: [...leagues.values()], teams: [...teams.values()],
    historical, fixtures, odds, skipped,
  };
}

/** Fetch + normalize, honoring the in-memory TTL. Exported for tests. */
export async function loadCustomApiData(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<CustomApiSnapshot> {
  const ttl = cacheTtlMs(env);
  if (cache && Date.now() - cache.fetchedAt < ttl) return cache;

  const base = assertCustomApiConfigured(env);
  const dataPath = env.CUSTOM_API_DATA_PATH || "/data";
  const fixturesPath = env.CUSTOM_API_FIXTURES_PATH || "/fixtures";
  const oddsPath = env.CUSTOM_API_ODDS_PATH || "";
  const join = (p: string) => (p.startsWith("http") ? p : `${base}${p.startsWith("/") ? "" : "/"}${p}`);

  let payload: CustomApiPayload | null = null;
  let source = join(dataPath);
  try {
    payload = asPayload(await getJson(source, env, fetchImpl), source);
  } catch (first) {
    // `/data` is the aggregate contract; fall back to a fixtures-only endpoint.
    // This is endpoint discovery, not a data-quality fallback: if the second
    // call also fails, the original error is re-thrown.
    const alt = join(fixturesPath);
    try {
      payload = asPayload(await getJson(alt, env, fetchImpl), alt);
      source = alt;
    } catch {
      throw first;
    }
  }

  if (oddsPath) {
    const url = join(oddsPath);
    try {
      const raw = await getJson(url, env, fetchImpl);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        payload.odds = { ...(payload.odds ?? {}), ...(raw as Record<string, CustomApiRawOdds>) };
      }
    } catch {
      // Odds are optional enrichment; a missing odds endpoint must not blank
      // out fixtures. Odds simply stay null (never fabricated).
    }
  }

  const snapshot = buildSnapshot(payload, source, Date.now());
  if (snapshot.fixtures.length === 0) {
    const why = snapshot.skipped.reasons.slice(0, 3).join("; ");
    throw new ProviderError(
      `Custom Football API at ${source} returned no usable fixtures${why ? ` (${why})` : ""}.`,
      "custom", false,
    );
  }
  cache = snapshot;
  return snapshot;
}

export const customApiProvider: FootballDataProvider = {
  id: "custom",
  name: "Custom Football API",
  mode: "LIVE",
  async getLeagues() { return (await loadCustomApiData()).leagues; },
  async getTeams(leagueId?: string) {
    const t = (await loadCustomApiData()).teams;
    return leagueId ? t.filter((x) => x.leagueId === leagueId) : t;
  },
  async getFixtures() { return (await loadCustomApiData()).fixtures; },
  async getHistoricalMatches() { return (await loadCustomApiData()).historical; },
  async getInjuryNote(fixtureId: string) {
    const fx = (await loadCustomApiData()).fixtures.find((f) => f.id === fixtureId);
    return fx?.injuryInfo ?? null;
  },
  async getOdds(fixtureId: string, marketCode: string) {
    const snap = await loadCustomApiData();
    return snap.odds.get(fixtureId)?.get(marketCode) ?? null;
  },
  async getBroadcastEvidence(leagueId: string) {
    const lg = (await loadCustomApiData()).leagues.find((l) => l.id === leagueId);
    if (!lg || lg.broadcastStatus === "LIMITED_DATA") return null;
    return lg.broadcastEvidence;
  },
  async getSources(): Promise<DataSourceMeta[]> {
    const snap = await loadCustomApiData();
    const lastUpdated = new Date(snap.fetchedAt).toISOString();
    const hasOdds = snap.odds.size > 0;
    return [
      {
        id: "custom-fixtures",
        name: `Custom Football API — fixtures & results`,
        kind: "fixtures", mode: "LIVE", lastUpdated, status: "LIVE",
        notes: `${snap.fixtures.length} fixtures served from ${snap.source}. Kickoffs normalized to UTC; rendered in the display timezone.`,
      },
      {
        id: "custom-statistics",
        name: "Custom Football API — historical statistics",
        kind: "statistics", mode: "LIVE", lastUpdated, status: "LIVE",
        notes: `${snap.historical.length} completed matches feed the engine. Missing half-time/corner/cards stay null — never estimated.`,
      },
      {
        id: "custom-odds",
        name: "Custom Football API — odds feed",
        kind: "odds", mode: "LIVE", lastUpdated,
        status: hasOdds ? "LIVE" : "STALE",
        notes: hasOdds
          ? `Decimal odds supplied by the Custom Football API for ${snap.odds.size} fixtures.`
          : "No odds in the payload — value and banker slips use model-derived fair odds, clearly labeled.",
      },
      {
        id: "custom-freshness",
        name: "Snapshot freshness",
        kind: "fixtures", mode: "LIVE", lastUpdated,
        status: Date.now() - snap.fetchedAt > cacheTtlMs() * 4 ? "RECENT" : "LIVE",
        notes: `Cached in memory for ${Math.round(cacheTtlMs() / 60000)} min (CUSTOM_API_CACHE_MINUTES). Grouped by ${dayKeyInTz(lastUpdated)} in the display timezone.`,
      },
    ];
  },
};
