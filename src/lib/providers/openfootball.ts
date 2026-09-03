import { Fixture, HistoricalMatch, League, LeagueTier, Team } from "../types";
import { partsInTz, zonedTimeToUtcMs } from "../time";
import {
  DataSourceMeta, FootballDataProvider, ProviderError,
} from "./types";

/**
 * OPENFOOTBALL PROVIDER
 * ---------------------
 * Free, openly licensed community datasets published as JSON by
 * `openfootball/football.json` (github.com/openfootball/football.json).
 * No API key is required, so this provider is a legitimate live-data option
 * for anyone who does not want to register with a commercial vendor.
 *
 *   OPENFOOTBALL_BASE_URL      default: the raw.githubusercontent CDN
 *   OPENFOOTBALL_LEAGUES       default: "en.1,es.1,it.1,de.1,fr.1"
 *   OPENFOOTBALL_SEASONS       default: current + previous season, e.g. "2026-27,2025-26"
 *   OPENFOOTBALL_TZ            default: "UTC" — see caveat below
 *   OPENFOOTBALL_CACHE_MINUTES default: 60
 *
 * File contract (per `{season}/{league}.json`):
 *   { "name": "...", "matches": [
 *       { "round": "Matchday 1", "date": "2026-08-15", "time": "20:00",
 *         "team1": "Liverpool FC", "team2": "AFC Bournemouth",
 *         "score": "4-2" | { "ht": "1-0", "ft": "4-2" } | "4-2 (1-0)",
 *         "status": "FT" | "HT" | "LIVE" | "POSTP." | … } ] }
 *
 * HONEST LIMITATIONS (surfaced to /sources rather than papered over):
 *  · The dataset carries **no timezone**. `OPENFOOTBALL_TZ` declares what zone
 *    the published `date`/`time` pair is in; it is converted to UTC from there.
 *    The default is UTC, which means kickoff labels can be hours off — set the
 *    variable (e.g. `Europe/London`) for a correct display.
 *  · No corners, no cards, no odds, no injuries. Those stay `null`.
 *  · Half-time scores are only present where the dataset publishes them.
 *  · Matches without a `time` default to 00:00 in `OPENFOOTBALL_TZ` and are
 *    flagged in `getSources()`.
 */

export const OPENFOOTBALL_DEFAULT_BASE =
  "https://raw.githubusercontent.com/openfootball/football.json/master";
export const OPENFOOTBALL_DEFAULT_LEAGUES = ["en.1", "es.1", "it.1", "de.1", "fr.1"];

interface OpenFootballMatch {
  round?: string;
  date?: string;
  time?: string;
  team1?: string;
  team2?: string;
  score?: string | { ft?: string; ht?: string };
  status?: string;
  [k: string]: unknown;
}

interface OpenFootballFile {
  name?: string;
  matches?: OpenFootballMatch[];
}

interface Snapshot {
  fetchedAt: number;
  leagues: League[];
  teams: Team[];
  fixtures: Fixture[];
  historical: HistoricalMatch[];
  meta: {
    loadedFiles: string[];
    missingFiles: string[];
    timelessMatches: number;
    source: string;
    tz: string;
  };
}

let cache: Snapshot | null = null;

/** Test/support hook. */
export function resetOpenFootballCache(): void {
  cache = null;
}

function openfootballBase(env: NodeJS.ProcessEnv): string {
  return (env.OPENFOOTBALL_BASE_URL || OPENFOOTBALL_DEFAULT_BASE).trim().replace(/\/+$/, "");
}

function cacheTtlMs(env: NodeJS.ProcessEnv): number {
  const min = parseInt(env.OPENFOOTBALL_CACHE_MINUTES || "60", 10);
  return (Number.isFinite(min) && min > 0 ? min : 60) * 60000;
}

/** `2026-27` for a date from July 2026 onward, `2025-26` before July. */
export function seasonKeyFor(now: number | Date = Date.now()): string {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return m >= 7 ? `${y}-${String((y + 1) % 100).padStart(2, "0")}` : `${y - 1}-${String(y % 100).padStart(2, "0")}`;
}

function previousSeasonKey(season: string): string {
  const [startRaw] = season.split("-");
  const start = Number.parseInt(startRaw, 10);
  if (!Number.isFinite(start)) return season;
  return `${start - 1}-${String(start % 100).padStart(2, "0")}`;
}

