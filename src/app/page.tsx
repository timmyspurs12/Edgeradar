import Link from "next/link";
import { loadAppData } from "@/lib/service";
import { WarmingUp } from "@/components/WarmingUp";
import { ProviderFailure } from "@/components/ProviderFailure";
import { fmtDateTime, fmtTime, probClass, timeAgo, APP_TZ_LABEL } from "@/lib/format";
import { Panel, SectionTitle, TierBadge } from "@/components/ui";
import { MatchRow } from "@/components/MatchRow";
import { getTopEdges, queryFixtures } from "@/lib/repository";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: allow slow live-data cold starts

export default async function Dashboard() {
  const res = await loadAppData();
  if (res.state === "warming") return <WarmingUp loaded={res.loaded} total={res.total} />;
  if (res.state === "error") return <ProviderFailure error={res.error} />;
  const data = res.data;

  // Everything below reads through the repository — the single source of truth
  // for fixture filtering, timezone day boundaries and status handling.
  const today = queryFixtures(data, { range: "today" });
  const live = today.filter((r) => r.fixture.status === "LIVE");
  const topEdges = getTopEdges(data, { horizonDays: 3, limit: 10 });

  const analyzed = today.filter((r) => (r.prediction?.markets.length ?? 0) > 0);
  const veryHigh = today.filter((r) => (r.prediction?.matchConfidence ?? 0) >= 85).length;
  const high = today.filter((r) => {
    const c = r.prediction?.matchConfidence ?? 0;
    return c >= 80 && c < 85;
  }).length;
  const weak = today.filter((r) => !r.prediction || r.prediction.noStrongEdge).length;

  const byLeague = new Map<string, typeof today>();
  for (const r of today) {
    if (!byLeague.has(r.league.id)) byLeague.set(r.league.id, []);
    byLeague.get(r.league.id)!.push(r);
  }

  return (
    <div>
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" style={{ fontStretch: "120%" }}>
            TODAY&apos;S EDGE RADAR
          </h1>
          <p className="text-[12px] text-sec mt-0.5">
            Find the probabilities hiding underneath the obvious markets.
          </p>
        </div>
        <div className="font-mono text-[10px] text-mut text-right">
          <div>data refreshed {timeAgo(data.builtAt)} · kickoffs in {APP_TZ_LABEL}</div>
          <div>predictions generated pre-match · {data.mode} MODE · {data.providerId}</div>
        </div>
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-4">
        {[
          ["MATCHES TODAY", today.length, "text-fg"],
          ["ANALYZED", analyzed.length, "text-fg"],
          ["IN PLAY NOW", live.length, "text-warn"],
          ["VERY HIGH CONFIDENCE", veryHigh, "text-acc"],
        ].map(([label, v, cls]) => (
          <Panel key={label as string} corner className="p-3">
            <div className="font-mono text-[9px] tracking-widest text-mut">{label}</div>
            <div className={`font-mono text-2xl font-semibold tabular-nums mt-1 ${cls}`}>{v as number}</div>
          </Panel>
        ))}
      </div>

      {/* top edges table */}
      <SectionTitle
        right={
          <div className="flex items-center gap-3">
            <Link href="/two-odds" className="font-mono text-[10px] text-acc tracking-widest hover:text-acc/80">2.00 BANKER →</Link>
            <Link href="/matches" className="font-mono text-[10px] text-acc/80 tracking-widest hover:text-acc">ALL MATCHES →</Link>
          </div>
        }
      >
        Top Pre-Match Edges · next 3 days
      </SectionTitle>
      <Panel className="overflow-x-auto">
        <table className="w-full text-[12px] min-w-[640px]">
          <thead>
            <tr className="border-b border-edge font-mono text-[9px] tracking-widest text-mut text-left">
              <th className="px-3 py-2 font-normal">MATCH</th>
              <th className="px-3 py-2 font-normal">KO</th>
              <th className="px-3 py-2 font-normal">MARKET</th>
              <th className="px-3 py-2 font-normal text-right">PROB</th>
              <th className="px-3 py-2 font-normal text-right">EDGE</th>
              <th className="px-3 py-2 font-normal text-right">CONF</th>
            </tr>
          </thead>
          <tbody>
            {topEdges.map((r) => {
              const h = r.prediction!.headline!;
              return (
                <tr key={r.fixture.id} className="border-b border-edge/50 last:border-0 hover:bg-surface2/60">
                  <td className="px-3 py-2">
                    <Link href={`/match/${r.fixture.id}`} className="hover:text-acc">
                      <span className="font-medium">{r.homeTeam.name}</span>
                      <span className="text-mut"> v </span>
                      <span className="font-medium">{r.awayTeam.name}</span>
                    </Link>
                    <div className="font-mono text-[9px] text-mut">{r.league.name}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-sec tabular-nums">{fmtTime(r.kickoffIso)}</td>
                  <td className="px-3 py-2 text-sec">{h.market.label}</td>
                  <td className={`px-3 py-2 text-right font-mono tabular-nums ${probClass(h.probability)}`}>{h.probability.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-fg">{h.edgeScore}</td>
                  <td className="px-3 py-2 text-right"><TierBadge tier={h.confidenceTier} /></td>
                </tr>
              );
            })}
            {topEdges.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-mut font-mono text-[11px]">NO STRONG EDGES IN THE NEXT 3 DAYS</td></tr>
            )}
          </tbody>
        </table>
      </Panel>

      {/* today grouped by league */}
      <SectionTitle right={<span className="font-mono text-[9px] tracking-widest text-mut">{APP_TZ_LABEL} DAY</span>}>
        Today&apos;s Fixtures · by league
      </SectionTitle>
      {today.length === 0 && (
        <Panel className="p-6 text-center font-mono text-[11px] text-mut">
          NO FIXTURES TODAY — SEE <Link className="text-acc" href="/matches?range=7d">NEXT 7 DAYS</Link>
        </Panel>
      )}
      <div className="space-y-4">
        {[...byLeague.entries()].map(([lgId, rows]) => {
          const lg = rows[0].league;
          return (
            <div key={lgId}>
              <div className="font-mono text-[10px] tracking-widest text-sec mb-1.5">
                {lg.country.toUpperCase()} — {lg.name.toUpperCase()}
              </div>
              <div className="grid md:grid-cols-2 gap-2">
                {rows.map((r) => (
                  <MatchRow
                    key={r.fixture.id} fx={r.fixture} home={r.homeTeam} away={r.awayTeam}
                    league={lg} pred={r.prediction ?? undefined} showLeague={false}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-6 font-mono text-[10px] text-mut">
        {data.mode === "DEMO"
          ? <>All fixtures, statistics and odds on this screen are DEMO DATA (synthetic, seeded). </>
          : <>Live football data served by the <span className="text-sec">{data.providerId}</span> provider. </>}
        Prediction snapshots are generated strictly pre-match and lock at kickoff: built {fmtDateTime(data.builtAt)} ({APP_TZ_LABEL}).
      </p>
    </div>
  );
}
