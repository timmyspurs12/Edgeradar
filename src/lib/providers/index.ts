import { FootballDataProvider } from "./types";
import { demoProvider } from "./demo";
import { footballDataProvider } from "./footballdata";

/**
 * Provider registry — demo and live data are NEVER mixed.
 *
 * Selection logic:
 *   DATA_PROVIDER=demo            → demo provider (synthetic, labeled DEMO)
 *   DATA_PROVIDER=football-data   → football-data.org (requires FOOTBALL_DATA_API_KEY)
 *   DATA_PROVIDER unset           → football-data.org IF a key is present, else demo
 *
 * i.e. dropping FOOTBALL_DATA_API_KEY into .env.local and restarting is all it
 * takes to switch the whole app to live data (strict live-only league list).
 */
export function getProvider(): FootballDataProvider {
  const which = process.env.DATA_PROVIDER;
  const hasKey = !!process.env.FOOTBALL_DATA_API_KEY;

  if (which === "demo") return demoProvider;
  if (which === "football-data") {
    if (!hasKey) {
      throw new Error(
        "DATA_PROVIDER=football-data but FOOTBALL_DATA_API_KEY is missing. Add the key to .env.local (server-side only) — get a free key at football-data.org/client/register."
      );
    }
    return footballDataProvider;
  }
  if (which && which !== "football-data") {
    throw new Error(
      `DATA_PROVIDER="${which}" is not registered. Implement FootballDataProvider and register it in src/lib/providers/index.ts.`
    );
  }
  return hasKey ? footballDataProvider : demoProvider;
}
