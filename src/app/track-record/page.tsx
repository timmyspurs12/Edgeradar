import Link from "next/link";
import { tryGetAppData, modelStats } from "@/lib/service";
import { WarmingUp } from "@/components/WarmingUp";
import { fmtDateTime } from "@/lib/format";
import { Panel, SectionTitle, TierBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function TrackRecord() {
  const res = await tryGetAppData();
  if (res.warming) return <WarmingUp loaded={res.loaded} total={res.total} />;
  const data = res.data;
  const stats = modelStats(data.resolved);
  const recent = [...data.resolved].sort((a, b) => b.kickoff.localeCompare(a.kickoff)).slice(0, 60);
  const team = (fxId: string) => {
    const fx = data.fixtures.find((f) => f.id === fxId)!;
    const h = data.teams.find((t) => t.id === fx.homeId)!;
    const a = data.teams.find((t) => t.id === fx.awayId)!;
    return `${h.name} v ${a.name}`;
  };
  const lgName = (id: string) => data.leagues.find((l) => l.id === id)?.name ?? id;

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight" style={{ fontStretch: "120%" }}>PREDICTION TRACK RECORD</h1>
      <p className="text-[12px] text-sec mt-0.5">
        Every published pre-match pick, resolved against the final result after the whistle.
        Original snapshots are never rewritten.{data.mode === "DEMO" ? " All entries are DEMO DATA." : " Live data: football-data.org."}
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mt-4">
        {[
          ["TOTAL PREDICTIONS", stats.total, "text-fg"],
          ["WINS", stats.wins, "text-acc"],
          ["LOSSES", stats.losses, "text-bad"],
          ["HIT RATE", `${stats.hitRate.toFixed(1)}%`, "text-acc"],
          ["AVG PREDICTED PROB", `${stats.avgProbability.toFixed(1)}%`, "text-sec"],
        ].map(([l, v, c]) => (
          <Panel key={l as string} corner className="p-3">
            <div className="font-mono text-[9px] tracking-widest text-mut">{l}</div>
            <div className={`font-mono text-2xl font-semibold tabular-nums mt-1 ${c}`}>{v as string}</div>
          </Panel>
        ))}
      </div>
      {stats.roi !== null && (
        <p className="font-mono text-[11px] text-sec mt-2">
          Flat-stake ROI on picks with demo odds: <span className={stats.roi >= 0 ? "text-acc" : "text-bad"}>{stats.roi > 0 ? "+" : ""}{stats.roi}%</span>
        </p>
      )}

      <SectionTitle>Resolved Predictions · most recent</SectionTitle>
      <Panel className="overflow-x-auto">
        <table className="w-full text-[12px] min-w-[760px]">
          <thead>
            <tr className="border-b border-edge font-mono text-[9px] tracking-widest text-mut text-left">
              <th className="px-3 py-2 font-normal">KICKOFF</th>
              <th className="px-3 py-2 font-normal">MATCH</th>
              <th className="px-3 py-2 font-normal">LEAGUE</th>
              <th className="px-3 py-2 font-normal">MARKET</th>
              <th className="px-3 py-2 font-normal text-right">PROB</th>
              <th className="px-3 py-2 font-normal text-right">CONF</th>
              <th className="px-3 py-2 font-normal text-right">RESULT</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r, i) => (
              <tr key={`${r.fixtureId}-${r.marketCode}-${i}`} className="border-b border-edge/50 last:border-0 hover:bg-surface2/60">
                <td className="px-3 py-1.5 font-mono text-[10px] text-mut tabular-nums whitespace-nowrap">{fmtDateTime(r.kickoff)}</td>
                <td className="px-3 py-1.5"><Link href={`/match/${r.fixtureId}`} className="hover:text-acc">{team(r.fixtureId)}</Link></td>
                <td className="px-3 py-1.5 text-sec">{lgName(r.leagueId)}</td>
                <td className="px-3 py-1.5 text-sec">{r.marketLabel}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.probability.toFixed(1)}%</td>
                <td className="px-3 py-1.5 text-right"><TierBadge tier={r.confidenceTier} /></td>
                <td className={`px-3 py-1.5 text-right font-mono text-[10px] tracking-widest ${r.outcome === "WIN" ? "text-acc" : "text-bad"}`}>
                  {r.outcome}
                </td>
              </tr>
            ))}
            {recent.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center font-mono text-[11px] text-mut">NO RESOLVED PREDICTIONS YET</td></tr>
            )}
          </tbody>
        </table>
      </Panel>

      <p className="mt-4 font-mono text-[10px] text-mut">
        Predictions were generated from the pre-match snapshot (timestamped before kickoff) and
        resolved separately after full time. Post-match data never feeds back into snapshots.
      </p>
    </div>
  );
}
