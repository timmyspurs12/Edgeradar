import { FootballDataProvider } from "./types";
import { demoProvider } from "./demo";
import { footballDataProvider } from "./footballdata";
import { apiFootballProvider } from "./apifootball";

/**
 * Provider registry — demo and live data are NEVER mixed.
 *
 * Selection logic:
 *   DATA_PROVIDER=demo            → demo provider (synthetic, labeled DEMO)
 *   DATA_PROVIDER=api-football    → API-Football (requires APIFOOTBALL_KEY)
 *   DATA_PROVIDER=football-data   → football-data.org (requires FOOTBALL_DATA_API_KEY)
 *   DATA_PROVIDER unset           → auto: API-Football if its key exists,
 *                                   else football-data.org if its key exists,
 *                                   else demo.
 *
 * i.e. dropping a key into .env.local and restarting is all it takes.
 */
export function getProvider(): FootballDataProvider {
  const which = (process.env.DATA_PROVIDER || "").trim().toLowerCase();
  const hasAf = !!(process.env.APIFOOTBALL_KEY || "").trim();
  const hasFdo = !!(process.env.FOOTBALL_DATA_API_KEY || "").trim();

  if (which === "demo") return demoProvider;
  if (which === "api-football" || which === "apifootball") {
    if (!hasAf) throw new Error("DATA_PROVIDER=api-football but APIFOOTBALL_KEY is missing in environment variables. Add APIFOOTBALL_KEY in Vercel Settings → Environment Variables.");
    return apiFootballProvider;
  }
  if (which === "football-data" || which === "footballdata") {
    if (!hasFdo) throw new Error("DATA_PROVIDER=football-data but FOOTBALL_DATA_API_KEY is missing in environment variables. Add FOOTBALL_DATA_API_KEY in Vercel Settings → Environment Variables.");
    return footballDataProvider;
  }
  if (which) {
    throw new Error(`DATA_PROVIDER="${which}" is not registered. Implement FootballDataProvider and register it in src/lib/providers/index.ts.`);
  }
  if (hasAf) return apiFootballProvider;
  if (hasFdo) return footballDataProvider;
  return demoProvider;
}
