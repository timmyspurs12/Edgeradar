import fs from "fs";
import path from "path";
import { Fixture, HistoricalMatch, League, LeagueTier, Team } from "../types";
import { DataSourceMeta, FootballDataProvider, WarmingUpError } from "./types";
import { getLiveBookmakerOdds } from "./sportybet";

/**
 * LIVE PROVIDER — API-Football (api-sports.io, v3)
 * ------------------------------------------------
 * Activated when APIFOOTBALL_KEY is set (see providers/index.ts).
 *
 * PLAN REALITY (encoded, not hidden):
 *  - FREE plan (100 req/day, 10 req/min): current season is NOT available.
 *    The provider auto-falls back to the newest season the plan allows and runs
 *    a clearly-labeled REPLAY mode: real historical results replayed on a
 *    shifted timeline so the whole app (upcoming fixtures → predictions →
 *    track record) can be exercised honestly. Every replay surface is labeled.
 *  - PRO plan ($19/mo): current season works; REPLAY disables itself.
 *
 * QUOTA STRATEGY: one request per league per cycle, 6h cache TTL by default
 *  (≈ 4 cycles × ~15 leagues = ~60 req/day, safely inside 100/day).
 *  Corners/cards need one extra request per fixture (/fixtures/statistics), so
 *  they are budget-gated via APIFOOTBALL_STATS_BUDGET (default 0 = off) and
 *  cached permanently once fetched (finished-match stats never change).
 *
 * Honesty rules: no odds/injuries wired yet (free keys cannot return them for
 * old seasons) → UI shows "Data unavailable". Missing HT splits → null.
 */

const BASE = process.env.APIFOOTBALL_BASE_URL || "https://v3.football.api-sports.io";
const CACHE_DIR = process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME
  ? "/tmp"
  : path.join(process.cwd(), "data");
const CACHE_FILE = path.join(CACHE_DIR, "apifootball-cache.json");
const TTL_MS = (parseInt(process.env.APIFOOTBALL_TTL_MINUTES || "360", 10)) * 60000;
const STATS_BUDGET = parseInt(process.env.APIFOOTBALL_STATS_BUDGET || "0", 10);
const REPLAY_ENABLED = process.env.APIFOOTBALL_REPLAY !== "0";
const DAY = 86400000;

// Default curated league IDs (override with APIFOOTBALL_LEAGUES=39,140,...).
// Tier 1 per EdgeRadar's classification; everything else defaults to Tier 2.
const TIER1 = new Set([39, 140, 135, 78, 61]);
const BROADCAST_CURATED = new Set([39, 140, 135, 78, 61, 2, 3, 88, 253, 179, 40]);
const DEFAULT_LEAGUES = [
  39,   // Premier League (England)
  140,  // La Liga (Spain)
  135,  // Serie A (Italy)
  78,   // Bundesliga (Germany)
  61,   // Ligue 1 (France)
  2,    // UEFA Champions League
  88,   // Eredivisie (Netherlands)
  94,   // Primeira Liga (Portugal)
  203,  // Süper Lig (Türkiye)
  179,  // Premiership (Scotland)
  253,  // MLS (USA)
  71,   // Série A (Brazil)
  307,  // Pro League (Saudi Arabia)
  40,   // Championship (England)
];

function leagueIds(): number[] {
  const env = process.env.APIFOOTBALL_LEAGUES;
  if (!env) return DEFAULT_LEAGUES;
  return env.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
}

// ── cache ───────────────────────────────────────────────────────────────────
interface RawFx {
  id: number;
  date: string;           // ISO
  status: string;         // short code: NS TBD 1H HT 2H ET FT AET PEN PST CANC …
  homeId: number; homeName: string;
  awayId: number; awayName: string;
  gh: number | null; ga: number | null;      // full time
  hth: number | null; hta: number | null;    // half time
}
interface LeagueCache {
  fetchedAt: number;
  season: number;
  leagueName: string;
  country: string;
  fixtures: RawFx[];
}
interface StatsEntry { corners: number | null; cards: number | null }
interface DiskCache {
  leagues: Record<string, LeagueCache>;
  stats: Record<string, StatsEntry>; // fixtureId → permanent corners/cards
}

