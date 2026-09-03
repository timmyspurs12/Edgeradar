import Link from "next/link";
import { tryGetAppData } from "@/lib/service";
import { WarmingUp } from "@/components/WarmingUp";
import { dayKeyInTz, fmtDateTime, fmtTime, probClass, timeAgo, APP_TZ_LABEL } from "@/lib/format";
import { Panel, SectionTitle, TierBadge } from "@/components/ui";
import { MatchRow } from "@/components/MatchRow";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: allow slow live-data cold starts

export default async function Dashboard() {
  const res = await tryGetAppData();
  if (res.warming) return <WarmingUp loaded={res.loaded} total={res.total} />;
  const data = res.data;
  const now = Date.now();
  const todayKey = dayKeyInTz(new Date());

  const upcoming = data.fixtures.filter((f) => f.status === "UPCOMING");
  const today = upcoming.filter((f) => dayKeyInTz(f.kickoff) === todayKey);
  const next3d = upcoming.filter((f) => new Date(f.kickoff).getTime() <= now + 3 * 86400000);

  const preds = (list: typeof upcoming) => list.map((f) => ({ f, p: data.predictions.get(f.id)! }));
  const todayP = preds(today);
  const analyzed = todayP.filter(({ p }) => p.markets.length > 0);
  const veryHigh = todayP.filter(({ p }) => p.matchConfidence >= 85).length;
  const high = todayP.filter(({ p }) => p.matchConfidence >= 80 && p.matchConfidence < 85).length;
  const weak = todayP.filter(({ p }) => p.noStrongEdge).length;

  const topEdges = preds(next3d)
    .filter(({ p }) => p.headline)
    .sort((a, b) => (b.p.headline!.edgeScore - a.p.headline!.edgeScore))
    .slice(0, 10);

  const team = (id: string) => data.teams.find((t) => t.id === id)!;
  const league = (id: string) => data.leagues.find((l) => l.id === id)!;

  const byLeague = new Map<string, typeof today>();
  for (const f of today) {
    if (!byLeague.has(f.leagueId)) byLeague.set(f.leagueId, []);
    byLeague.get(f.leagueId)!.push(f);
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
          <div>predictions generated pre-match · {data.mode} MODE</div>
        </div>
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-4">
        {[
          ["MATCHES ANALYZED TODAY", analyzed.length, "text-fg"],
          ["VERY HIGH CONFIDENCE", veryHigh, "text-acc"],
          ["HIGH CONFIDENCE", high, "text-acc/80"],
          ["NO STRONG EDGE / THIN DATA", weak, "text-mut"],
        ].map(([label, v, cls]) => (
          <Panel key={label as string} corner className="p-3">
            <div className="font-mono text-[9px] tracking-widest text-mut">{label}</div>
            <div className={`font-mono text-2xl font-semibold tabular-nums mt-1 ${cls}`}>{v as number}</div>
          </Panel>
        ))}
      </div>

      {/* top edges table */}
      <SectionTitle
        right={<Link href="/matches" className="font-mono text-[10px] text-acc/80 tracking-widest hover:text-acc">ALL MATCHES →</Link>}
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
            {topEdges.map(({ f, p }) => {
              const h = p.headline!;
              return (
                <tr key={f.id} className="border-b border-edge/50 last:border-0 hover:bg-surface2/60">
                  <td className="px-3 py-2">
                    <Link href={`/match/${f.id}`} className="hover:text-acc">
                      <span className="font-medium">{team(f.homeId).name}</span>
                      <span className="text-mut"> v </span>
                      <span className="font-medium">{team(f.awayId).name}</span>
                    </Link>
                    <div className="font-mono text-[9px] text-mut">{league(f.leagueId).name}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-sec tabular-nums">{fmtTime(f.kickoff)}</td>
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
      <SectionTitle>Today&apos;s Fixtures · by league</SectionTitle>
      {today.length === 0 && (
        <Panel className="p-6 text-center font-mono text-[11px] text-mut">
          NO REMAINING FIXTURES TODAY — SEE <Link className="text-acc" href="/matches?range=7d">NEXT 7 DAYS</Link>
        </Panel>
      )}
      <div className="space-y-4">
        {[...byLeague.entries()].map(([lgId, fixtures]) => {
          const lg = league(lgId);
          return (
            <div key={lgId}>
              <div className="font-mono text-[10px] tracking-widest text-sec mb-1.5">
                {lg.country.toUpperCase()} — {lg.name.toUpperCase()}
              </div>
              <div className="grid md:grid-cols-2 gap-2">
                {fixtures.map((f) => (
                  <MatchRow
                    key={f.id} fx={f} home={team(f.homeId)} away={team(f.awayId)}
                    league={lg} pred={data.predictions.get(f.id)} showLeague={false}
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
          : <>Football data provided by the football-data.org API. </>}
        Prediction snapshots are generated strictly pre-match: {fmtDateTime(data.builtAt)} ({APP_TZ_LABEL}).
      </p>
    </div>
  );
}
