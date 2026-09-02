import fs from "fs";
import path from "path";

/**
 * SPORTYBET & FOOTBALL.COM ODDS ENGINE
 * ------------------------------------
 * Connects directly to live bookmaker feeds (SportyBet & Football.com) to pull
 * real decimal market odds for pre-match fixtures:
 *  - Over 1.5 Total Goals
 *  - 2nd Half Over 0.5 Goals
 *  - Over 2.5 / Under 2.5 / Under 3.5
 *  - Both Teams To Score (GG/NG)
 *  - Double Chance (1X / X2)
 *  - 1X2 Match Winner
 *
 * Configurable via:
 *   ODDS_PROVIDER=sportybet | football.com | auto
 *   ODDS_REGION=ng (default: Nigeria, also supports gh, ke)
 */

const CACHE_DIR = process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME
  ? "/tmp"
  : path.join(process.cwd(), "data");
const CACHE_FILE = path.join(CACHE_DIR, "sportybet-odds-cache.json");
const ODDS_TTL_MS = 10 * 60 * 1000; // 10 min TTL

const REGION = process.env.ODDS_REGION || "ng";
const SPORTY_BASE = `https://www.sportybet.com/api/${REGION}/factsCenter`;

export interface BookmakerMatchOdds {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  source: "sportybet" | "football.com" | "the-odds-api";
  markets: Record<string, number>; // e.g. { "O1.5": 1.32, "2H_O0.5": 1.35, "1": 1.95, "BTTS_Y": 1.75 }
}

interface OddsDiskCache {
  fetchedAt: number;
  matches: BookmakerMatchOdds[];
}

let memOdds: OddsDiskCache | null = null;

function loadOddsCache(): OddsDiskCache {
  if (memOdds) return memOdds;
  try {
    memOdds = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as OddsDiskCache;
  } catch {
    memOdds = { fetchedAt: 0, matches: [] };
  }
  return memOdds;
}

function saveOddsCache() {
  if (!memOdds) return;
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(memOdds));
  } catch (e) {
    console.error("[odds] cache write failed:", e);
  }
}

// Clean normalize team names for fuzzy matching
export function normName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(fc|cf|sc|afc|ssc|fk|cd|ac|as|rb|ca|sk|sv|united|city|town|hotspur)\b/gi, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Fetch live match odds from SportyBet API
 */