export function openfootballSeasons(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.OPENFOOTBALL_SEASONS) {
    return env.OPENFOOTBALL_SEASONS.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const current = seasonKeyFor();
  return [current, previousSeasonKey(current)];
}

export function openfootballLeagues(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.OPENFOOTBALL_LEAGUES) {
    return env.OPENFOOTBALL_LEAGUES.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return OPENFOOTBALL_DEFAULT_LEAGUES;
}

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

/** `"4-2"`, `"4-2 (1-0)"` or `{ ft, ht }` → `{ hg, ag, hg1, ag1 }`. */
export function parseScore(
  score: OpenFootballMatch["score"],
): { hg: number; ag: number; hg1: number | null; ag1: number | null } | null {
  if (score === null || score === undefined) return null;
  let ftRaw = "";
  let htRaw = "";
  if (typeof score === "string") {
    const m = score.trim().match(/^(\d+)\s*[-:]\s*(\d+)(?:\s*\((\d+)\s*[-:]\s*(\d+)\))?/);
    if (!m) return null;
    ftRaw = `${m[1]}-${m[2]}`;
    if (m[3] !== undefined) htRaw = `${m[3]}-${m[4]}`;
  } else {
    ftRaw = String(score.ft ?? "").trim();
    htRaw = String(score.ht ?? "").trim();
  }
  const ft = ftRaw.match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (!ft) return null;
  const ht = htRaw.match(/^(\d+)\s*[-:]\s*(\d+)$/);
  return {
    hg: Number(ft[1]), ag: Number(ft[2]),
    hg1: ht ? Number(ht[1]) : null, ag1: ht ? Number(ht[2]) : null,
  };
}

const FINISHED = new Set(["FT", "AET", "PEN", "FINISHED", "ENDED", "AWARDED", "WO"]);
const LIVE = new Set(["LIVE", "HT", "1H", "2H", "ET", "P", "INPLAY", "IN_PLAY"]);
const ABANDONED = new Set(["POSTP.", "POSTP", "PST", "POSTPONED", "CANCELLED", "CANCELLED", "CAN", "CAN.", "ABAND.", "ABAND", "ABANDONED", "SUSP.", "SUSP", "INT.", "INT", "AWD", "AWD.", "WO", "WO.", "TBD", "TBD."]);

export function openfootballStatus(
  raw: string | undefined,
  hasScore: boolean,
  kickoffMs: number,
  now: number,
): "UPCOMING" | "LIVE" | "FINISHED" | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s) {
    if (FINISHED.has(s)) return "FINISHED";
    if (LIVE.has(s)) return "LIVE";
    if (ABANDONED.has(s)) return null;
  }
  if (hasScore) return "FINISHED";
  if (kickoffMs > now) return "UPCOMING";
  // Past its scheduled start with no score published: in play (or awaiting
  // data). Treated as LIVE so it is never offered as a pre-match pick.
  return kickoffMs <= now - 3 * 3600000 ? "FINISHED" : "LIVE";
}

function kickoffUtcMs(date: string | undefined, time: string | undefined, tz: string): { ms: number | null; timeless: boolean } {
  if (!date) return { ms: null, timeless: true };
  const dm = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!dm) return { ms: null, timeless: true };
  const tm = String(time ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  const hour = tm ? Number(tm[1]) : 0;
  const minute = tm ? Number(tm[2]) : 0;
  try {
    return {
      ms: zonedTimeToUtcMs(Number(dm[1]), Number(dm[2]), Number(dm[3]), hour, minute, 0, tz),
      timeless: !tm,
    };
  } catch {
    return { ms: null, timeless: !tm };
  }
}

async function fetchFile(url: string): Promise<OpenFootballFile | null> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "EdgeRadar-DataEngine/1.0" }, cache: "no-store" });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    const json = (await res.json()) as OpenFootballFile;
    return json && typeof json === "object" ? json : null;
  } catch {
    return null;
  }
}

