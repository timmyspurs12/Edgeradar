import { NextResponse } from "next/server";
import { getAppData } from "@/lib/service";
import { WarmingUpError } from "@/lib/providers/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: allow slow live-data cold starts

/** GET /api/predictions/[id] — full pre-match prediction snapshot for a fixture. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  let data;
  try {
    data = await getAppData();
  } catch (e) {
    if (e instanceof WarmingUpError) {
      return NextResponse.json({ warming: true, loaded: e.loaded, total: e.total }, { status: 503 });
    }
    throw e;
  }
  const fx = data.fixtures.find((f) => f.id === params.id);
  if (!fx) return NextResponse.json({ error: "Fixture not found" }, { status: 404 });
  const pred = data.predictions.get(fx.id);
  return NextResponse.json({
    mode: data.mode,
    fixture: {
      id: fx.id, kickoff: fx.kickoff, status: fx.status,
      home: data.teams.find((t) => t.id === fx.homeId)?.name,
      away: data.teams.find((t) => t.id === fx.awayId)?.name,
    },
    prediction: pred ?? null,
    note: "Snapshot is generated pre-match and locked at kickoff. DEMO DATA.",
  });
}
