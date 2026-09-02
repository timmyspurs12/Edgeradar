"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Panel, SectionTitle, ProbBar } from "@/components/ui";

interface BankerCandidate {
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

interface BankerSlip {
  id: string;
  title: string;
  description: string;
  legs: BankerCandidate[];
  totalOdds: number;
  combinedProbability: number;
  expectedValue: number;
  warnings: string[];
}

interface ApiResponse {
  providerMode: "DEMO" | "LIVE";
  providerName: string;
  summary: {
    totalCandidates: number;
    over15Count: number;
    secondHalfCount: number;
    avgCandidateProbability: number;
  };
  slips: BankerSlip[];
  candidates: BankerCandidate[];
}

export default function TwoOddsPage() {
  const [minProb, setMinProb] = useState(80);
  const [targetOdds, setTargetOdds] = useState(2.0);
  const [horizonDays, setHorizonDays] = useState(3);
  const [marketFilter, setMarketFilter] = useState<"ALL" | "O1.5" | "2H_O0.5">("ALL");
  const [tier, setTier] = useState(0);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState("");
  const [selectedLegs, setSelectedLegs] = useState<string[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const markets =
        marketFilter === "ALL"
          ? "O1.5,2H_O0.5"
          : marketFilter;
      const res = await fetch(
        `/api/two-odds?minProb=${minProb}&targetOdds=${targetOdds}&horizonDays=${horizonDays}&tier=${tier}&markets=${markets}`
      );
      if (res.status === 503) {
        setError("Live provider is still warming cache. Refreshing in a moment...");
        return;
      }
      if (!res.ok) throw new Error("Failed to load 2.00 odds data");
      const json: ApiResponse = await res.json();
      setData(json);

      // Default selected legs from the first slip
      if (json.slips && json.slips[0] && json.slips[0].legs.length > 0) {
        setSelectedLegs(json.slips[0].legs.map((l) => `${l.fixtureId}-${l.marketCode}`));
      }
    } catch (err: any) {
      setError(err?.message || "Could not fetch banker odds data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [minProb, targetOdds, horizonDays, marketFilter, tier]);

  const toggleLeg = (cand: BankerCandidate) => {
    const key = `${cand.fixtureId}-${cand.marketCode}`;
    setSelectedLegs((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  // Compute live custom slip stats based on user's manual checkboxes
  const customLegs = (data?.candidates ?? []).filter((c) =>
    selectedLegs.includes(`${c.fixtureId}-${c.marketCode}`)
  );
  const customOdds = customLegs.reduce((acc, l) => acc * l.odds, 1);
  const customProb = customLegs.length
    ? customLegs.reduce((acc, l) => acc * (l.probability / 100), 1) * 100
    : 0;

  const copySlip = (slip: BankerSlip) => {
    const text = `🎯 EdgeRadar 2.00 Odds Banker Slip:\n` +
      slip.legs
        .map(
          (l, i) =>
            `${i + 1}. ${l.match} — ${l.marketLabel} (${l.probability.toFixed(1)}% Conf, @${l.odds.toFixed(2)})`
        )
        .join("\n") +
      `\n\n📊 Total Odds: ${slip.totalOdds.toFixed(2)}\n⚡ Win Probability: ${slip.combinedProbability.toFixed(1)}%\n🔒 Pre-Match EdgeRadar AI`;
    navigator.clipboard.writeText(text);
    setCopiedId(slip.id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] px-2 py-0.5 rounded-sm border border-acc/40 text-acc bg-acc/10 tracking-widest uppercase">
              AI Banker Engine
            </span>
            <span className="font-mono text-[10px] text-mut">80% – 100% CONFIDENCE ONLY</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight mt-1" style={{ fontStretch: "120%" }}>
            2.00 ODDS BANKER COMBINATIONS
          </h1>
          <p className="text-[13px] text-sec max-w-3xl mt-1 leading-relaxed">
            High-probability double and treble accumulators strictly filtered for the two highest-frequency statistical football markets:{" "}
            <span className="text-acc font-mono">Over 1.5 Total Goals</span> and{" "}
            <span className="text-acc font-mono">2nd Half Over 0.5 Goals</span>.
          </p>
        </div>

        <div className="font-mono text-[10px] text-mut text-right">
          <div>DATA PROVIDER: <span className="text-fg">{data?.providerName ?? "Auto"}</span></div>
          <div>MODE: <span className="text-acc">{data?.providerMode ?? "LIVE"}</span></div>
          <div>TIMES IN: <span className="text-sec">Africa/Lagos (WAT)</span></div>
        </div>
      </div>

      {/* Control Panel / Strategy Selector */}
      <Panel corner className="p-4 bg-surface2/40 border-edge">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Timeframe */}
          <div>
            <label className="block font-mono text-[9px] tracking-widest text-mut mb-1">
              TIMEFRAME
            </label>
            <select
              value={horizonDays}
              onChange={(e) => setHorizonDays(Number(e.target.value))}
              className="w-full bg-surface border border-edge rounded px-2.5 py-1.5 text-[12px] font-mono text-sec focus:border-acc/50 focus:outline-none"
            >
              <option value={1}>Today Only</option>
              <option value={2}>Today & Tomorrow</option>
              <option value={3}>Next 3 Days</option>
              <option value={7}>Next 7 Days</option>
            </select>
          </div>

          {/* Confidence Floor */}
          <div>
            <label className="block font-mono text-[9px] tracking-widest text-mut mb-1">
              MIN CONFIDENCE: <span className="text-acc font-semibold">{minProb}%</span>
            </label>
            <select
              value={minProb}
              onChange={(e) => setMinProb(Number(e.target.value))}
              className="w-full bg-surface border border-edge rounded px-2.5 py-1.5 text-[12px] font-mono text-sec focus:border-acc/50 focus:outline-none"
            >
              <option value={80}>≥ 80% (High Confidence)</option>
              <option value={83}>≥ 83% (Very High)</option>
              <option value={86}>≥ 86% (Extreme Safety)</option>
              <option value={90}>≥ 90% (Ultra Banker)</option>
            </select>
          </div>

          {/* Target Odds */}
          <div>
            <label className="block font-mono text-[9px] tracking-widest text-mut mb-1">
              TARGET ODDS: <span className="text-fg font-semibold">{targetOdds.toFixed(2)}</span>
            </label>
            <select
              value={targetOdds}
              onChange={(e) => setTargetOdds(Number(e.target.value))}
              className="w-full bg-surface border border-edge rounded px-2.5 py-1.5 text-[12px] font-mono text-sec focus:border-acc/50 focus:outline-none"
            >
              <option value={1.8}>1.80 Odds (Ultra Safe Double)</option>
              <option value={2.0}>2.00 Odds (Standard Double)</option>
              <option value={2.2}>2.20 Odds (Value Double)</option>
              <option value={2.5}>2.50 Odds (Aggressive Double/Treble)</option>
            </select>
          </div>

          {/* Market Types */}
          <div>
            <label className="block font-mono text-[9px] tracking-widest text-mut mb-1">
              ALLOWED MARKETS
            </label>
            <select
              value={marketFilter}
              onChange={(e) => setMarketFilter(e.target.value as any)}
              className="w-full bg-surface border border-edge rounded px-2.5 py-1.5 text-[12px] font-mono text-sec focus:border-acc/50 focus:outline-none"
            >
              <option value="ALL">Over 1.5 + 2nd Half Goal</option>
              <option value="O1.5">Over 1.5 Goals Only</option>
              <option value="2H_O0.5">2nd Half Over 0.5 Only</option>
            </select>
          </div>

          {/* League Tier */}
          <div>
            <label className="block font-mono text-[9px] tracking-widest text-mut mb-1">
              LEAGUE TIER
            </label>
            <select
              value={tier}
              onChange={(e) => setTier(Number(e.target.value))}
              className="w-full bg-surface border border-edge rounded px-2.5 py-1.5 text-[12px] font-mono text-sec focus:border-acc/50 focus:outline-none"
            >
              <option value={0}>All Leagues</option>
              <option value={1}>Tier 1 Majors Only</option>
              <option value={2}>Tier 1 & Tier 2</option>
            </select>
          </div>
        </div>
      </Panel>

      {/* Summary KPI Badges */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Panel corner className="p-3">
            <div className="font-mono text-[9px] tracking-widest text-mut uppercase">
              Qualified 80%+ Selections
            </div>
            <div className="font-mono text-2xl font-semibold tabular-nums mt-1 text-fg">
              {data.summary.totalCandidates}
            </div>
            <div className="font-mono text-[10px] text-sec mt-0.5">
              {data.summary.over15Count} Over 1.5 · {data.summary.secondHalfCount} 2H Goal
            </div>
          </Panel>

          <Panel corner className="p-3">
            <div className="font-mono text-[9px] tracking-widest text-mut uppercase">
              Avg Selection Confidence
            </div>
            <div className="font-mono text-2xl font-semibold tabular-nums mt-1 text-acc">
              {data.summary.avgCandidateProbability.toFixed(1)}%
            </div>
            <div className="font-mono text-[10px] text-sec mt-0.5">
              Bayesian shrunk probability
            </div>
          </Panel>

          <Panel corner className="p-3">
            <div className="font-mono text-[9px] tracking-widest text-mut uppercase">
              Top Double Win Prob
            </div>
            <div className="font-mono text-2xl font-semibold tabular-nums mt-1 text-acc">
              {data.slips[0]?.combinedProbability
                ? `${data.slips[0].combinedProbability.toFixed(1)}%`
                : "—"}
            </div>
            <div className="font-mono text-[10px] text-sec mt-0.5">
              vs ~48% on random 2.00 bets
            </div>
          </Panel>

          <Panel corner className="p-3">
            <div className="font-mono text-[9px] tracking-widest text-mut uppercase">
              Anti-Correlation Guard
            </div>
            <div className="font-mono text-2xl font-semibold tabular-nums mt-1 text-fg">
              ACTIVE
            </div>
            <div className="font-mono text-[10px] text-acc mt-0.5">
              1 pick / match strictly enforced
            </div>
          </Panel>
        </div>
      )}

      {loading && (
        <Panel className="p-10 text-center font-mono text-[12px] text-mut">
          <div className="animate-pulse">EVALUATING HIGH-PROBABILITY PRE-MATCH EDGES…</div>
        </Panel>
      )}

      {error && (
        <Panel className="p-4 border-bad/50 bg-bad/10 text-bad font-mono text-[12px]">
          {error}
        </Panel>
      )}

      {/* Recommended 2.00 Odds Slips */}
      {!loading && data && data.slips && (
        <div>
          <SectionTitle>Recommended AI 2.00 Odds Slips</SectionTitle>
          <div className="grid md:grid-cols-3 gap-3">
            {data.slips.map((slip, idx) => (
              <Panel
                key={slip.id}
                corner
                className={`p-4 flex flex-col justify-between border ${
                  idx === 0
                    ? "border-acc/60 bg-surface shadow-[0_0_15px_rgba(200,241,53,0.07)]"
                    : "border-edge bg-surface"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-mono text-[10px] tracking-wider text-acc font-bold uppercase">
                      {idx === 0 ? "👑 " : ""} {slip.title}
                    </span>
                    <span className="font-mono text-[11px] font-bold text-fg bg-surface2 px-2 py-0.5 rounded border border-edge tabular-nums">
                      @{slip.totalOdds.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-[11px] text-sec mb-3 leading-snug">{slip.description}</p>

                  {/* Legs */}
                  <div className="space-y-2 border-t border-edge/60 pt-3">
                    {slip.legs.map((leg, lIdx) => (
                      <div
                        key={lIdx}
                        className="bg-surface2/60 border border-edge/40 rounded p-2 text-[12px]"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-fg truncate">{leg.match}</span>
                          <span className="font-mono text-[11px] text-acc tabular-nums font-semibold ml-2">
                            {leg.probability.toFixed(0)}%
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-mut mt-0.5">
                          <span className="text-sec font-mono">{leg.marketLabel}</span>
                          <span className="font-mono text-fg">@{leg.odds.toFixed(2)}</span>
                        </div>
                        <div className="font-mono text-[9px] text-mut mt-1 truncate">
                          {leg.leagueName} ·{" "}
                          {new Date(leg.kickoff).toLocaleDateString("en-GB", {
                            weekday: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "Africa/Lagos",
                          })}{" "}
                          WAT
                        </div>
                      </div>
                    ))}

                    {slip.legs.length === 0 && (
                      <div className="font-mono text-[11px] text-mut text-center py-4">
                        No matches met the ≥{minProb}% criteria in this window.
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-edge">
                  <div className="flex items-center justify-between font-mono text-[11px] mb-3">
                    <span className="text-mut">WIN PROBABILITY:</span>
                    <span className="text-acc font-bold tabular-nums">
                      {slip.combinedProbability.toFixed(1)}%
                    </span>
                  </div>

                  <button
                    onClick={() => copySlip(slip)}
                    disabled={slip.legs.length === 0}
                    className="w-full font-mono text-[11px] tracking-wider py-2 rounded border border-acc/60 text-acc hover:bg-acc hover:text-ink transition-colors disabled:opacity-40"
                  >
                    {copiedId === slip.id ? "✓ COPIED TO CLIPBOARD" : "COPY COMBINATION SLIP"}
                  </button>
                </div>
              </Panel>
            ))}
          </div>
        </div>
      )}

      {/* Interactive Custom Acca Builder */}
      {!loading && data && data.candidates.length > 0 && (
        <div>
          <SectionTitle right={<span className="font-mono text-[10px] text-sec">{data.candidates.length} Qualified Picks</span>}>
            Interactive Custom 2.00 Slip Builder
          </SectionTitle>
          <Panel corner className="p-4 bg-surface">
            <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-edge">
              <div>
                <div className="text-[13px] font-semibold text-fg">Custom Slip Real-Time Stats</div>
                <div className="text-[11px] text-mut">
                  Check or uncheck qualified matches below to build your own custom combination.
                </div>
              </div>
              <div className="flex items-center gap-6 font-mono text-right">
                <div>
                  <div className="text-[9px] text-mut tracking-widest">SELECTED PICKS</div>
                  <div className="text-lg font-bold text-fg">{customLegs.length}</div>
                </div>
                <div>
                  <div className="text-[9px] text-mut tracking-widest">COMBINED ODDS</div>
                  <div className="text-lg font-bold text-acc tabular-nums">
                    @{customOdds.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] text-mut tracking-widest">EST. WIN CHANCE</div>
                  <div className="text-lg font-bold text-fg tabular-nums">
                    {customProb.toFixed(1)}%
                  </div>
                </div>
              </div>
            </div>

            {/* Candidates Table */}
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-[12px] min-w-[700px]">
                <thead>
                  <tr className="border-b border-edge font-mono text-[9px] tracking-widest text-mut text-left uppercase">
                    <th className="px-2 py-2 font-normal w-10">ADD</th>
                    <th className="px-3 py-2 font-normal">MATCH & LEAGUE</th>
                    <th className="px-3 py-2 font-normal">KICKOFF (WAT)</th>
                    <th className="px-3 py-2 font-normal">MARKET</th>
                    <th className="px-3 py-2 font-normal text-right">ODDS</th>
                    <th className="px-3 py-2 font-normal text-right">PROBABILITY</th>
                    <th className="px-3 py-2 font-normal text-right">EDGE SCORE</th>
                  </tr>
                </thead>
                <tbody>
                  {data.candidates.map((cand) => {
                    const isSelected = selectedLegs.includes(
                      `${cand.fixtureId}-${cand.marketCode}`
                    );
                    return (
                      <tr
                        key={`${cand.fixtureId}-${cand.marketCode}`}
                        onClick={() => toggleLeg(cand)}
                        className={`border-b border-edge/40 cursor-pointer transition-colors ${
                          isSelected ? "bg-acc/5 hover:bg-acc/10" : "hover:bg-surface2/60"
                        }`}
                      >
                        <td className="px-2 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleLeg(cand)}
                            className="accent-[#C8F135] cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <Link
                            href={`/match/${cand.fixtureId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-medium hover:text-acc"
                          >
                            {cand.match}
                          </Link>
                          <div className="font-mono text-[9px] text-mut">
                            {cand.country} — {cand.leagueName}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-sec tabular-nums whitespace-nowrap">
                          {new Date(cand.kickoff).toLocaleDateString("en-GB", {
                            weekday: "short",
                            day: "2-digit",
                            month: "short",
                            timeZone: "Africa/Lagos",
                          })}{" "}
                          ·{" "}
                          <span className="text-fg">
                            {new Date(cand.kickoff).toLocaleTimeString("en-GB", {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: "Africa/Lagos",
                            })}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${
                              cand.marketCode === "O1.5"
                                ? "text-acc border-acc/40 bg-acc/5"
                                : "text-sky-400 border-sky-400/40 bg-sky-400/5"
                            }`}
                          >
                            {cand.marketLabel}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-[12px] text-fg tabular-nums font-semibold">
                          @{cand.odds.toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-[13px] text-acc tabular-nums font-bold">
                          {cand.probability.toFixed(1)}%
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-[11px] text-sec tabular-nums">
                          E{cand.edgeScore}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* Educational & Math Principles */}
      <SectionTitle>Why 2.00 Odds Doubles using Over 1.5 & 2H Over 0.5 Work</SectionTitle>
      <Panel corner className="p-4 bg-surface space-y-3 text-[12px] text-sec leading-relaxed">
        <div className="grid md:grid-cols-3 gap-4">
          <div className="border border-edge/60 rounded p-3 bg-surface2/30">
            <div className="font-mono text-[10px] text-acc font-semibold uppercase mb-1">
              1. The Compound Mathematical Edge
            </div>
            <p>
              A standard single bet on a 2.00 odd outcome (like Match Winner or Under 2.5) has a raw probability of only <span className="text-fg font-semibold">45%–48%</span>.
              Combining two independent <span className="text-fg font-semibold">85%+ probability</span> selections (e.g. 1.41 × 1.42 = 2.00) yields an estimated combined win rate of <span className="text-acc font-semibold">~72%</span>.
            </p>
          </div>

          <div className="border border-edge/60 rounded p-3 bg-surface2/30">
            <div className="font-mono text-[10px] text-acc font-semibold uppercase mb-1">
              2. Highest Frequency Markets in Football
            </div>
            <p>
              Across elite European competitions, over <span className="text-fg font-semibold">80%</span> of matches finish with 2 or more goals, and over <span className="text-fg font-semibold">78%</span> see at least one goal scored in the second half. EdgeRadar filters only the upper quartile matches that exceed 80% model confidence.
            </p>
          </div>

          <div className="border border-edge/60 rounded p-3 bg-surface2/30">
            <div className="font-mono text-[10px] text-acc font-semibold uppercase mb-1">
              3. Strict Anti-Correlation Rules
            </div>
            <p>
              The AI engine strictly forbids selecting Over 1.5 and 2nd Half Over 0.5 from the same match. Every leg comes from completely independent fixtures to prevent compounding match-specific volatility.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