async function loadSnapshot(
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): Promise<Snapshot> {
  if (cache && now - cache.fetchedAt < cacheTtlMs(env)) return cache;

  const base = openfootballBase(env);
  const tz = (env.OPENFOOTBALL_TZ || "UTC").trim() || "UTC";
  const seasons = openfootballSeasons(env);
  const leagueCodes = openfootballLeagues(env);

  const leagues = new Map<string, League>();
  const teams = new Map<string, Team>();
  const fixtures: Fixture[] = [];
  const historical: HistoricalMatch[] = [];
  const loadedFiles: string[] = [];
  const missingFiles: string[] = [];
  let timelessMatches = 0;

  for (const season of seasons) {
    for (const code of leagueCodes) {
      const url = `${base}/${season}/${code}.json`;
      const file = await fetchFile(url);
      if (!file || !Array.isArray(file.matches) || file.matches.length === 0) {
        missingFiles.push(`${season}/${code}.json`);
        continue;
      }
      loadedFiles.push(`${season}/${code}.json`);

      const leagueId = `of-${code}-${season}`;
      const league: League = {
        id: leagueId,
        name: (file.name || `${code.toUpperCase()} ${season}`).replace(/\s+\d{4}\/\d{2}$/, ""),
        country: countryFor(code),
        tier: tierFor(code),
        broadcastStatus: "PUBLIC_COVERAGE_VERIFIED",
        broadcastEvidence: `Open community dataset openfootball/football.json (${season}/${code}.json), openly licensed. Broadcast rights not verified by EdgeRadar.`,
        officialSite: "https://github.com/openfootball/football.json",
        dataQuality: "FAIR",
        historicalMatchCount: 0,
        seasonStatus: `${season} season`,
        hasCornerData: false,
        hasCardData: false,
        hasOddsFeed: false,
        avgGoals: 0,
      };
      leagues.set(leagueId, league);

      const ensureTeam = (name: string): string => {
        const clean = name.trim();
        const id = `of-t-${slug(clean)}`;
        if (!teams.has(id)) {
          teams.set(id, {
            id, leagueId, name: clean,
            short: clean.replace(/\s+(FC|CF|AC|AS|SC|SSC|AFC|CFC|RC|SV|VfB|TSG|1\.|BV)\b/gi, "").trim().slice(0, 3).toUpperCase() || clean.slice(0, 3).toUpperCase(),
            attack: 1, defense: 1,
          });
        }
        return id;
      };

      for (const m of file.matches) {
        const homeName = String(m.team1 ?? "").trim();
        const awayName = String(m.team2 ?? "").trim();
        if (!homeName || !awayName) continue;

        const { ms, timeless } = kickoffUtcMs(m.date, m.time, tz);
        if (ms === null) continue;
        if (timeless) timelessMatches++;

        const score = parseScore(m.score);
        const status = openfootballStatus(m.status, score !== null, ms, now);
        if (status === null) continue;

        const homeId = ensureTeam(homeName);
        const awayId = ensureTeam(awayName);
        const kickoff = new Date(ms).toISOString();
        const fixtureId = `of-${code}-${season}-${slug(homeName)}-${slug(awayName)}-${String(m.date)}`;

        if (fixtures.some((f) => f.id === fixtureId)) continue;

        fixtures.push({
          id: fixtureId, leagueId, homeId, awayId, kickoff, status,
          result: score
            ? { hg: score.hg, ag: score.ag, hg1: score.hg1, ag1: score.ag1, corners: null, cards: null }
            : undefined,
          lineupStatus: "NOT_ANNOUNCED",
          injuryInfo: null,
        });

        if (status === "FINISHED" && score) {
          historical.push({
            id: fixtureId, leagueId, homeId, awayId, date: kickoff,
            hg: score.hg, ag: score.ag, hg1: score.hg1, ag1: score.ag1,
            corners: null, cards: null,
          });
        }
      }

      const hist = historical.filter((h) => h.leagueId === leagueId);
      league.historicalMatchCount = hist.length;
      league.avgGoals = hist.length
        ? Math.round((hist.reduce((a, h) => a + h.hg + h.ag, 0) / hist.length) * 100) / 100
        : 0;
    }
  }

  if (loadedFiles.length === 0) {
    throw new ProviderError(
      `OpenFootball returned no datasets from ${base} (tried ${missingFiles.length} files: ${missingFiles.slice(0, 3).join(", ")}${missingFiles.length > 3 ? ", …" : ""}). Check OPENFOOTBALL_BASE_URL / OPENFOOTBALL_SEASONS / OPENFOOTBALL_LEAGUES.`,
      "openfootball",
    );
  }

  const snap: Snapshot = {
    fetchedAt: now, leagues: [...leagues.values()], teams: [...teams.values()],
    fixtures, historical,
    meta: { loadedFiles, missingFiles, timelessMatches, source: base, tz },
  };
  cache = snap;
  return snap;
}

