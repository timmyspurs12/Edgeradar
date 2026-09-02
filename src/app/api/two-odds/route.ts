import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppData } from "@/lib/service";
import { WarmingUpError } from "@/lib/providers/types";
import { areCorrelated } from "@/lib/markets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const QuerySchema = z.object({
  minProb: z.number().min(75).max(98).default(80),
  targetOdds: z.number().min(1.5).max(4.0).default(2.0),
  horizonDays: z.number().int().min(1).max(7).default(3),
  tier: z.number().int().min(0).max(3).default(0),
  markets: z.array(z.enum(["O1.5", "2H_O0.5"])).min(1).default(["O1.5", "2H_O0.5"]),
});

export interface BankerCandidate {
  fixtureId: string;
  leagueId: string;
  leagueName: string;
  country: string;
  match: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  marketCode: "O1.5" | "2H_O0.5";
  marketLabel: string;
  probability: number;
  edgeScore: number;
  odds: number;
  isLiveOdds: boolean;
  sampleSize: number;
  seasonHits: number;
  seasonTotal: number;
  explanation: string[];
}

export interface BankerSlip {
  id: string;
  title: string;
  description: string;
  legs: BankerCandidate[];
  totalOdds: number;
  combinedProbability: number;
  expectedValue: number; // expected return percentage based on probability * odds
  warnings: string[];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const minProb = Number(url.searchParams.get("minProb") ?? 80);
  const targetOdds = Number(url.searchParams.get("targetOdds") ?? 2.0);
  const horizonDays = Number(url.searchParams.get("horizonDays") ?? 3);
  const tier = Number(url.searchParams.get("tier") ?? 0);
  const marketsParam = url.searchParams.get("markets");
  const markets: ("O1.5" | "2H_O0.5")[] = marketsParam
    ? (marketsParam.split(",").filter((m) => m === "O1.5" || m === "2H_O0.5") as ("O1.5" | "2H_O0.5")[])
    : ["O1.5", "2H_O0.5"];

  return handleCalculation({ minProb, targetOdds, horizonDays, tier, markets });
}

export async function POST(req: Request) {
  let body: z.infer<typeof QuerySchema>;
  try {
    const json = await req.json();
    body = QuerySchema.parse(json);
  } catch {
    body = { minProb: 80, targetOdds: 2.0, horizonDays: 3, tier: 0, markets: ["O1.5", "2H_O0.5"] };
  }

  return handleCalculation(body);
}

