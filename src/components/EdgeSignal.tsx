import { MarketPrediction } from "@/lib/types";
import { EdgeScoreBox, FlagChip, ProbBar, TierBadge } from "./ui";

/**
 * Edge Signal — EdgeRadar's signature prediction unit.
 * Rank · market · probability ladder · evidence · edge score · provenance.
 */
export function EdgeSignal({
  m, rank, modelVersion,
}: { m: MarketPrediction; rank?: number; modelVersion?: string }) {
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
  return (
    <div className="border border-edge rounded bg-surface2/60 p-3 fade-up">
      <div className="flex items-start gap-3">
        {rank !== undefined && (
          <div className="font-mono text-[11px] text-mut pt-0.5 w-5 shrink-0">
            {String(rank + 1).padStart(2, "0")}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium">{m.market.label}</span>
            <TierBadge tier={m.confidenceTier} />
            {m.flags.map((f) => <FlagChip key={f} flag={f} />)}
          </div>
          <ProbBar p={m.probability} className="mt-2" />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-mut">
            <span>SAMPLE <span className="text-sec">{m.sampleSize}</span></span>
            <span>RECENT <span className="text-sec">{m.recentHits}/{m.recentTotal}</span></span>
            <span>SEASON <span className="text-sec">{m.seasonHits}/{m.seasonTotal}</span></span>
            <span>LEAGUE <span className="text-sec">{m.leagueRate.toFixed(0)}%</span></span>
            <span>DATA <span className="text-sec">{m.dataStrength}</span></span>
            {m.odds !== null && (
              <span>ODDS <span className="text-sec">{m.odds.toFixed(2)}</span>{" "}
                {m.valueEdge !== null && m.valueEdge > 0 && <span className="text-acc">+{m.valueEdge.toFixed(1)}pp</span>}
                <span className="text-warn"> (demo)</span>
              </span>
            )}
          </div>

          <details className="why mt-2">
            <summary className="font-mono text-[10px] tracking-widest text-acc/80 hover:text-acc">
              WHY? ▾
            </summary>
            <div className="mt-2 border-t border-edge pt-2 space-y-2">
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {([
                  ["SEASON", m.components.season],
                  ["LAST 10", m.components.last10],
                  ["LAST 5", m.components.last5],
                  ["HOME/AWAY", m.components.homeAway],
                  ["OPPONENT", m.components.opponent],
                  ["LEAGUE", m.components.league],
                ] as [string, number | null][]).map(([k, v]) => (
                  <div key={k} className="bg-ink border border-edge rounded-sm px-1.5 py-1">
                    <div className="font-mono text-[8px] text-mut tracking-wider">{k}</div>
                    <div className="font-mono text-[12px] text-fg tabular-nums">{pct(v)}</div>
                  </div>
                ))}
              </div>
              <ul className="text-[11px] text-sec space-y-0.5 list-disc pl-4">
                {m.explanation.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
              <div className="font-mono text-[10px] text-mut">
                Final model: <span className="text-fg">{m.probability.toFixed(1)}%</span>
                {" "}(raw blend {m.rawProbability.toFixed(1)}%){modelVersion ? ` · ${modelVersion}` : ""}
              </div>
            </div>
          </details>
        </div>
        <EdgeScoreBox score={m.edgeScore} />
      </div>
    </div>
  );
}