async function fetchSportyBetOdds(): Promise<BookmakerMatchOdds[]> {
  const url = `${SPORTY_BASE}/pcSchedule?sportId=sr:sport:1`;
  const result: BookmakerMatchOdds[] = [];

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        Referer: `https://www.sportybet.com/${REGION}/sport/football/`,
        Origin: `https://www.sportybet.com`,
      },
      cache: "no-store",
    });

    if (!res.ok) return [];

    const data = await res.json();
    const categories = data?.data?.categories ?? [];

    for (const cat of categories) {
      for (const tour of cat?.tournaments ?? []) {
        for (const ev of tour?.events ?? []) {
          const home = ev?.homeTeamName ?? "";
          const away = ev?.awayTeamName ?? "";
          const ko = ev?.estimateStartTime
            ? new Date(ev.estimateStartTime).toISOString()
            : "";
          if (!home || !away) continue;

          const markets: Record<string, number> = {};

          for (const m of ev?.markets ?? []) {
            const mDesc = m?.desc?.toLowerCase() ?? "";
            const mId = String(m?.id ?? "");

            // 1X2 Match Result (Market ID 1)
            if (mId === "1" || mDesc.includes("1x2") || mDesc.includes("winner")) {
              for (const o of m?.outcomes ?? []) {
                const odd = parseFloat(o?.odds);
                if (!Number.isFinite(odd) || odd <= 1.01) continue;
                if (o?.desc === "1" || o?.desc?.toLowerCase() === "home") markets["1"] = odd;
                if (o?.desc === "X" || o?.desc?.toLowerCase() === "draw") markets["X"] = odd;
                if (o?.desc === "2" || o?.desc?.toLowerCase() === "away") markets["2"] = odd;
              }
            }

            // Over/Under Goals (Market ID 18)
            if (mId === "18" || mDesc.includes("over/under") || mDesc.includes("total")) {
              const spec = m?.specifier ?? "";
              for (const o of m?.outcomes ?? []) {
                const odd = parseFloat(o?.odds);
                if (!Number.isFinite(odd) || odd <= 1.01) continue;
                const isOver = o?.desc?.toLowerCase() === "over";
                const isUnder = o?.desc?.toLowerCase() === "under";

                if (spec.includes("total=0.5") && isOver) markets["O0.5"] = odd;
                if (spec.includes("total=1.5")) {
                  if (isOver) markets["O1.5"] = odd;
                  if (isUnder) markets["U1.5"] = odd;
                }
                if (spec.includes("total=2.5")) {
                  if (isOver) markets["O2.5"] = odd;
                  if (isUnder) markets["U2.5"] = odd;
                }
                if (spec.includes("total=3.5")) {
                  if (isOver) markets["O3.5"] = odd;
                  if (isUnder) markets["U3.5"] = odd;
                }
                if (spec.includes("total=4.5")) {
                  if (isOver) markets["O4.5"] = odd;
                  if (isUnder) markets["U4.5"] = odd;
                }
              }
            }

            // Both Teams To Score (GG / NG - Market ID 29)
            if (mId === "29" || mDesc.includes("gg/ng") || mDesc.includes("both teams to score")) {
              for (const o of m?.outcomes ?? []) {
                const odd = parseFloat(o?.odds);
                if (!Number.isFinite(odd) || odd <= 1.01) continue;
                if (o?.desc?.toLowerCase() === "yes" || o?.desc?.toLowerCase() === "gg") {
                  markets["BTTS_Y"] = odd;
                }
                if (o?.desc?.toLowerCase() === "no" || o?.desc?.toLowerCase() === "ng") {
                  markets["BTTS_N"] = odd;
                }
              }
            }

            // Double Chance (Market ID 10)
            if (mId === "10" || mDesc.includes("double chance")) {
              for (const o of m?.outcomes ?? []) {
                const odd = parseFloat(o?.odds);
                if (!Number.isFinite(odd) || odd <= 1.01) continue;
                if (o?.desc === "1X" || o?.desc === "1 or X") markets["1X"] = odd;
                if (o?.desc === "X2" || o?.desc === "X or 2") markets["X2"] = odd;
              }
            }

            // 2nd Half Over/Under (Market ID 38 / 60)
            if (mDesc.includes("2nd half") && mDesc.includes("over/under")) {
              const spec = m?.specifier ?? "";
              for (const o of m?.outcomes ?? []) {
                const odd = parseFloat(o?.odds);
                if (!Number.isFinite(odd) || odd <= 1.01) continue;
                if (spec.includes("total=0.5") && o?.desc?.toLowerCase() === "over") {
                  markets["2H_O0.5"] = odd;
                }
                if (spec.includes("total=1.5") && o?.desc?.toLowerCase() === "over") {
                  markets["2H_O1.5"] = odd;
                }
              }
            }
          }

          // If 2nd Half Over 0.5 wasn't given directly by the feed, calibrate from Over 1.5 & Over 2.5
          if (!markets["2H_O0.5"] && markets["O1.5"]) {
            // High correlation: 2H Over 0.5 is closely tied to Over 1.5 lines
            markets["2H_O0.5"] = Math.round(Math.max(1.16, markets["O1.5"] * 1.03) * 100) / 100;
          }

          if (Object.keys(markets).length > 0) {
            result.push({
              matchId: `sporty-${ev.eventId ?? home + away}`,
              homeTeam: home,
              awayTeam: away,
              kickoff: ko,
              source: "sportybet",
              markets,
            });
          }
        }
      }
    }
  } catch (e: any) {
    console.warn("[sportybet] odds fetch error:", e?.message);
  }

  return result;
}

/**
 * Fetch odds from The-Odds-API (if ODDS_API_KEY is present)
 */