async function handleCalculation(params: {
  minProb: number;
  targetOdds: number;
  horizonDays: number;
  tier: number;
  markets: ("O1.5" | "2H_O0.5")[];
}) {
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
  const horizon = now + params.horizonDays * 86400000;

  const candidates: BankerCandidate[] = [];

  for (const fx of data.fixtures) {
    if (fx.status !== "UPCOMING") continue;
    const ko = new Date(fx.kickoff).getTime();
    if (ko > horizon || ko <= now) continue;

    const lg = data.leagues.find((l) => l.id === fx.leagueId);
    if (!lg) continue;
    if (params.tier && lg.tier !== params.tier) continue;

    const pred = data.predictions.get(fx.id);
    if (!pred || pred.noStrongEdge) continue;

    const home = data.teams.find((t) => t.id === fx.homeId);
    const away = data.teams.find((t) => t.id === fx.awayId);
    if (!home || !away) continue;

    for (const m of pred.markets) {
      if (!params.markets.includes(m.market.code as "O1.5" | "2H_O0.5")) continue;
      if (m.probability < params.minProb || m.dataStrength === "WEAK") continue;

      // Calculate realistic bookmaker/fair odds if provider does not supply live odds or if demo odds are out of realistic bounds for >80% markets
      let calculatedOdds: number;
      let isLiveOdds = false;
      const fairDecimal = 1 / (m.probability / 100);
      const marginFactor = m.market.code === "O1.5" ? 0.94 : 0.92;
      const modelOdds = Math.round(Math.max(1.18, fairDecimal / marginFactor) * 100) / 100;

      if (m.odds !== null && m.odds >= 1.05 && m.odds <= 1.85) {
        calculatedOdds = m.odds;
        isLiveOdds = true;
      } else {
        calculatedOdds = modelOdds;
      }

      candidates.push({
        fixtureId: fx.id,
        leagueId: fx.leagueId,
        leagueName: lg.name,
        country: lg.country,
        match: `${home.name} vs ${away.name}`,
        homeTeam: home.name,
        awayTeam: away.name,
        kickoff: fx.kickoff,
        marketCode: m.market.code as "O1.5" | "2H_O0.5",
        marketLabel: m.market.label,
        probability: m.probability,
        edgeScore: m.edgeScore,
        odds: calculatedOdds,
        isLiveOdds,
        sampleSize: m.sampleSize,
        seasonHits: m.seasonHits,
        seasonTotal: m.seasonTotal,
        explanation: m.explanation,
      });
    }
  }

  // Sort candidates by highest probability then highest edge score
  candidates.sort((a, b) => b.probability - a.probability || b.edgeScore - a.edgeScore);

  // Helper to build a banker combination
  function buildSlip(
    pool: BankerCandidate[],
    title: string,
    description: string,
    target: number = params.targetOdds
  ): BankerSlip {
    const picked: BankerCandidate[] = [];
    const warnings: string[] = [];
    let currentOdds = 1.0;

    for (const cand of pool) {
      // Rule 1: No two picks from the same match
      if (picked.some((p) => p.fixtureId === cand.fixtureId)) continue;
      // Rule 2: No same team overlap
      if (picked.some((p) => p.homeTeam === cand.homeTeam || p.awayTeam === cand.awayTeam || p.homeTeam === cand.awayTeam || p.awayTeam === cand.homeTeam)) continue;

      picked.push(cand);
      currentOdds = currentOdds * cand.odds;

      // Minimum 2 legs for any double/accumulator
      if (picked.length >= 2 && (currentOdds >= target * 0.95 || picked.length >= 4)) {
        break;
      }
    }

    const finalOdds = Math.round(currentOdds * 100) / 100;
    const combinedProb = picked.length
      ? Math.round(picked.reduce((acc, p) => acc * (p.probability / 100), 1) * 1000) / 10
      : 0;

    const expectedValue = combinedProb > 0
      ? Math.round(((combinedProb / 100) * finalOdds - 1) * 1000) / 10
      : 0;

    if (picked.length < 2) {
      warnings.push("Fewer than 2 independent matches met the high-confidence ≥80% floor in this timeframe.");
    }

    return {
      id: `slip-${title.toLowerCase().replace(/\s+/g, "-")}`,
      title,
      description,
      legs: picked,
      totalOdds: finalOdds,
      combinedProbability: combinedProb,
      expectedValue,
      warnings,
    };
  }

  // Generate 3 distinct curated slips:
  // 1. AI Primary Banker (Mix of highest prob Over 1.5 and 2H Over 0.5)
  const optimalSlip = buildSlip(
    candidates,
    "AI Optimal 2.00 Odds Double",
    "Highest-probability 2-leg combination across both Over 1.5 and 2nd Half Over 0.5 markets.",
    params.targetOdds
  );

  // 2. Over 1.5 Goals Only Double
  const over15Candidates = candidates.filter((c) => c.marketCode === "O1.5");
  const over15Slip = buildSlip(
    over15Candidates,
    "Over 1.5 Goals 2.00 Odds Banker",
    "Restricted exclusively to high-confidence Over 1.5 Total Goals selections.",
    params.targetOdds
  );

  // 3. 2nd Half Over 0.5 Goals Only Double
  const shCandidates = candidates.filter((c) => c.marketCode === "2H_O0.5");
  const secondHalfSlip = buildSlip(
    shCandidates,
    "2nd Half Goal 2.00 Odds Banker",
    "Restricted exclusively to 2nd Half Over 0.5 Goal selections (late goal frequency model).",
    params.targetOdds
  );

  return NextResponse.json({
    providerMode: data.mode,
    providerName: data.providerName,
    filters: params,
    summary: {
      totalCandidates: candidates.length,
      over15Count: over15Candidates.length,
      secondHalfCount: shCandidates.length,
      avgCandidateProbability: candidates.length
        ? Math.round((candidates.reduce((s, c) => s + c.probability, 0) / candidates.length) * 10) / 10
        : 0,
    },
    slips: [optimalSlip, over15Slip, secondHalfSlip],
    candidates,
  });
}
