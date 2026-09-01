import fs from "fs";
import path from "path";
import { Fixture, HistoricalMatch, League, LeagueTier, Team } from "../types";
import { DataSourceMeta, FootballDataProvider, WarmingUpError } from "./types";

/**
 * LIVE PROVIDER — football-data.org (v4)
 * --------------------------------------
 * Official API, free tier. Activated automatically when FOOTBALL_DATA_API_KEY
 * is set (see providers/index.ts). Strict live-only: ONLY competitions actually
 * served by this provider are exposed — demo leagues are never mixed in.
 *
 * Honesty rules:
 *  - No corners/cards/odds/injuries on this tier → those fields are null and the
 *    UI renders "Data unavailable" (never fabricated).
 *  - Missing half-time scores → null (half markets simply get no sample).
 *  - Broadcast badges use curated metadata (these are all major televised
 *    competitions); the evidence string is explicitly labeled as curated.
 *
 * Rate limit: 10 requests/minute on the free tier. Requests are sequential;
 * 429s trigger a 61s wait. Responses are trimmed and cached on disk so cold
 * starts after a restart don't refetch.
 */

const BASE = process.env.FDO_BASE_URL || "https://api.football-data.org/v4";
// Serverless hosts (Vercel/Netlify/Lambda) have a read-only project dir — use /tmp there.
const CACHE_DIR = process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME
  ? "/tmp"
  : path.join(process.cwd(), "data");
const CACHE_FILE = path.join(CACHE_DIR, "fdo-cache.json");
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const DAY = 86400000;

// Free-tier competitions, classified per EdgeRadar's tiering rules.
const COMPS: { code: string; name: string; country: string; tier: LeagueTier; site: string }[] = [
  { code: "PL",  name: "Premier League",       country: "England",     tier: 1, site: "premierleague.com" },
  { code: "PD",  name: "La Liga",              country: "Spain",       tier: 1, site: "laliga.com" },
  { code: "SA",  name: "Serie A",              country: "Italy",       tier: 1, site: "legaseriea.it" },
  { code: "BL1", name: "Bundesliga",           country: "Germany",     tier: 1, site: "bundesliga.com" },
  { code: "FL1", name: "Ligue 1",              country: "France",      tier: 1, site: "ligue1.com" },
  { code: "CL",  name: "UEFA Champions League",country: "Europe",      tier: 2, site: "uefa.com" },
  { code: "DED", name: "Eredivisie",           country: "Netherlands", tier: 2, site: "eredivisie.nl" },
  { code: "PPL", name: "Primeira Liga",        country: "Portugal",    tier: 2, site: "ligaportugal.pt" },
  { code: "BSA", name: "Brasileirão Série A",  country: "Brazil",      tier: 2, site: "cbf.com.br" },
  { code: "ELC", name: "EFL Championship",     country: "England",     tier: 2, site: "efl.com" },
];

// Trimmed match shape persisted in the cache (keep the cache small).
interface RawMatch {
  id: number;
  utcDate: string;
  status: string; // SCHEDULED | TIMED | IN_PLAY | PAUSED | FINISHED | POSTPONED | ...
  homeId: number; homeName: string;
  awayId: number; awayName: string;
  ftHome: number | null; ftAway: number | null;
  htHome: number | null; htAway: number | null;
}

interface CompCache {
  fetchedAt: number;
  seasonLabel: string;
  matches: RawMatch[];
}
interface DiskCache { comps: Record<string, CompCache> }

let mem: DiskCache | null = null;

