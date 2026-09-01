import { tryGetAppData, modelStats } from "@/lib/service";
import { WarmingUp } from "@/components/WarmingUp";
import { Panel, SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: allow slow live-data cold starts

export default async function ModelPage() {
  const res = await tryGetAppData();
  if (res.warming) return <WarmingUp loaded={res.loaded} total={res.total} />;
  const data = res.data;
  const s = modelStats(data.resolved);
  const lgName = (id: string) => data.leagues.find((l) => l.id === id)?.name ?? id;

  const WEIGHTS: [string, string, number][] = [
    ["SEASON", "Combined both-team season frequency", 0.22],
    ["LAST 10", "Weighted recent form (both teams)", 0.20],
    ["HOME/AWAY", "Home team @home + away team @away", 0.22],
    ["OPPONENT", "Mirror-side (conceding) frequency", 0.16],
    ["LAST 5", "Short-term form", 0.10],
    ["LEAGUE", "League baseline", 0.10],
  ];

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight" style={{ fontStretch: "120%" }}>MODEL</h1>
      <p className="text-[12px] text-sec mt-0.5">
        {s.modelVersion} — deterministic frequency-blend model with league-baseline shrinkage.
        No generative AI in the probability path. Performance below is measured on resolved
        {data.mode === "DEMO" ? " DEMO predictions." : " live pre-match predictions."}
      </p>

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        {/* calibration */}
        <div>
          <SectionTitle>Calibration · predicted vs actual</SectionTitle>
          <Panel className="p-3">
            <div className="space-y-2.5">
              {s.calibration.map((c) => (
                <div key={c.bucket}>
                  <div className="flex items-center font-mono text-[10px] text-mut">
                    <span>PREDICTED {c.bucket}</span>
                    <span className="ml-auto">n={c.n}</span>
                  </div>
                  <div className="mt-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[9px] text-mut w-14">PRED</span>
                      <div className="h-[6px] flex-1 bg-surface2 rounded-sm overflow-hidden">
                        <div className="h-full bg-sec/50" style={{ width: `${c.predicted}%` }} />
                      </div>
                      <span className="font-mono text-[11px] text-sec w-12 text-right tabular-nums">{c.predicted.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[9px] text-mut w-14">ACTUAL</span>
                      <div className="h-[6px] flex-1 bg-surface2 rounded-sm overflow-hidden">
                        <div className={`h-full ${Math.abs(c.actual - c.predicted) <= 6 ? "bg-acc" : "bg-warn"}`} style={{ width: `${c.actual}%` }} />
                      </div>
                      <span className="font-mono text-[11px] text-fg w-12 text-right tabular-nums">{c.actual.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              ))}
              {s.calibration.length === 0 && <div className="font-mono text-[11px] text-mut text-center py-4">NOT ENOUGH RESOLVED PREDICTIONS</div>}
            </div>
            <p className="font-mono text-[9px] text-mut border-t border-edge pt-2 mt-3">
              A well-calibrated model&apos;s 80–84% bucket should win ≈80–84% of the time over a large
              sample. This is more meaningful than any single &quot;accuracy&quot; claim.
            </p>
          </Panel>
        </div>

        {/* component weighting */}
        <div>
          <SectionTitle>Model Components · evidence blend</SectionTitle>
          <Panel className="p-3 space-y-2">
            {WEIGHTS.map(([k, desc, w]) => (
              <div key={k} className="flex items-center gap-3">
                <span className="font-mono text-[10px] text-sec w-20 shrink-0">{k}</span>
                <div className="h-[6px] flex-1 bg-surface2 rounded-sm overflow-hidden">
                  <div className="h-full bg-acc/70" style={{ width: `${w * 100 * 3.5}%` }} />
                </div>
                <span className="font-mono text-[11px] tabular-nums w-10 text-right">{(w * 100).toFixed(0)}%</span>
                <span className="hidden xl:inline text-[10px] text-mut w-56 truncate">{desc}</span>
              </div>
            ))}
            <div className="border-t border-edge pt-2 font-mono text-[10px] text-mut leading-relaxed">
              Blend → shrink toward league baseline: p = (raw·n + baseline·k)/(n + k), k=12.
              Small samples cannot manufacture extreme confidence. Edge Score = 42% probability +
              18% sample + 18% consistency + 12% recent alignment + 10% data quality.
              Upgrade path: Poisson → Dixon-Coles → gradient boosting behind the same interface.
            </div>
          </Panel>

          <SectionTitle>By Confidence Tier</SectionTitle>
          <Panel className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-edge font-mono text-[9px] tracking-widest text-mut text-left">
                  <th className="px-3 py-2 font-normal">TIER</th>
                  <th className="px-3 py-2 font-normal text-right">N</th>
                  <th className="px-3 py-2 font-normal text-right">AVG PROB</th>
                  <th className="px-3 py-2 font-normal text-right">HIT RATE</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {s.byTier.map((t) => (
                  <tr key={t.tier} className="border-b border-edge/50 last:border-0">
                    <td className="px-3 py-1.5 text-sec">{t.tier.replace("_", " ")}</td>
                    <td className="px-3 py-1.5 text-right">{t.n}</td>
                    <td className="px-3 py-1.5 text-right text-sec">{t.avgProb.toFixed(1)}%</td>
                    <td className="px-3 py-1.5 text-right text-fg">{t.hitRate.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <div>
          <SectionTitle>Performance by Market</SectionTitle>
          <Panel className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[420px]">
              <thead>
                <tr className="border-b border-edge font-mono text-[9px] tracking-widest text-mut text-left">
                  <th className="px-3 py-2 font-normal">MARKET</th>
                  <th className="px-3 py-2 font-normal text-right">N</th>
                  <th className="px-3 py-2 font-normal text-right">WINS</th>
                  <th className="px-3 py-2 font-normal text-right">AVG PROB</th>
                  <th className="px-3 py-2 font-normal text-right">HIT RATE</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {s.byMarket.slice(0, 14).map((m) => (
                  <tr key={m.code} className="border-b border-edge/50 last:border-0">
                    <td className="px-3 py-1.5 text-sec font-sans">{m.label}</td>
                    <td className="px-3 py-1.5 text-right">{m.n}</td>
                    <td className="px-3 py-1.5 text-right">{m.wins}</td>
                    <td className="px-3 py-1.5 text-right text-sec">{m.avgProb.toFixed(1)}%</td>
                    <td className={`px-3 py-1.5 text-right ${m.hitRate >= m.avgProb - 4 ? "text-acc" : "text-warn"}`}>{m.hitRate.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
        <div>
          <SectionTitle>Performance by League</SectionTitle>
          <Panel className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[320px]">
              <thead>
                <tr className="border-b border-edge font-mono text-[9px] tracking-widest text-mut text-left">
                  <th className="px-3 py-2 font-normal">LEAGUE</th>
                  <th className="px-3 py-2 font-normal text-right">N</th>
                  <th className="px-3 py-2 font-normal text-right">WINS</th>
                  <th className="px-3 py-2 font-normal text-right">HIT RATE</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {s.byLeague.map((l) => (
                  <tr key={l.leagueId} className="border-b border-edge/50 last:border-0">
                    <td className="px-3 py-1.5 text-sec font-sans">{lgName(l.leagueId)}</td>
                    <td className="px-3 py-1.5 text-right">{l.n}</td>
                    <td className="px-3 py-1.5 text-right">{l.wins}</td>
                    <td className="px-3 py-1.5 text-right text-fg">{l.hitRate.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>

      <p className="mt-4 font-mono text-[10px] text-mut">
        {data.mode === "DEMO"
          ? "All performance figures derive from resolved predictions on synthetic DEMO fixtures. They demonstrate the tracking machinery — they are not evidence of real-world performance."
          : "Performance figures derive from resolved pre-match predictions on live fixtures (football-data.org). Sample sizes grow daily; treat small buckets with caution."}
      </p>
    </div>
  );
}
