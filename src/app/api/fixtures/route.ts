import { NextResponse } from "next/server";
import { getAppData } from "@/lib/service";
import { WarmingUpError } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

/** GET /api/fixtures — upcoming + recent fixtures with prediction summaries. */
export async function GET() {
  let data;
  try {
    data = await getAppData();
  } catch (e) {
    if (e instanceof WarmingUpError) {
      return NextResponse.json({ warming: true, loaded: e.loaded, total: e.total }, { status: 503 });
    }
    throw e;
  }
  const out = data.fixtures.map((f) => {
    const p = data.predictions.get(f.id);
    return {
      id: f.id,
      league: data.leagues.find((l) => l.id === f.leagueId)?.name,
      home: data.teams.find((t) => t.id === f.homeId)?.name,
      away: data.teams.find((t) => t.id === f.awayId)?.name,
      kickoff: f.kickoff,
      status: f.status,
      predictionGeneratedAt: p?.generatedAt ?? null,
      lockedAt: p?.lockedAt ?? null,
      modelVersion: p?.modelVersion ?? null,
      topEdges: p?.top3.map((m) => ({
        market: m.market.label, probability: m.probability, edgeScore: m.edgeScore,
      })) ?? [],
      demoData: data.mode === "DEMO",
    };
  });
  return NextResponse.json({ mode: data.mode, count: out.length, fixtures: out });
}