function loadCache(): DiskCache {
  if (mem) return mem;
  try {
    mem = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as DiskCache;
  } catch {
    mem = { comps: {} };
  }
  return mem;
}
function saveCache() {
  if (!mem) return;
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(mem));
  } catch (e) {
    console.error("[fdo] cache write failed:", e);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fdoFetch(pathname: string): Promise<any> {
  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key) throw new Error("FOOTBALL_DATA_API_KEY is not set — cannot use the football-data.org provider.");
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${BASE}${pathname}`, {
      headers: { "X-Auth-Token": key },
      cache: "no-store",
    });
    if (res.status === 429) {
      console.warn(`[fdo] 429 rate-limited on ${pathname} — waiting 61s`);
      await sleep(61000);
      continue;
    }
    if (res.status === 403) throw Object.assign(new Error(`403 for ${pathname}`), { code: 403 });
    if (!res.ok) throw new Error(`football-data.org ${res.status} for ${pathname}`);
    return res.json();
  }
  throw new Error(`football-data.org rate limit persisted for ${pathname}`);
}

function trim(m: any): RawMatch | null {
  if (!m?.homeTeam?.id || !m?.awayTeam?.id) return null;
  return {
    id: m.id,
    utcDate: m.utcDate,
    status: m.status,
    homeId: m.homeTeam.id, homeName: m.homeTeam.name ?? m.homeTeam.shortName ?? `Team ${m.homeTeam.id}`,
    awayId: m.awayTeam.id, awayName: m.awayTeam.name ?? m.awayTeam.shortName ?? `Team ${m.awayTeam.id}`,
    ftHome: m.score?.fullTime?.home ?? null, ftAway: m.score?.fullTime?.away ?? null,
    htHome: m.score?.halfTime?.home ?? null, htAway: m.score?.halfTime?.away ?? null,
  };
}

async function getCompMatches(code: string): Promise<CompCache> {
  const cache = loadCache();
  const hit = cache.comps[code];
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit;

  const data = await fdoFetch(`/competitions/${code}/matches`);
  let matches: RawMatch[] = (data.matches ?? []).map(trim).filter(Boolean) as RawMatch[];
  const seasonLabel = data.resultSet?.first
    ? `${data.resultSet.first.slice(0, 4)}/${(data.resultSet.last ?? "").slice(0, 4)}`
    : "current";

  // Early-season backfill: if too few finished matches for reliable sampling,
  // try the previous season (gracefully skip if the tier forbids it).
  const finished = matches.filter((m) => m.status === "FINISHED").length;
  if (finished < 80) {
    const prevYear = new Date().getFullYear() - 1;
    try {
      const prev = await fdoFetch(`/competitions/${code}/matches?season=${prevYear}`);
      const prevMatches = ((prev.matches ?? []).map(trim).filter(Boolean) as RawMatch[])
        .filter((m) => m.status === "FINISHED");
      const ids = new Set(matches.map((m) => m.id));
      matches = [...prevMatches.filter((m) => !ids.has(m.id)), ...matches];
      console.log(`[fdo] ${code}: backfilled ${prevMatches.length} matches from season ${prevYear}`);
    } catch (e: any) {
      console.warn(`[fdo] ${code}: previous-season backfill unavailable (${e?.code ?? e?.message}) — proceeding with current season only`);
    }
  }

  const entry: CompCache = { fetchedAt: Date.now(), seasonLabel, matches };
  cache.comps[code] = entry;
  saveCache();
  return entry;
}

// Sequential background warm-up across competitions (respects the shared rate
// budget). NEVER awaited by a page render — pages get a WarmingUpError with
// progress instead of hanging for minutes on the 10 req/min free tier.
let warmPromise: Promise<void> | null = null;
let lastWarmFoundNothing = false;

function startBackgroundWarm(): Promise<void> {
  if (!warmPromise) {
    warmPromise = (async () => {
      for (const c of COMPS) {
        try {
          await getCompMatches(c.code); // no-op when that comp's cache is fresh
        } catch (e: any) {
          console.error(`[fdo] ${c.code}: fetch failed (${e?.message}) — will retry next cycle`);
        }
        await sleep(250);
      }
      lastWarmFoundNothing = Object.keys(loadCache().comps).length === 0;
    })().finally(() => { warmPromise = null; });
  }
  return warmPromise;
}

function warmProgress(): { loaded: number; total: number } {
  const cache = loadCache();
  return { loaded: COMPS.filter((c) => cache.comps[c.code]).length, total: COMPS.length };
}

// ── domain mapping ──────────────────────────────────────────────────────────
interface Mapped {
  leagues: League[]; teams: Team[]; historical: HistoricalMatch[]; fixtures: Fixture[];
  fetchedAt: number;
}

let mappedCache: { at: number; data: Mapped } | null = null;

async function mapAll(): Promise<Mapped> {
  if (mappedCache && Date.now() - mappedCache.at < CACHE_TTL_MS) return mappedCache.data;

  const cache = loadCache();
  const allPresent = COMPS.some((c) => cache.comps[c.code]) &&
    COMPS.filter((c) => cache.comps[c.code]).length >= Math.min(3, COMPS.length);
  const allFresh = COMPS.every((c) => {
    const h = cache.comps[c.code];
    return h && Date.now() - h.fetchedAt < CACHE_TTL_MS;
  });

  if (!allFresh) {
    const warm = startBackgroundWarm();
    // On serverless hosts background work may freeze after the response, so give
    // the warm task a short in-request budget; locally this is a no-op cost.
    if (process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      await Promise.race([warm, sleep(8000)]);
    }
  }

  // Serve whatever complete-enough cache exists (stale-while-revalidate).
  if (allPresent || allFresh) {
    const data = buildMapped(loadCache());
    if (allFresh) mappedCache = { at: Date.now(), data };
    return data;
  }

  if (lastWarmFoundNothing) {
    throw new Error(
      "football-data.org returned no competitions — the API key is likely invalid or the API is unreachable. Check FOOTBALL_DATA_API_KEY."
    );
  }
  const p = warmProgress();
  throw new WarmingUpError(p.loaded, p.total);
}

function buildMapped(cache: DiskCache): Mapped {
  const now = Date.now();
  const leagues: League[] = [];
  const teams: Team[] = [];
  const teamSeen = new Set<string>();
  const historical: HistoricalMatch[] = [];
  const fixtures: Fixture[] = [];
  let oldestFetch = now;

  for (const c of COMPS) {
    const entry = cache.comps[c.code];
    if (!entry) continue;
    oldestFetch = Math.min(oldestFetch, entry.fetchedAt);
    const lgId = c.code.toLowerCase();
    const finished = entry.matches.filter((m) => m.status === "FINISHED" && m.ftHome !== null && m.ftAway !== null);

    for (const m of entry.matches) {
      for (const [tid, tname] of [[m.homeId, m.homeName], [m.awayId, m.awayName]] as [number, string][]) {
        const id = `fdo-${tid}`;
        if (!teamSeen.has(id)) {
          teamSeen.add(id);
          teams.push({
            id, leagueId: lgId, name: tname,
            short: tname.split(" ").map((w) => w[0]).join("").slice(0, 3).toUpperCase(),
            attack: 1, defense: 1, // latent ratings unused outside the demo generator
          });
        }
      }
    }

    for (const m of finished) {
      historical.push({
        id: `fdo-h-${m.id}`, leagueId: lgId,
        homeId: `fdo-${m.homeId}`, awayId: `fdo-${m.awayId}`,
        date: m.utcDate,
        hg: m.ftHome as number, ag: m.ftAway as number,
        hg1: m.htHome, ag1: m.htAway, // null when API lacks HT split — never invented
        corners: null, cards: null,   // not on this tier — never invented
      });
    }

    for (const m of entry.matches) {
      const ko = new Date(m.utcDate).getTime();
      const isUpcoming = (m.status === "SCHEDULED" || m.status === "TIMED") && ko > now && ko < now + 7 * DAY;
      const isLive = m.status === "IN_PLAY" || m.status === "PAUSED";
      const isRecentFinished = m.status === "FINISHED" && ko > now - 14 * DAY && m.ftHome !== null;
      if (!isUpcoming && !isLive && !isRecentFinished) continue;
      fixtures.push({
        id: `fdo-f-${m.id}`, leagueId: lgId,
        homeId: `fdo-${m.homeId}`, awayId: `fdo-${m.awayId}`,
        kickoff: m.utcDate,
        status: isRecentFinished ? "FINISHED" : isLive ? "LIVE" : "UPCOMING",
        result: isRecentFinished ? {
          hg: m.ftHome as number, ag: m.ftAway as number,
          hg1: m.htHome, ag1: m.htAway, corners: null, cards: null,
        } : undefined,
        lineupStatus: "NOT_ANNOUNCED", // lineup feed not on this tier
        injuryInfo: null,              // injury feed not configured → "Data unavailable"
      });
    }

    const avgGoals = finished.length
      ? finished.reduce((s, m) => s + (m.ftHome as number) + (m.ftAway as number), 0) / finished.length
      : 0;

    leagues.push({
      id: lgId, name: c.name, country: c.country, tier: c.tier,
      broadcastStatus: "BROADCAST_VERIFIED",
      broadcastEvidence: "Curated metadata: major televised competition (evidence maintained editorially, not from the data API)",
      officialSite: c.site,
      dataQuality: finished.length >= 150 ? "EXCELLENT" : finished.length >= 60 ? "GOOD" : finished.length >= 20 ? "FAIR" : "LIMITED",
      historicalMatchCount: finished.length,
      seasonStatus: `Season ${entry.seasonLabel} (live feed)`,
      hasCornerData: false, hasCardData: false, hasOddsFeed: false,
      avgGoals: Math.round(avgGoals * 100) / 100,
    });
  }

  if (leagues.length === 0) {
    const p = warmProgress();
    throw new WarmingUpError(p.loaded, p.total);
  }

  return { leagues, teams, historical, fixtures, fetchedAt: oldestFetch };
}

// ── provider implementation ────────────────────────────────────────────────
export const footballDataProvider: FootballDataProvider = {
  mode: "LIVE",
  async getLeagues() { return (await mapAll()).leagues; },
  async getTeams(leagueId?: string) {
    const t = (await mapAll()).teams;
    return leagueId ? t.filter((x) => x.leagueId === leagueId) : t;
  },
  async getFixtures() { return (await mapAll()).fixtures; },
  async getHistoricalMatches() { return (await mapAll()).historical; },
  async getInjuryNote() { return null; },       // not available on this tier — never fabricated
  async getOdds() { return null; },             // no legal odds feed configured — VALUE category disabled
  async getBroadcastEvidence(leagueId: string) {
    const lg = (await mapAll()).leagues.find((l) => l.id === leagueId);
    return lg?.broadcastEvidence ?? null;
  },
  async getSources(): Promise<DataSourceMeta[]> {
    const { fetchedAt } = await mapAll();
    const age = Date.now() - fetchedAt;
    const status = age < 45 * 60000 ? "LIVE" : age < 6 * 3600000 ? "RECENT" : "STALE";
    const last = new Date(fetchedAt).toISOString();
    return [
      { id: "fdo-fixtures", name: "football-data.org — Fixtures & Results", kind: "fixtures", mode: "LIVE", lastUpdated: last, status, notes: "Official API, free tier. 10 competitions. Football data provided by the football-data.org API." },
      { id: "fdo-stats", name: "football-data.org — Match History", kind: "statistics", mode: "LIVE", lastUpdated: last, status, notes: "Full-time + half-time scores. Corners/cards not included on this tier — shown as 'Data unavailable'." },
      { id: "odds", name: "Odds Feed", kind: "odds", mode: "LIVE", lastUpdated: last, status: "STALE", notes: "Not configured. VALUE category disabled rather than estimated." },
      { id: "injuries", name: "Injury Feed", kind: "injuries", mode: "LIVE", lastUpdated: last, status: "STALE", notes: "Not configured. UI shows 'Data unavailable' — never fabricated." },
      { id: "broadcast", name: "Broadcast Metadata", kind: "broadcast", mode: "LIVE", lastUpdated: last, status: "RECENT", notes: "Curated editorial metadata for the 10 live competitions (all major televised leagues)." },
    ];
  },
};
