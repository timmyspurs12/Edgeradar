import { NextResponse } from "next/server";
import { getAppData } from "@/lib/service";
import { WarmingUpError } from "@/lib/providers/types";
import { getBankerSlip, BANKER_MARKET_CODES, DEFAULT_MAX_LEGS, DEFAULT_MIN_PROBABILITY, DEFAULT_TARGET_ODDS } from "@/lib/banker";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: allow slow live-data cold starts

function num(sp: URLSearchParams, key: string, fallback: number): number {
  const raw = sp.get(key);
  if (raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * GET /api/two-odds — the 2.00 odds banker accumulator.
 *
 * Query params:
 *   target    combined decimal odds to reach (default 2.00)
 *   minProb   per-leg probability floor, 0–100 (default 78)
 *   legs      max legs (default 6)
 *   horizon   forward window in days: 1 | 3 | 7 (default 3)
 *   league    restrict to one league id
 *   tier      restrict to a league tier 1–3 (0 = any)
 *
 * Live-mode errors surface as 503 (warming up) or 502 (provider failure) —
 * never as an empty-but-successful payload.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;

  const targetOdds = Math.min(50, Math.max(1.01, num(sp, "target", DEFAULT_TARGET_ODDS)));
  const minProbability = Math.min(99, Math.max(50, num(sp, "minProb", DEFAULT_MIN_PROBABILITY)));
  const maxLegs = Math.min(10, Math.max(2, Math.round(num(sp, "legs", DEFAULT_MAX_LEGS))));
  const horizonRaw = Math.round(num(sp, "horizon", 3));
  const horizonDays = (horizonRaw <= 1 ? 1 : horizonRaw >= 7 ? 7 : 3) as 1 | 3 | 7;
  const tierRaw = Math.round(num(sp, "tier", 0));
  const tier = tierRaw >= 1 && tierRaw <= 3 ? tierRaw : 0;
  const leagueId = sp.get("league") ?? undefined;

  let data;
  try {
    data = await getAppData();
  } catch (e) {
    if (e instanceof WarmingUpError) {
      return NextResponse.json(
        { error: "LIVE_WARMUP", message: "Live provider is still filling its cache.", loaded: e.loaded, total: e.total },
        { status: 503 },
      );
    }
    const err = e as Error;
    return NextResponse.json(
      {
        error: err?.name ?? "PROVIDER_ERROR",
        message: err?.message ?? "Unknown provider failure.",
        note: "No synthetic data was substituted for the live feed.",
      },
      { status: 502 },
    );
  }

  const slip = getBankerSlip(data, {
    targetOdds, minProbability, maxLegs, horizonDays, leagueId, tier,
  });

  return NextResponse.json({
    mode: slip.mode,
    providerId: slip.providerId,
    marketWhitelist: BANKER_MARKET_CODES,
    rules: [
      "Only Over 1.5 Goals and 2nd Half Over 0.5 Goals are eligible.",
      "At most one selection per fixture.",
      "No two selections may share a team.",
      "Legs below the probability floor are never substituted with weaker picks.",
    ],
    query: { targetOdds, minProbability, maxLegs, horizonDays, leagueId: leagueId ?? null, tier },
    slip,
  });
}
