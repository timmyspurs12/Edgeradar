"use client";

import { useState } from "react";

const GROUPS = [
  ["TOTAL_GOALS", "Total Goals"], ["TEAM_GOALS", "Team Goals"],
  ["FIRST_HALF", "1st Half"], ["SECOND_HALF", "2nd Half"],
  ["BTTS", "BTTS"], ["CLEAN_SHEET", "Clean Sheets"],
  ["CORNERS", "Corners"], ["CARDS", "Cards"],
  ["PROTECTED_RESULT", "Double Chance"],
] as const;

interface Leg {
  fixtureId: string; match: string; kickoff: string;
  marketLabel: string; probability: number; edgeScore: number; odds: number | null;
}
interface Result {
  legs: Leg[]; combinedProbability: number | null; combinedOdds: number | null;
  independenceNote: string; warnings: string[];
}

export default function Builder() {
  const [legs, setLegs] = useState(3);
  const [minProb, setMinProb] = useState(82);
  const [tier, setTier] = useState(0);
  const [groups, setGroups] = useState<string[]>(["TOTAL_GOALS", "TEAM_GOALS", "SECOND_HALF"]);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const toggle = (g: string) =>
    setGroups((prev) => prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]);

  const build = async () => {
    setLoading(true); setError(""); setResult(null);
    try {
      const res = await fetch("/api/combination", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ legs, minProb, groups, tier, horizonDays: 3 }),
      });
      if (res.status === 503) {
        setError("Live data is still warming up (rate-limited API) — try again in a minute.");
        return;
      }
      if (!res.ok) throw new Error("Request failed");
      setResult(await res.json());
    } catch {
      setError("Could not build combination. Try relaxing the filters.");
    } finally {
      setLoading(false);
    }
  };

  const box = "bg-surface border border-edge rounded p-3";

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight" style={{ fontStretch: "120%" }}>BUILD MY SAFE COMBINATION</h1>
      <p className="text-[12px] text-sec mt-0.5">
        Correlation-aware selection finder. One leg per fixture; same-match and same-team correlated
        markets are excluded before probabilities are multiplied.
      </p>

      <div className={`${box} mt-4 grid sm:grid-cols-3 gap-4`}>
        <label className="block">
          <div className="font-mono text-[9px] tracking-widest text-mut mb-1">SELECTIONS: {legs}</div>
          <input type="range" min={2} max={6} value={legs} onChange={(e) => setLegs(+e.target.value)} className="w-full accent-[#C8F135]" />
        </label>
        <label className="block">
          <div className="font-mono text-[9px] tracking-widest text-mut mb-1">MIN PROBABILITY PER LEG: {minProb}%</div>
          <input type="range" min={70} max={95} value={minProb} onChange={(e) => setMinProb(+e.target.value)} className="w-full accent-[#C8F135]" />
        </label>
        <label className="block">
          <div className="font-mono text-[9px] tracking-widest text-mut mb-1">LEAGUE TIER</div>
          <select value={tier} onChange={(e) => setTier(+e.target.value)} className="w-full bg-ink border border-edge rounded px-2 py-1.5 text-[12px] font-mono text-sec">
            <option value={0}>All tiers</option>
            <option value={1}>Tier 1 only</option>
            <option value={2}>Tier 2 only</option>
          </select>
        </label>
        <div className="sm:col-span-3">
          <div className="font-mono text-[9px] tracking-widest text-mut mb-1.5">MARKET GROUPS</div>
          <div className="flex flex-wrap gap-1.5">
            {GROUPS.map(([g, label]) => (
              <button
                key={g} onClick={() => toggle(g)}
                className={`font-mono text-[10px] px-2 py-1 border rounded-sm transition-colors ${
                  groups.includes(g) ? "border-acc/60 text-acc bg-acc/5" : "border-edge text-mut hover:text-sec"
                }`}
              >
                {label.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={build} disabled={loading || groups.length === 0}
          className="sm:col-span-3 font-mono text-[12px] tracking-widest py-2 rounded border border-acc/60 text-acc hover:bg-acc hover:text-ink transition-colors disabled:opacity-40"
        >
          {loading ? "SEARCHING COMPATIBLE SELECTIONS…" : "FIND COMPATIBLE SELECTIONS"}
        </button>
      </div>

      {error && <div className={`${box} mt-3 text-[12px] text-bad`}>{error}</div>}

      {result && (
        <div className={`${box} mt-3 fade-up`}>
          {result.legs.length === 0 ? (
            <div className="font-mono text-[11px] text-mut text-center py-4">
              NO SELECTIONS MET THE FLOOR — the builder never pads a slip with weak picks.
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {result.legs.map((l, i) => (
                  <div key={i} className="flex items-center gap-3 border-b border-edge/50 last:border-0 pb-2 last:pb-0">
                    <span className="font-mono text-[11px] text-mut w-5">{String(i + 1).padStart(2, "0")}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium truncate">{l.marketLabel}</div>
                      <div className="font-mono text-[10px] text-mut truncate">{l.match} · {new Date(l.kickoff).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })} WAT</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-[14px] tabular-nums text-acc">{l.probability.toFixed(1)}%</div>
                      <div className="font-mono text-[9px] text-mut">E{l.edgeScore}{l.odds ? ` · @${l.odds.toFixed(2)} (demo)` : ""}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 border-t border-edge pt-3 flex flex-wrap gap-x-8 gap-y-2">
                <div>
                  <div className="font-mono text-[9px] tracking-widest text-mut">COMBINED PROBABILITY</div>
                  <div className="font-mono text-2xl font-semibold tabular-nums text-fg">{result.combinedProbability?.toFixed(1)}%</div>
                </div>
                {result.combinedOdds !== null && (
                  <div>
                    <div className="font-mono text-[9px] tracking-widest text-mut">COMBINED ODDS (DEMO)</div>
                    <div className="font-mono text-2xl font-semibold tabular-nums text-sec">{result.combinedOdds.toFixed(2)}</div>
                  </div>
                )}
              </div>
              <p className="font-mono text-[10px] text-mut mt-2">{result.independenceNote}</p>
            </>
          )}
          {result.warnings.map((w, i) => (
            <p key={i} className="mt-2 text-[11px] text-warn border border-warn/30 rounded px-2 py-1.5">{w}</p>
          ))}
          <p className="font-mono text-[10px] text-mut mt-3">
            A high combined probability is still not a guarantee — multi-leg combinations fail more
            often than any single leg. Probabilistic estimates only.
          </p>
        </div>
      )}
    </div>
  );
}
