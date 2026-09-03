import { NextResponse } from "next/server";
import { getAppData } from "@/lib/service";
import { WarmingUpError } from "@/lib/providers/types";
import { queryFixtures, FixtureRange, StatusFilter, summarizeFixtures } from "@/lib/repository";
import { displayTz, tzAbbreviation } from "@/lib/time";
import { fmtDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: allow slow live-data cold starts

const RANGES: FixtureRange[] = ["today", "tomorrow", "3d", "7d", "all", "finished"];
const STATUSES: StatusFilter[] = ["UPCOMING", "LIVE", "FINISHED", "ALL"];

/**
 * GET /api/fixtures — fixtures with prediction summaries.
 *
 * Reads through `queryFixtures`, so the API and the pages can never disagree
 * about what "today" means or which statuses are visible.
 *
 * Query params: range (today|tomorrow|3d|7d|all|finished), status
 * (UPCOMING|LIVE|FINISHED|ALL), league, tier, conf, q.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const rangeRaw = sp.get("range");
  const range: FixtureRange = RANGES.includes(rangeRaw as FixtureRange) ? (rangeRaw as FixtureRange) : "3d";
  const statusRaw = sp.get("status");
  const status: StatusFilter = STATUSES.includes(statusRaw as StatusFilter) ? (statusRaw as StatusFilter) : "ALL";
  const tierRaw = Number(sp.get("tier") ?? 0);
  const tier = Number.isFinite(tierRaw) && tierRaw >= 1 && tierRaw <= 3 ? tierRaw : 0;
  const confRaw = Number(sp.get("conf") ?? 0);
  const minConfidence = Number.isFinite(confRaw) ? Math.min(99, Math.max(0, confRaw)) : 0;

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
      { error: err?.name ?? "PROVIDER_ERROR", message: err?.message ?? "Unknown provider failure.", note: "No synthetic data was substituted for the live feed." },
      { status: 502 },
    );
  }

  const now = Date.now();
  const timezone = displayTz();
  const rows = queryFixtures(data, {
    range, status, leagueId: sp.get("league") ?? undefined, tier, minConfidence,
    searchQuery: sp.get("q") ?? "", timezone, now,
  });

  return NextResponse.json({
    mode: data.mode,
    providerId: data.providerId,
    timezone,
    timezoneLabel: tzAbbreviation(timezone),
    builtAt: data.builtAt,
    query: { range, status, league: sp.get("league") ?? null, tier, minConfidence, q: sp.get("q") ?? "" },
    summary: summarizeFixtures(data, now),
    count: rows.length,
    fixtures: rows.map((r) => ({
      id: r.fixture.id,
      league: r.league.name,
      country: r.league.country,
      tier: r.league.tier,
      home: r.homeTeam.name,
      away: r.awayTeam.name,
      kickoff: r.kickoffIso,             // UTC, normalized
      kickoffLocal: fmtDateTime(r.kickoffIso, timezone), // display-timezone label
      dayKey: r.dayKey,                  // YYYY-MM-DD in the display timezone
      status: r.fixture.status,
      isLocked: r.isLocked,
      predictionGeneratedAt: r.prediction?.generatedAt ?? null,
      lockedAt: r.prediction?.lockedAt ?? null,
      modelVersion: r.prediction?.modelVersion ?? null,
      matchConfidence: r.prediction?.matchConfidence ?? null,
      topEdges: r.prediction?.top3.map((m) => ({
        market: m.market.label, code: m.market.code,
        probability: m.probability, edgeScore: m.edgeScore,
      })) ?? [],
      demoData: data.mode === "DEMO",
    })),
  });
}
