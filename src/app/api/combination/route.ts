import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppData } from "@/lib/service";
import { WarmingUpError } from "@/lib/providers/types";
import { areCorrelated } from "@/lib/markets";
import { MarketGroup } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: allow slow live-data cold starts

const Body = z.object({
  legs: z.number().int().min(2).max(6),
  minProb: z.number().min(70).max(97),
  groups: z.array(z.string()).max(12),
  tier: z.number().int().min(0).max(3),
  horizonDays: z.number().int().min(1).max(7).default(3),
});

/**
 * BUILD MY SAFE COMBINATION
 * Correlation-aware accumulator builder:
 *  - max ONE selection per fixture (same-match dependency is never multiplied)
 *  - no two selections from the same correlation cluster involving a shared team
 *  - combined probability = product across distinct matches, with an explicit
 *    league-environment caveat when legs share a league
 */
export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let data;
  try {
    data = await getAppData();
  } catch (e) {
    if (e instanceof WarmingUpError) {
      return NextResponse.json({ warming: true, loaded: e.loaded, total: e.total }, { status: 503 });
    }
    throw e;
  }
  const now = Date.now();
  const horizon = now + body.horizonDays * 86400000;

  type Cand = {
    fixtureId: string; leagueId: string; match: string; kickoff: string;
    marketCode: string; marketLabel: string; group: MarketGroup;
    probability: number; edgeScore: number; odds: number | null;
    teams: string[];
  };

  const pool: Cand[] = [];
  for (const fx of data.fixtures) {
    if (fx.status !== "UPCOMING") continue;
    const ko = new Date(fx.kickoff).getTime();
    if (ko > horizon) continue;
    const lg = data.leagues.find((l) => l.id === fx.leagueId)!;
    if (body.tier && lg.tier !== body.tier) continue;
    const pred = data.predictions.get(fx.id);
    if (!pred || pred.noStrongEdge) continue;
    const home = data.teams.find((t) => t.id === fx.homeId)!;
    const away = data.teams.find((t) => t.id === fx.awayId)!;
    for (const m of pred.markets) {
      if (m.probability < body.minProb || m.dataStrength === "WEAK") continue;
      if (body.groups.length && !body.groups.includes(m.market.group)) continue;
      pool.push({
        fixtureId: fx.id, leagueId: fx.leagueId,
        match: `${home.name} v ${away.name}`, kickoff: fx.kickoff,
        marketCode: m.market.code, marketLabel: m.market.label, group: m.market.group,
        probability: m.probability, edgeScore: m.edgeScore, odds: m.odds,
        teams: [home.name, away.name],
      });
    }
  }

  pool.sort((a, b) => b.edgeScore - a.edgeScore || b.probability - a.probability);

  const picked: Cand[] = [];
  const warnings: string[] = [];
  for (const c of pool) {
    if (picked.length >= body.legs) break;
    if (picked.some((p) => p.fixtureId === c.fixtureId)) continue; // same-match dependency: excluded by design
    const sharedTeam = picked.find((p) => p.teams.some((t) => c.teams.includes(t)));
    if (sharedTeam && areCorrelated(sharedTeam.marketCode, c.marketCode)) continue;
    picked.push(c);
  }

  if (picked.length < body.legs) {
    warnings.push(`Only ${picked.length}/${body.legs} statistically compatible selections met the ≥${body.minProb}% floor. The combination was NOT padded with weaker picks.`);
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
    legs: picked,
    combinedProbability: picked.length ? Math.round(combinedProb * 1000) / 10 : null,
    combinedOdds: combinedOdds !== null ? Math.round(combinedOdds * 100) / 100 : null,
    independenceNote:
      "Legs come from distinct fixtures; same-match and same-team correlated selections are excluded before multiplying probabilities.",
    warnings,
  });
}
