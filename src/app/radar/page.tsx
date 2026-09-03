import Link from "next/link";
import { tryGetAppData } from "@/lib/service";
import { WarmingUp } from "@/components/WarmingUp";
import { Panel, SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: allow slow live-data cold starts

export default async function RadarPage() {
  const res = await tryGetAppData();
  if (res.warming) return <WarmingUp loaded={res.loaded} total={res.total} />;
  const data = res.data;
  const rows = data.radar
    .map((r) => ({ r, lg: data.leagues.find((l) => l.id === r.leagueId)! }))
    .filter(({ lg }) => lg.dataQuality !== "LIMITED")
    .sort((a, b) => b.r.sh_o05 - a.r.sh_o05);

  const excluded = data.leagues.filter((l) => l.dataQuality === "LIMITED");

  const cell = (v: number | null, hot = false) => (
    <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${v !== null && hot ? "text-acc" : "text-fg"}`}>
      {v === null ? <span className="text-mut">—</span> : typeof v === "number" && v % 1 !== 0 ? v.toFixed(1) : v}
    </td>
  );

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight" style={{ fontStretch: "120%" }}>LEAGUE RADAR</h1>
      <p className="text-[12px] text-sec mt-0.5">
        Which leagues currently have the strongest statistical environments? Rates are historical
        frequencies across each league&apos;s demo dataset. Chartreuse = 80%+.
      </p>

      <SectionTitle>Cross-League Comparison</SectionTitle>
      <Panel className="overflow-x-auto">
        <table className="w-full text-[12px] min-w-[900px]">
          <thead>
            <tr className="border-b border-edge font-mono text-[9px] tracking-widest text-mut">
              <th className="px-2 py-2 text-left font-normal">LEAGUE</th>
              <th className="px-2 py-2 text-right font-normal">UPC</th>
              <th className="px-2 py-2 text-right font-normal">AVG G</th>
              <th className="px-2 py-2 text-right font-normal">O0.5%</th>
              <th className="px-2 py-2 text-right font-normal">O1.5%</th>
              <th className="px-2 py-2 text-right font-normal">O2.5%</th>
              <th className="px-2 py-2 text-right font-normal">BTTS%</th>
              <th className="px-2 py-2 text-right font-normal">1H O0.5%</th>
              <th className="px-2 py-2 text-right font-normal">2H O0.5%</th>
              <th className="px-2 py-2 text-right font-normal">CRN</th>
              <th className="px-2 py-2 text-right font-normal">CRD</th>
              <th className="px-2 py-2 text-right font-normal">HOME SC%</th>
              <th className="px-2 py-2 text-right font-normal">AWAY SC%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, lg }) => (
              <tr key={lg.id} className="border-b border-edge/50 last:border-0 hover:bg-surface2/60">
                <td className="px-2 py-1.5">
                  <Link href={`/leagues/${lg.id}`} className="hover:text-acc font-medium">{lg.name}</Link>
                  <span className="font-mono text-[9px] text-mut ml-1.5">T{lg.tier}</span>
                </td>
                {cell(r.upcoming)}
                {cell(r.avgGoals)}
                {cell(r.o05, r.o05 >= 80)}
                {cell(r.o15, r.o15 >= 80)}
                {cell(r.o25, r.o25 >= 80)}
                {cell(r.btts, r.btts >= 80)}
                {cell(r.fh_o05, r.fh_o05 >= 80)}
                {cell(r.sh_o05, r.sh_o05 >= 80)}
                {cell(r.avgCorners)}
                {cell(r.avgCards)}
                {cell(r.homeScoringRate, r.homeScoringRate >= 80)}
                {cell(r.awayScoringRate, r.awayScoringRate >= 80)}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <SectionTitle>Hot Markets · strongest league environments right now</SectionTitle>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2">
        {rows.slice(0, 6).map(({ r, lg }) => (
          <Panel key={lg.id} corner className="p-3">
            <div className="text-[13px] font-medium">{lg.name}</div>
            <div className="mt-1.5 space-y-1">
              {r.hotMarkets.map((h) => (
                <div key={h.market} className="flex items-center text-[12px]">
                  <span className="text-sec">{h.market}</span>
                  <span className="ml-auto font-mono tabular-nums text-acc">{h.rate.toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>

      {excluded.length > 0 && (
        <>
          <SectionTitle>Excluded From Radar · insufficient data</SectionTitle>
          <Panel className="p-3 font-mono text-[11px] text-mut">
            {excluded.map((l) => l.name).join(" · ")} — sample size below the reliability floor. No
            rates are shown rather than presenting unstable numbers.
          </Panel>
        </>
      )}
    </div>
  );
}