function countryFor(code: string): string {
  const map: Record<string, string> = {
    en: "England", es: "Spain", it: "Italy", de: "Germany", fr: "France",
    nl: "Netherlands", pt: "Portugal", tr: "Türkiye", sco: "Scotland",
    be: "Belgium", at: "Austria", ch: "Switzerland", br: "Brazil", ar: "Argentina",
    us: "United States", mx: "Mexico", jp: "Japan", gr: "Greece", ro: "Romania",
  };
  return map[code.split(".")[0]] ?? "International";
}

function tierFor(code: string): LeagueTier {
  const top = new Set(["en.1", "es.1", "it.1", "de.1", "fr.1"]);
  if (top.has(code)) return 1;
  return code.endsWith(".1") ? 2 : 3;
}

export const openFootballProvider: FootballDataProvider = {
  id: "openfootball",
  name: "OpenFootball (open community dataset)",
  mode: "LIVE",
  async getLeagues() { return (await loadSnapshot()).leagues; },
  async getTeams(leagueId?: string) {
    const t = (await loadSnapshot()).teams;
    return leagueId ? t.filter((x) => x.leagueId === leagueId) : t;
  },
  async getFixtures() { return (await loadSnapshot()).fixtures; },
  async getHistoricalMatches() { return (await loadSnapshot()).historical; },
  async getInjuryNote() { return null; }, // not in the dataset — never fabricated
  async getOdds() { return null; },       // no odds feed — never fabricated
  async getBroadcastEvidence(leagueId: string) {
    const lg = (await loadSnapshot()).leagues.find((l) => l.id === leagueId);
    return lg?.broadcastEvidence ?? null;
  },
  async getSources(): Promise<DataSourceMeta[]> {
    const s = await loadSnapshot();
    const lastUpdated = new Date(s.fetchedAt).toISOString();
    const tzOffsetH = Math.round(tzOffsetHours(s.meta.tz) * 10) / 10;
    return [
      {
        id: "openfootball-fixtures",
        name: "OpenFootball — fixtures & results",
        kind: "fixtures", mode: "LIVE", lastUpdated, status: "LIVE",
        notes: `${s.fixtures.length} matches from ${s.meta.loadedFiles.length} openly licensed dataset file(s) at ${s.meta.source}.`,
      },
      {
        id: "openfootball-statistics",
        name: "OpenFootball — historical results",
        kind: "statistics", mode: "LIVE", lastUpdated, status: "LIVE",
        notes: `${s.historical.length} completed matches. Goals only — corners, cards and half-time splits are absent from this source and stay null.`,
      },
      {
        id: "openfootball-odds",
        name: "Odds feed",
        kind: "odds", mode: "LIVE", lastUpdated, status: "STALE",
        notes: "OpenFootball publishes no odds. Banker slips fall back to clearly labeled model-derived fair odds.",
      },
      {
        id: "openfootball-tz",
        name: "Kickoff timezone caveat",
        kind: "fixtures", mode: "LIVE", lastUpdated,
        status: s.meta.timelessMatches > 0 ? "RECENT" : "LIVE",
        notes:
          `Published times carry no timezone; interpreted as ${s.meta.tz} (UTC${tzOffsetH >= 0 ? "+" : ""}${tzOffsetH}). ` +
          (s.meta.timelessMatches
            ? `${s.meta.timelessMatches} match(es) had no time and default to 00:00 ${s.meta.tz}.`
            : "Set OPENFOOTBALL_TZ to the dataset's local zone for accurate kickoff labels.") +
          (s.meta.missingFiles.length ? ` Not found: ${s.meta.missingFiles.length} file(s).` : ""),
      },
    ];
  },
};

function tzOffsetHours(tz: string): number {
  try {
    const parts = partsInTz(Date.now(), tz);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return (asUtc - Math.floor(Date.now() / 1000) * 1000) / 3600000;
  } catch {
    return 0;
  }
}