let mem: DiskCache | null = null;
function loadCache(): DiskCache {
  if (mem) return mem;
  try { mem = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as DiskCache; }
  catch { mem = { leagues: {}, stats: {} }; }
  if (!mem.stats) mem.stats = {};
  return mem;
}
function saveCache() {
  if (!mem) return;
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(mem));
  } catch (e) { console.error("[af] cache write failed:", e); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── API access ──────────────────────────────────────────────────────────────
let dailyQuotaExhausted = false;

async function afFetch(pathname: string): Promise<any> {
  const key = (process.env.APIFOOTBALL_KEY || "").trim().replace(/^["']|["']$/g, "");
  if (!key) throw new Error("APIFOOTBALL_KEY is not set — cannot use the API-Football provider.");
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${BASE}${pathname}`, {
      headers: {
        "x-apisports-key": key,
        "x-rapidapi-key": key,
        "x-rapidapi-host": "v3.football.api-sports.io",
      },
      cache: "no-store",
    });
    if (res.status === 429) {
      console.warn(`[af] 429 rate-limited on ${pathname} — waiting 61s`);
      await sleep(61000);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`API-Football Authentication Failed (HTTP ${res.status}): Please check that APIFOOTBALL_KEY is valid.`);
    }
    if (!res.ok) throw new Error(`API-Football HTTP ${res.status} for ${pathname}`);
    const body = await res.json();
    // API-Football returns 200 with an `errors` object on quota/plan problems.
    const errs = body?.errors;
    const errList = Array.isArray(errs) ? errs : errs ? Object.values(errs) : [];
    if (errList.length > 0) {
      const msg = String(errList[0]);
      if (/request limit/i.test(msg)) dailyQuotaExhausted = true;
      throw Object.assign(new Error(`API-Football: ${msg}`), { planError: /plan|season/i.test(msg) });
    }
    return body;
  }
  throw new Error(`API-Football rate limit persisted for ${pathname}`);
}

function trimFx(f: any): RawFx | null {
  const t = f?.teams;
  if (!t?.home?.id || !t?.away?.id) return null; // TBD knockout slots etc.
  return {
    id: f.fixture.id,
    date: f.fixture.date,
    status: f.fixture?.status?.short ?? "NS",
    homeId: t.home.id, homeName: t.home.name,
    awayId: t.away.id, awayName: t.away.name,
    gh: f.goals?.home ?? null, ga: f.goals?.away ?? null,
    hth: f.score?.halftime?.home ?? null, hta: f.score?.halftime?.away ?? null,
  };
}

// European default: seasons are labeled by their starting year.
function guessCurrentSeason(): number {
  const d = new Date();
  return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
}

async function fetchLeague(id: number): Promise<LeagueCache> {
  const cache = loadCache();
  const hit = cache.leagues[String(id)];
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit;

  const preferred = process.env.APIFOOTBALL_SEASON
    ? parseInt(process.env.APIFOOTBALL_SEASON, 10)
    : guessCurrentSeason();

  // Try preferred season; on plan/season errors walk back (free keys only
  // serve older seasons). Never fabricate — just use what the plan allows.
  let lastErr: any = null;
  const seasonsToTry = [preferred, preferred - 1, preferred - 2, preferred - 3, preferred - 4, preferred - 5];
  for (const season of seasonsToTry) {
    try {
      const body = await afFetch(`/fixtures?league=${id}&season=${season}`);
      const fixtures = (body.response ?? []).map(trimFx).filter(Boolean) as RawFx[];
      if (fixtures.length === 0) { lastErr = new Error(`season ${season} empty`); continue; }
      const lg = body.response[0]?.league;
      const entry: LeagueCache = {
        fetchedAt: Date.now(),
        season,
        leagueName: lg?.name ?? `League ${id}`,
        country: lg?.country ?? "—",
        fixtures,
      };
      if (season !== preferred) {
        console.warn(`[af] league ${id}: season ${preferred} unavailable on this plan — using ${season}`);
      }
      cache.leagues[String(id)] = entry;
      saveCache();
      return entry;
    } catch (e: any) {
      lastErr = e;
      if (dailyQuotaExhausted) throw e;
      if (!e.planError) throw e; // real errors shouldn't trigger season-walking
      await sleep(300);
    }
  }
  throw lastErr ?? new Error(`league ${id}: no season available`);
}

// Optional corners/cards enrichment (1 request per fixture, permanent cache).
async function enrichStats(fixtureIds: number[]) {
  if (STATS_BUDGET <= 0 || dailyQuotaExhausted) return;
  const cache = loadCache();
  let spent = 0;
  for (const id of fixtureIds) {
    if (spent >= STATS_BUDGET || dailyQuotaExhausted) break;
    if (cache.stats[String(id)]) continue;
    try {
      const body = await afFetch(`/fixtures/statistics?fixture=${id}`);
      spent++;
      let corners: number | null = null, yellows = 0, reds = 0, sawCards = false;
      for (const teamBlock of body.response ?? []) {
        for (const s of teamBlock.statistics ?? []) {
          const v = typeof s.value === "number" ? s.value : parseInt(s.value ?? "", 10);
          if (s.type === "Corner Kicks" && Number.isFinite(v)) corners = (corners ?? 0) + v;
          if (s.type === "Yellow Cards" && Number.isFinite(v)) { yellows += v; sawCards = true; }
          if (s.type === "Red Cards" && Number.isFinite(v)) { reds += v; sawCards = true; }
        }
      }
      cache.stats[String(id)] = { corners, cards: sawCards ? yellows + reds : null };
      saveCache();
      await sleep(300);
    } catch (e: any) {
      console.warn(`[af] stats for fixture ${id} failed: ${e?.message}`);
      if (dailyQuotaExhausted) break;
    }
  }
  if (spent > 0) console.log(`[af] enriched corners/cards for ${spent} fixtures (budget ${STATS_BUDGET})`);
}

// ── background warm ─────────────────────────────────────────────────────────
let warmPromise: Promise<void> | null = null;
let lastWarmFoundNothing = false;

function startBackgroundWarm(): Promise<void> {
  if (!warmPromise) {
    warmPromise = (async () => {
      const ids = leagueIds();
      for (const id of ids) {
        try { await fetchLeague(id); }
        catch (e: any) { console.error(`[af] league ${id}: ${e?.message} — will retry next cycle`); }
        await sleep(400);
        if (dailyQuotaExhausted) { console.error("[af] daily quota exhausted — stopping warm cycle"); break; }
      }
      // Enrich most recent finished fixtures first (they feed the engine now).
      const cache = loadCache();
      const finishedIds = Object.values(cache.leagues)
        .flatMap((l) => l.fixtures.filter((f) => isFinished(f.status) && f.gh !== null))
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((f) => f.id);
      await enrichStats(finishedIds);
      lastWarmFoundNothing = Object.keys(loadCache().leagues).length === 0;
    })().finally(() => { warmPromise = null; });
  }
  return warmPromise;
}

const isFinished = (s: string) => ["FT", "AET", "PEN"].includes(s);
const isLive = (s: string) => ["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"].includes(s);
const isUpcoming = (s: string) => ["NS", "TBD"].includes(s);

// ── domain mapping (with honest REPLAY handling for free-plan old seasons) ──
interface Mapped {
  leagues: League[]; teams: Team[]; historical: HistoricalMatch[]; fixtures: Fixture[];
  fetchedAt: number; replay: boolean; replayOffsetDays: number;
}
let mappedCache: { at: number; data: Mapped } | null = null;

async function mapAll(): Promise<Mapped> {
  if (mappedCache && Date.now() - mappedCache.at < Math.min(TTL_MS, 30 * 60000)) return mappedCache.data;

  const cache = loadCache();
  const ids = leagueIds();
  const present = ids.filter((id) => cache.leagues[String(id)]);
  const allFresh = ids.every((id) => {
    const h = cache.leagues[String(id)];
    return h && Date.now() - h.fetchedAt < TTL_MS;
  });

  if (!allFresh) {
    const warm = startBackgroundWarm();
    if (process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      await Promise.race([warm, sleep(8000)]);
    }
  }

  if (present.length >= Math.min(3, ids.length) && present.length > 0) {
    const data = buildMapped(loadCache(), ids);
    if (allFresh) mappedCache = { at: Date.now(), data };
    return data;
  }

  if (lastWarmFoundNothing || dailyQuotaExhausted) {
    throw new Error(
      dailyQuotaExhausted
        ? "API-Football daily request quota exhausted (free plan: 100/day). Data resumes after the daily reset (00:00 UTC)."
        : "API-Football returned no leagues — check APIFOOTBALL_KEY."
    );
  }
  const loaded = present.length;
  throw new WarmingUpError(loaded, ids.length);
}

function buildMapped(cache: DiskCache, ids: number[]): Mapped {
  const now = Date.now();

  // Detect old-season data (free plan) → REPLAY mode with a single global shift.
  let allDates: number[] = [];
  for (const id of ids) {
    const lc = cache.leagues[String(id)];
    if (lc) allDates = allDates.concat(lc.fixtures.map((f) => new Date(f.date).getTime()));
  }
  allDates.sort((a, b) => a - b);
  const maxDate = allDates[allDates.length - 1] ?? now;
  const replay = REPLAY_ENABLED && maxDate < now - 21 * DAY && allDates.length > 0;
  let offset = 0;
  if (replay) {
    const vnow = allDates[Math.floor(allDates.length * 0.7)]; // replay from 70% into the season
    offset = now - vnow;
  }
  const offsetDays = Math.round(offset / DAY);

  const leagues: League[] = [];
  const teams: Team[] = [];
  const teamSeen = new Set<string>();
  const historical: HistoricalMatch[] = [];
  const fixtures: Fixture[] = [];
  let oldestFetch = now;

  for (const id of ids) {
    const lc = cache.leagues[String(id)];
    if (!lc) continue;
    oldestFetch = Math.min(oldestFetch, lc.fetchedAt);
    const lgId = `af${id}`;
    let finishedCount = 0;
    let goalsSum = 0;
    let cornerSamples = 0, cardSamples = 0;

    for (const f of lc.fixtures) {
      for (const [tid, tname] of [[f.homeId, f.homeName], [f.awayId, f.awayName]] as [number, string][]) {
        const key = `af-${tid}`;
        if (!teamSeen.has(key)) {
          teamSeen.add(key);
          teams.push({
            id: key, leagueId: lgId, name: tname,
            short: tname.split(" ").map((w) => w[0]).join("").slice(0, 3).toUpperCase(),
            attack: 1, defense: 1,
          });
        }
      }

      const shifted = new Date(f.date).getTime() + offset;
      const stats = cache.stats[String(f.id)];
      const corners = stats?.corners ?? null;
      const cards = stats?.cards ?? null;

      if (replay) {
        // REPLAY: results after the virtual "now" are hidden entirely so the
        // engine can never peek at them — an honest walk-forward backtest.
        if (shifted <= now && isFinished(f.status) && f.gh !== null && f.ga !== null) {
          historical.push({
            id: `af-h-${f.id}`, leagueId: lgId,
            homeId: `af-${f.homeId}`, awayId: `af-${f.awayId}`,
            date: new Date(shifted).toISOString(),
            hg: f.gh, ag: f.ga, hg1: f.hth, ag1: f.hta, corners, cards,
          });
          finishedCount++; goalsSum += f.gh + f.ga;
          if (corners !== null) cornerSamples++;
          if (cards !== null) cardSamples++;
          if (shifted > now - 14 * DAY) {
            fixtures.push({
              id: `af-f-${f.id}`, leagueId: lgId,
              homeId: `af-${f.homeId}`, awayId: `af-${f.awayId}`,
              kickoff: new Date(shifted).toISOString(),
              status: "FINISHED",
              result: { hg: f.gh, ag: f.ga, hg1: f.hth, ag1: f.hta, corners, cards },
              lineupStatus: "NOT_ANNOUNCED", injuryInfo: null,
            });
          }
        } else if (shifted > now && shifted < now + 14 * DAY && (isFinished(f.status) || isUpcoming(f.status))) {
          fixtures.push({
            id: `af-f-${f.id}`, leagueId: lgId,
            homeId: `af-${f.homeId}`, awayId: `af-${f.awayId}`,
            kickoff: new Date(shifted).toISOString(),
            status: "UPCOMING", // result deliberately withheld (walk-forward)
            lineupStatus: "NOT_ANNOUNCED", injuryInfo: null,
          });
        }
        continue;
      }

      // NORMAL (current-season, paid plan) mapping
      if (isFinished(f.status) && f.gh !== null && f.ga !== null) {
        historical.push({
          id: `af-h-${f.id}`, leagueId: lgId,
          homeId: `af-${f.homeId}`, awayId: `af-${f.awayId}`,
          date: f.date, hg: f.gh, ag: f.ga, hg1: f.hth, ag1: f.hta, corners, cards,
        });
        finishedCount++; goalsSum += f.gh + f.ga;
        if (corners !== null) cornerSamples++;
        if (cards !== null) cardSamples++;
        const ko = new Date(f.date).getTime();
        if (ko > now - 14 * DAY) {
          fixtures.push({
            id: `af-f-${f.id}`, leagueId: lgId,
            homeId: `af-${f.homeId}`, awayId: `af-${f.awayId}`,
            kickoff: f.date, status: "FINISHED",
            result: { hg: f.gh, ag: f.ga, hg1: f.hth, ag1: f.hta, corners, cards },
            lineupStatus: "NOT_ANNOUNCED", injuryInfo: null,
          });
        }
      } else if (isLive(f.status)) {
        fixtures.push({
          id: `af-f-${f.id}`, leagueId: lgId,
          homeId: `af-${f.homeId}`, awayId: `af-${f.awayId}`,
          kickoff: f.date, status: "LIVE",
          lineupStatus: "NOT_ANNOUNCED", injuryInfo: null,
        });
      } else if (isUpcoming(f.status)) {
        const ko = new Date(f.date).getTime();
        if (ko > now && ko < now + 7 * DAY) {
          fixtures.push({
            id: `af-f-${f.id}`, leagueId: lgId,
            homeId: `af-${f.homeId}`, awayId: `af-${f.awayId}`,
            kickoff: f.date, status: "UPCOMING",
            lineupStatus: "NOT_ANNOUNCED", injuryInfo: null,
          });
        }
      }
    }

    const tier: LeagueTier = TIER1.has(id) ? 1 : 2;
    leagues.push({
      id: lgId,
      name: lc.leagueName,
      country: lc.country,
      tier,
      broadcastStatus: BROADCAST_CURATED.has(id) ? "BROADCAST_VERIFIED" : "PUBLIC_COVERAGE_VERIFIED",
      broadcastEvidence: "Curated metadata: televised/publicly covered competition (maintained editorially, not from the data API)",
      officialSite: "—",
      dataQuality: finishedCount >= 150 ? "EXCELLENT" : finishedCount >= 60 ? "GOOD" : finishedCount >= 20 ? "FAIR" : "LIMITED",
      historicalMatchCount: finishedCount,
      seasonStatus: replay
        ? `REPLAY · season ${lc.season} replayed on a shifted timeline (+${offsetDays}d) — free-plan test mode, not real fixtures`
        : `Season ${lc.season} (live feed)`,
      hasCornerData: cornerSamples >= 20,
      hasCardData: cardSamples >= 20,
      hasOddsFeed: true,
      avgGoals: finishedCount ? Math.round((goalsSum / finishedCount) * 100) / 100 : 0,
    });
  }

  if (leagues.length === 0) {
    throw new WarmingUpError(0, ids.length);
  }

  return { leagues, teams, historical, fixtures, fetchedAt: oldestFetch, replay, replayOffsetDays: offsetDays };
}

// ── provider implementation ─────────────────────────────────────────────────
export const apiFootballProvider: FootballDataProvider = {
  id: "api-football",
  name: "API-Football (api-sports.io v3)",
  mode: "LIVE",
  async getLeagues() { return (await mapAll()).leagues; },
  async getTeams(leagueId?: string) {
    const t = (await mapAll()).teams;
    return leagueId ? t.filter((x) => x.leagueId === leagueId) : t;
  },
  async getFixtures() { return (await mapAll()).fixtures; },
  async getHistoricalMatches() { return (await mapAll()).historical; },
  async getInjuryNote() { return null; },  // not wired yet — never fabricated
  async getOdds(fixtureId: string, marketCode: string) {
    try {
      const data = await mapAll();
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
    const lg = (await mapAll()).leagues.find((l) => l.id === leagueId);
    return lg?.broadcastEvidence ?? null;
  },
  async getSources(): Promise<DataSourceMeta[]> {
    const m = await mapAll();
    const age = Date.now() - m.fetchedAt;
    const status = age < TTL_MS ? "LIVE" : age < 12 * 3600000 ? "RECENT" : "STALE";
    const last = new Date(m.fetchedAt).toISOString();
    const replayNote = m.replay
      ? ` REPLAY MODE ACTIVE: free plan cannot access the current season, so a completed season is replayed on a +${m.replayOffsetDays}d shifted timeline as an honest walk-forward test. Fixtures shown as UPCOMING are historical matches whose results are hidden from the engine. Upgrade to Pro for real current-season fixtures.`
      : "";
    return [
      { id: "af-fixtures", name: "API-Football — Fixtures & Results", kind: "fixtures", mode: "LIVE", lastUpdated: last, status, notes: `api-sports.io v3, ${leagueIds().length} configured leagues.${replayNote}` },
      { id: "af-stats", name: "API-Football — Corners & Cards", kind: "statistics", mode: "LIVE", lastUpdated: last, status: STATS_BUDGET > 0 ? status : "STALE", notes: STATS_BUDGET > 0 ? `Per-fixture statistics enrichment, budget ${STATS_BUDGET} requests/cycle, permanent cache.` : "Disabled (APIFOOTBALL_STATS_BUDGET=0) to protect the free 100 req/day quota. Corner/Card radars show 'Data unavailable'." },
      { id: "odds", name: "SportyBet / Football.com — Odds Feed", kind: "odds", mode: "LIVE", lastUpdated: last, status: "LIVE", notes: "Real decimal market odds from SportyBet & Football.com bookmaker feeds." },
      { id: "injuries", name: "Injury Feed", kind: "injuries", mode: "LIVE", lastUpdated: last, status: "STALE", notes: "Not wired yet. UI shows 'Data unavailable' — never fabricated." },
      { id: "broadcast", name: "Broadcast Metadata", kind: "broadcast", mode: "LIVE", lastUpdated: last, status: "RECENT", notes: "Curated editorial metadata for configured competitions." },
    ];
  },
};
