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
    const err = e as Error;
    return NextResponse.json(
      { error: err?.name ?? "PROVIDER_ERROR", message: err?.message ?? "Unknown provider failure." },
      { status: 502 },
    );
  }
  const fx = data.fixtures.find((f) => f.id === params.id);
  if (!fx) return NextResponse.json({ error: "Fixture not found" }, { status: 404 });
  const pred = data.predictions.get(fx.id);
  const locked = pred?.lockedAt !== null && pred?.lockedAt !== undefined;
  return NextResponse.json({
    mode: data.mode,
    providerId: data.providerId,
    fixture: {
      id: fx.id, kickoff: fx.kickoff, status: fx.status,
      home: data.teams.find((t) => t.id === fx.homeId)?.name,
      away: data.teams.find((t) => t.id === fx.awayId)?.name,
      league: data.leagues.find((l) => l.id === fx.leagueId)?.name,
    },
    prediction: pred ?? null,
    lockedAtKickoff: locked,
    note:
      "Snapshot is generated strictly pre-match (generatedAt < kickoff) and locks at kickoff. " +
      (locked
        ? `Locked at ${pred!.lockedAt}; never recomputed from in-play or post-match data.`
        : "Not yet locked — kickoff is still ahead.") +
      (data.mode === "DEMO" ? " DEMO DATA." : ` LIVE data via ${data.providerId}.`),
  });
}
