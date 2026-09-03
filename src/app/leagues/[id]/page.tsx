import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAppData } from "@/lib/service";
import { WarmingUp } from "@/components/WarmingUp";
import { ProviderFailure } from "@/components/ProviderFailure";
import { BroadcastBadge, Panel, ProbBar, QualityBadge, SectionTitle } from "@/components/ui";
import { MatchRow } from "@/components/MatchRow";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: allow slow live-data cold starts

export default async function LeagueRadarPage({ params }: { params: { id: string } }) {
  const res = await loadAppData();
  if (res.state === "warming") return <WarmingUp loaded={res.loaded} total={res.total} />;
  if (res.state === "error") return <ProviderFailure error={res.error} />;
  const data = res.data;
  const lg = data.leagues.find((l) => l.id === params.id);
  if (!lg) notFound();
  const r = data.radar.find((x) => x.leagueId === lg.id)!;

  const team = (id: string) => data.teams.find((t) => t.id === id)!;
  const upcoming = data.fixtures
    .filter((f) => f.leagueId === lg.id && f.status === "UPCOMING")
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));

  const rows: [string, number | null, boolean][] = [
    ["Over 0.5 Goals", r.o05, true],
    ["Over 1.5 Goals", r.o15, true],
    ["Over 2.5 Goals", r.o25, true],
    ["BTTS", r.btts, true],
    ["1H Over 0.5", r.fh_o05, true],
    ["2H Over 0.5", r.sh_o05, true],
    ["Home team scores", r.homeScoringRate, true],
    ["Away team scores", r.awayScoringRate, true],
  ];

  return (
    <div>
      <Link href="/leagues" className="font-mono text-[10px] text-mut hover:text-sec tracking-widest">← LEAGUES</Link>
      <Panel corner className="mt-2 p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold tracking-tight" style={{ fontStretch: "120%" }}>
            {lg.name.toUpperCase()} — LEAGUE RADAR
          </h1>
          <BroadcastBadge status={lg.broadcastStatus} />
          <QualityBadge q={lg.dataQuality} />
        </div>
        <div className="font-mono text-[10px] text-mut mt-1">
          {lg.country} · Tier {lg.tier} · {lg.historicalMatchCount} historical matches · {lg.seasonStatus} ·{" "}
          {lg.broadcastStatus !== "LIMITED_DATA" ? lg.broadcastEvidence : "no verified broadcast evidence"}
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            ["UPCOMING MATCHES", r.upcoming],
            ["AVG GOALS", lg.avgGoals.toFixed(2)],
            ["AVG CORNERS", r.avgCorners ?? "—"],
            ["AVG CARDS", r.avgCards ?? "—"],
          ].map(([l, v]) => (
            <div key={l as string} className="bg-ink border border-edge rounded p-2">
              <div className="font-mono text-[8px] tracking-widest text-mut">{l}</div>
              <div className="font-mono text-xl tabular-nums text-fg">{v as string}</div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <div>
          <SectionTitle>Statistical Environment · season rates</SectionTitle>
          <Panel className="p-3 space-y-2">
            {rows.map(([label, v]) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-[11px] text-sec w-36 shrink-0">{label}</span>
                {v === null ? <span className="font-mono text-[10px] text-mut">DATA UNAVAILABLE</span> : <ProbBar p={v} className="flex-1" />}
              </div>
            ))}
          </Panel>
        </div>
        <div>
          <SectionTitle>Hot Markets · strongest historical rates</SectionTitle>
          <Panel className="p-3 space-y-3">
            {r.hotMarkets.map((h, i) => (
              <div key={h.market} className="flex items-center gap-3">
                <span className="font-mono text-[11px] text-mut w-5">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-[13px] flex-1">{h.market}</span>
                <span className="font-mono text-lg tabular-nums text-acc">{h.rate.toFixed(0)}%</span>
              </div>
            ))}
            <p className="font-mono text-[9px] text-mut border-t border-edge pt-2">
              Historical frequency across {lg.historicalMatchCount} league matches (DEMO DATA). Not a guarantee for any single fixture.
            </p>
          </Panel>
        </div>
      </div>

      <SectionTitle>Upcoming Fixtures</SectionTitle>
      <div className="grid md:grid-cols-2 gap-2">
        {upcoming.map((f) => (
          <MatchRow key={f.id} fx={f} home={team(f.homeId)} away={team(f.awayId)} league={lg} pred={data.predictions.get(f.id)} showLeague={false} />
        ))}
      </div>
      {upcoming.length === 0 && (
        <Panel className="p-6 text-center font-mono text-[11px] text-mut">NO UPCOMING FIXTURES IN THE DEMO WINDOW</Panel>
      )}
    </div>
  );
}