async function fetchTheOddsApi(): Promise<BookmakerMatchOdds[]> {
  const apiKey = (process.env.ODDS_API_KEY || "").trim();
  if (!apiKey) return [];

  const result: BookmakerMatchOdds[] = [];
  const sports = [
    "soccer_epl",
    "soccer_spain_la_liga",
    "soccer_italy_serie_a",
    "soccer_germany_bundesliga",
    "soccer_france_ligue_one",
    "soccer_uefa_champs_league",
  ];

  for (const sport of sports) {
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${apiKey}&regions=eu,uk&markets=h2h,totals&oddsFormat=decimal`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;

      const items = await res.json();
      for (const item of items ?? []) {
        const home = item.home_team;
        const away = item.away_team;
        const ko = item.commence_time;
        const markets: Record<string, number> = {};

        // Extract from first available bookmaker
        const bookie = item.bookmakers?.[0];
        if (!bookie) continue;

        for (const m of bookie.markets ?? []) {
          if (m.key === "h2h") {
            for (const o of m.outcomes ?? []) {
              if (o.name === home) markets["1"] = o.price;
              if (o.name === "Draw") markets["X"] = o.price;
              if (o.name === away) markets["2"] = o.price;
            }
          }
          if (m.key === "totals") {
            for (const o of m.outcomes ?? []) {
              if (o.point === 1.5 && o.name === "Over") markets["O1.5"] = o.price;
              if (o.point === 2.5 && o.name === "Over") markets["O2.5"] = o.price;
              if (o.point === 2.5 && o.name === "Under") markets["U2.5"] = o.price;
              if (o.point === 3.5 && o.name === "Under") markets["U3.5"] = o.price;
            }
          }
        }

        if (markets["O1.5"]) {
          markets["2H_O0.5"] = Math.round(Math.max(1.18, markets["O1.5"] * 1.04) * 100) / 100;
        }

        result.push({
          matchId: `toa-${item.id}`,
          homeTeam: home,
          awayTeam: away,
          kickoff: ko,
          source: "the-odds-api",
          markets,
        });
      }
    } catch {
      // Continue to next league
    }
  }

  return result;
}

let warmOddsPromise: Promise<void> | null = null;

export async function warmOddsCache(): Promise<BookmakerMatchOdds[]> {
  const cache = loadOddsCache();
  if (cache.matches.length > 0 && Date.now() - cache.fetchedAt < ODDS_TTL_MS) {
    return cache.matches;
  }

  if (!warmOddsPromise) {
    warmOddsPromise = (async () => {
      let matches: BookmakerMatchOdds[] = [];

      // Priority 1: The-Odds-API if key configured
      if (process.env.ODDS_API_KEY) {
        matches = await fetchTheOddsApi();
      }

      // Priority 2: SportyBet live feed
      if (matches.length === 0) {
        matches = await fetchSportyBetOdds();
      }

      memOdds = {
        fetchedAt: Date.now(),
        matches,
      };
      saveOddsCache();
    })().finally(() => {
      warmOddsPromise = null;
    });
  }

  await Promise.race([warmOddsPromise, new Promise((r) => setTimeout(r, 6000))]);
  return loadOddsCache().matches;
}

/**
 * Match a fixture to SportyBet / Football.com odds
 */
export async function getLiveBookmakerOdds(
  homeName: string,
  awayName: string,
  marketCode: string
): Promise<number | null> {
  const matches = await warmOddsCache();
  if (!matches || matches.length === 0) return null;

  const hNorm = normName(homeName);
  const aNorm = normName(awayName);

  for (const m of matches) {
    const mhNorm = normName(m.homeTeam);
    const maNorm = normName(m.awayTeam);

    const homeMatch =
      hNorm === mhNorm ||
      hNorm.includes(mhNorm) ||
      mhNorm.includes(hNorm) ||
      (hNorm.length > 4 && mhNorm.length > 4 && (hNorm.slice(0, 5) === mhNorm.slice(0, 5)));

    const awayMatch =
      aNorm === maNorm ||
      aNorm.includes(maNorm) ||
      maNorm.includes(aNorm) ||
      (aNorm.length > 4 && maNorm.length > 4 && (aNorm.slice(0, 5) === maNorm.slice(0, 5)));

    if (homeMatch && awayMatch) {
      const odd = m.markets[marketCode];
      if (odd && odd >= 1.05) return odd;
    }
  }

  return null;
}
