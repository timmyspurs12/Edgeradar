import Link from "next/link";
import { tryGetAppData } from "@/lib/service";
import { WarmingUp } from "@/components/WarmingUp";
import { BroadcastBadge, Panel, QualityBadge, SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Leagues() {
  const res = await tryGetAppData();
  if (res.warming) return <WarmingUp loaded={res.loaded} total={res.total} />;
  const data = res.data;
  const tiers: [number, string][] = [
    [1, "TIER 1 — MAJOR BROADCAST LEAGUES"],
    [2, "TIER 2 — HIGH-VISIBILITY LEAGUES"],
    [3, "TIER 3 — OTHER SUPPORTED COMPETITIONS"],
  ];

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight" style={{ fontStretch: "120%" }}>LEAGUES</h1>
      <p className="text-[12px] text-sec mt-0.5">
        Every competition passes a data-quality + visibility check before predictions are enabled.
        Broadcast badges are provenance metadata, only shown when evidence exists.
      </p>

      {tiers.map(([tier, title]) => (
        <div key={tier}>
          <SectionTitle>{title}</SectionTitle>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2">
            {data.leagues.filter((l) => l.tier === tier).map((lg) => {
              const radar = data.radar.find((r) => r.leagueId === lg.id)!;
              return (
                <Panel key={lg.id} corner className="p-3 fade-up">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[14px] font-medium">{lg.name}</div>
                      <div className="font-mono text-[10px] text-mut">{lg.country} · {lg.officialSite}</div>
                    </div>
                    <BroadcastBadge status={lg.broadcastStatus} />
                  </div>
                  <div className="mt-2 flex gap-1.5 flex-wrap">
                    <QualityBadge q={lg.dataQuality} />
                    <span className="font-mono text-[9px] px-1.5 py-0.5 border border-edge rounded-sm text-sec">
                      {lg.historicalMatchCount} HISTORICAL MATCHES
                    </span>
                    <span className="font-mono text-[9px] px-1.5 py-0.5 border border-edge rounded-sm text-sec">
                      {radar.upcoming} UPCOMING
                    </span>
                  </div>
                  <div className="mt-2 border-t border-edge pt-2 space-y-1">
                    <div className="font-mono text-[9px] tracking-widest text-mut">BEST MARKETS (HISTORICAL RATE)</div>
                    {radar.hotMarkets.map((h) => (
                      <div key={h.market} className="flex items-center text-[11px]">
                        <span className="text-sec">{h.market}</span>
                        <span className="ml-auto font-mono tabular-nums text-fg">{h.rate.toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-mono text-[9px] text-mut">
                      {lg.seasonStatus} · corners {lg.hasCornerData ? "✓" : "—"} · cards {lg.hasCardData ? "✓" : "—"} · odds {lg.hasOddsFeed ? "✓ (demo)" : "—"}
                    </span>
                    <Link href={`/leagues/${lg.id}`} className="font-mono text-[10px] text-acc/80 hover:text-acc tracking-widest">
                      RADAR →
                    </Link>
                  </div>
                </Panel>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
