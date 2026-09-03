import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppData } from "@/lib/service";
import { WarmingUpError } from "@/lib/providers/types";
import { queryFixtures } from "@/lib/repository";
import { MarketGroup } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: allow slow live-data cold starts

const Body = z.object({
  legs: z.number().int().min(2).max(6),
  minProb: z.number().min(50).max(99),
  groups: z.array(z.string()).max(12),
  tier: z.number().int().min(0).max(3),
  horizonDays: z.number().int().min(1).max(7).default(3),
  leagueId: z.string().optional(),
});

type Cand = {
  fixtureId: string; leagueId: string; match: string; kickoff: string;
  marketCode: string; marketLabel: string; group: MarketGroup;
  probability: number; edgeScore: number; odds: number | null;
  teams: [string, string];
};

/**
 * POST /api/combination — correlation-aware accumulator builder.
 *
 * Fixtures come from `queryFixtures` (the single source of truth), so the
 * builder sees exactly the same upcoming matches as the pages.
 *
 * Constraints applied while assembling:
 *  - at most ONE selection per fixture (same-match dependency is never multiplied)
 *  - NO shared team across legs (a team's environment drives both of its fixtures)
 *  - legs are never padded with picks below the requested floor
 */
export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

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
      { error: err?.name ?? "PROVIDER_ERROR", message: err?.message ?? "Unknown provider failure." },
      { status: 502 },
    );
  }

  const horizonDays = body.horizonDays >= 7 ? 7 : body.horizonDays <= 3 ? 3 : 7;
  const rows = queryFixtures(data, {
    range: horizonDays === 3 ? "3d" : "7d",
    status: "UPCOMING",
    leagueId: body.leagueId,
    tier: body.tier,
    withPrediction: true,
  });

  const pool: Cand[] = [];
  for (const row of rows) {
    const pred = row.prediction;
    if (!pred || pred.noStrongEdge) continue;
    for (const m of pred.markets) {
      if (m.probability < body.minProb || m.dataStrength === "WEAK") continue;
      if (body.groups.length && !body.groups.includes(m.market.group)) continue;
      pool.push({
        fixtureId: row.fixture.id,
        leagueId: row.league.id,
        match: `${row.homeTeam.name} v ${row.awayTeam.name}`,
        kickoff: row.kickoffIso,
        marketCode: m.market.code, marketLabel: m.market.label, group: m.market.group,
        probability: m.probability, edgeScore: m.edgeScore, odds: m.odds,
        teams: [row.homeTeam.id, row.awayTeam.id],
      });
    }
  }

  pool.sort((a, b) => b.edgeScore - a.edgeScore || b.probability - a.probability);

  const picked: Cand[] = [];
  const usedFixtures = new Set<string>();
  const usedTeams = new Set<string>();
  const rejected = { sameFixture: 0, sharedTeam: 0 };

  for (const c of pool) {
    if (picked.length >= body.legs) break;
    if (usedFixtures.has(c.fixtureId)) { rejected.sameFixture++; continue; }
    if (c.teams.some((t) => usedTeams.has(t))) { rejected.sharedTeam++; continue; }
    picked.push(c);
    usedFixtures.add(c.fixtureId);
    for (const t of c.teams) usedTeams.add(t);
  }

  const warnings: string[] = [];
  if (picked.length < body.legs) {
    warnings.push(
      `Only ${picked.length}/${body.legs} statistically compatible selections met the ≥${body.minProb}% floor ` +
      `(${rejected.sameFixture} rejected for sharing a fixture, ${rejected.sharedTeam} for sharing a team). ` +
      `The combination was NOT padded with weaker picks.`,
    );
  }
  const leagueCounts = new Map<string, number>();
  for (const p of picked) leagueCounts.set(p.leagueId, (leagueCounts.get(p.leagueId) ?? 0) + 1);
  if ([...leagueCounts.values()].some((n) => n > 1)) {
    warnings.push("⚠ CORRELATED MARKETS: multiple legs share a league environment. Independence is approximate — treat the combined figure as an upper bound.");
  }

  const combinedProb = picked.reduce((acc, p) => acc * (p.probability / 100), 1);
  const oddsLegs = picked.filter((p) => p.odds !== null);
  const combinedOdds = oddsLegs.length === picked.length && picked.length > 0
    ? picked.reduce((acc, p) => acc * (p.odds as number), 1)
    : null;

  return NextResponse.json({
    demo: data.mode === "DEMO",
    mode: data.mode,
    providerId: data.providerId,
    legs: picked,
    combinedProbability: picked.length ? Math.round(combinedProb * 1000) / 10 : null,
    combinedOdds: combinedOdds !== null ? Math.round(combinedOdds * 100) / 100 : null,
    independenceNote:
      "Legs come from distinct fixtures with no shared teams; same-match and same-team selections are excluded before probabilities are multiplied.",
    warnings,
  });
}
