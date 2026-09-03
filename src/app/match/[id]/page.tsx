import { notFound } from "next/navigation";
import { loadAppData, teamForm } from "@/lib/service";
import { WarmingUp } from "@/components/WarmingUp";
import { ProviderFailure } from "@/components/ProviderFailure";
import { fmtDateTime, probClass, timeAgo } from "@/lib/format";
import { BroadcastBadge, FlagChip, Medal, Panel, ProbBar, QualityBadge, SectionTitle, StatusBadge } from "@/components/ui";
import { EdgeSignal } from "@/components/EdgeSignal";
import { evalMarket } from "@/lib/markets";
import { MarketGroup } from "@/lib/types";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: allow slow live-data cold starts

const RADARS: [string, MarketGroup[]][] = [
  ["GOAL RADAR", ["TOTAL_GOALS"]],
  ["TEAM GOAL RADAR", ["TEAM_GOALS"]],
  ["HALF RADAR", ["FIRST_HALF", "SECOND_HALF"]],
  ["BTTS RADAR", ["BTTS"]],
  ["CLEAN SHEET RADAR", ["CLEAN_SHEET"]],
  ["CORNER RADAR", ["CORNERS"]],
  ["CARD RADAR", ["CARDS"]],
  ["RESULT RADAR", ["MATCH_RESULT", "PROTECTED_RESULT"]],
];

export default async function MatchPage({ params }: { params: { id: string } }) {
  const res = await loadAppData();
  if (res.state === "warming") return <WarmingUp loaded={res.loaded} total={res.total} />;
  if (res.state === "error") return <ProviderFailure error={res.error} />;
  const data = res.data;
  const fx = data.fixtures.find((f) => f.id === params.id);
  if (!fx) notFound();

  const pred = data.predictions.get(fx.id)!;
  const home = data.teams.find((t) => t.id === fx.homeId)!;
  const away = data.teams.find((t) => t.id === fx.awayId)!;
  const lg = data.leagues.find((l) => l.id === fx.leagueId)!;
  const locked = pred.lockedAt !== null;
  const insufficient = pred.markets.length === 0;

  const forms = [
    { team: home, rows: teamForm(data.ctx, home.id) },
    { team: away, rows: teamForm(data.ctx, away.id) },
  ];

  return (
    <div>
      <Link href="/matches" className="font-mono text-[10px] text-mut hover:text-sec tracking-widest">← MATCH CENTER</Link>

      {/* header */}
      <Panel corner className="mt-2 p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[10px] tracking-widest text-sec">
            {lg.country.toUpperCase()} — {lg.name.toUpperCase()}
          </span>
          <StatusBadge status={fx.status} />
          <BroadcastBadge status={lg.broadcastStatus} />
          <QualityBadge q={lg.dataQuality} />
          {locked && <FlagChip flag="LOCKED" />}
        </div>
        <div className="mt-3 flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight leading-tight" style={{ fontStretch: "118%" }}>
              {home.name} <span className="text-mut font-normal">vs</span> {away.name}
            </h1>
            <div className="font-mono text-[12px] text-sec mt-1 tabular-nums">
              Kickoff {fmtDateTime(fx.kickoff)}
            </div>
          </div>
          {!insufficient && pred.headline && (
            <div className="text-right">
              <div className="font-mono text-[9px] tracking-widest text-mut">PREDICTION CONFIDENCE</div>
              <div className={`font-mono text-3xl font-semibold tabular-nums ${probClass(pred.matchConfidence)}`}>
                {pred.matchConfidence.toFixed(0)}%
              </div>
            </div>
          )}
        </div>

        {/* provenance strip */}
        <div className="mt-3 border-t border-edge pt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] text-mut">
          <span>PREDICTION GENERATED AT <span className="text-sec">{fmtDateTime(pred.generatedAt)}</span></span>
          <span>MODEL <span className="text-sec">{pred.modelVersion}</span></span>
          <span>DATA <span className="text-sec">{pred.dataStatus} · updated {timeAgo(pred.dataUpdatedAt)}</span></span>
          {locked && <span className="text-warn">SNAPSHOT LOCKED AT KICKOFF — cannot be regenerated with in-play or post-match data</span>}
          <span>LINEUPS <span className="text-sec">{fx.lineupStatus === "ANNOUNCED" ? "announced pre-kickoff" : "not announced"}</span></span>
          <span>INJURIES <span className="text-sec">{fx.injuryInfo ?? "Data unavailable"}</span></span>
          {data.mode === "DEMO" ? (
            <span className="text-warn">DEMO DATA</span>
          ) : (
            <span className="text-acc">LIVE DATA · football-data.org</span>
          )}
        </div>
      </Panel>

      {insufficient ? (
        <Panel className="mt-4 p-8 text-center">
          <div className="font-mono text-[12px] tracking-widest text-warn">INSUFFICIENT DATA</div>
          <p className="text-[13px] text-sec mt-2 max-w-md mx-auto">
            We don&apos;t have enough verified historical data to generate a reliable prediction
            for this competition. No confidence score is shown rather than inventing one.
          </p>
        </Panel>
      ) : (
        <>
          {/* top 3 */}
          <SectionTitle>Top 3 Pre-Match Edges · ranked by Edge Score, correlation-aware</SectionTitle>
          {pred.noStrongEdge ? (
            <Panel className="p-6 text-center font-mono text-[11px] text-mut">
              NO STRONG EDGE — the model did not find an outcome above its recommendation floor. That is preferable to inventing a pick.
            </Panel>
          ) : (
            <div className="space-y-2">
              {pred.top3.map((m, i) => (
                <div key={m.market.code} className="flex gap-2 items-stretch">
                  <div className="flex items-center px-1"><Medal i={i} /></div>
                  <div className="flex-1 min-w-0"><EdgeSignal m={m} modelVersion={pred.modelVersion} /></div>
                </div>
              ))}
            </div>
          )}

          {/* categories */}
          <div className="grid lg:grid-cols-2 gap-4 mt-6">
            <div>
              <SectionTitle>Safest · statistically strongest</SectionTitle>
              <div className="space-y-2">
                {pred.safest.map((m, i) => <EdgeSignal key={m.market.code} m={m} rank={i} />)}
                {pred.safest.length === 0 && <Panel className="p-4 font-mono text-[11px] text-mut">NONE ABOVE FLOOR</Panel>}
              </div>
            </div>
            <div>
              <SectionTitle>Under-the-Radar · high probability, low obviousness</SectionTitle>
              <div className="space-y-2">
                {pred.underTheRadar.map((m, i) => <EdgeSignal key={m.market.code} m={m} rank={i} />)}
                {pred.underTheRadar.length === 0 && <Panel className="p-4 font-mono text-[11px] text-mut">NONE ABOVE FLOOR</Panel>}
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4 mt-6">
            <div>
              <SectionTitle>Value · model probability vs demo odds</SectionTitle>
              {lg.hasOddsFeed ? (
                <div className="space-y-2">
                  {pred.value.map((m, i) => <EdgeSignal key={m.market.code} m={m} rank={i} />)}
                  {pred.value.length === 0 && <Panel className="p-4 font-mono text-[11px] text-mut">NO POSITIVE-VALUE MARKET FOUND</Panel>}
                </div>
              ) : (
                <Panel className="p-4 font-mono text-[11px] text-mut">ODDS DATA UNAVAILABLE FOR THIS COMPETITION — VALUE ANALYSIS DISABLED</Panel>
              )}
            </div>
            <div>
              <SectionTitle>Avoid · tempting but statistically weak</SectionTitle>
              <div className="space-y-2">
                {pred.avoid.map((a) => (
                  <Panel key={a.market.code} className="p-3">
                    <div className="flex items-center gap-2">
                      <FlagChip flag="AVOID" />
                      <span className="text-[13px] font-medium">{a.market.label}</span>
                      <span className="ml-auto font-mono text-[12px] text-mut tabular-nums">{a.probability.toFixed(1)}%</span>
                    </div>
                    <p className="text-[11px] text-sec mt-1.5">{a.reason}</p>
                  </Panel>
                ))}
                {pred.avoid.length === 0 && <Panel className="p-4 font-mono text-[11px] text-mut">NO NOTABLE TRAPS DETECTED</Panel>}
              </div>
            </div>
          </div>

          {/* full radar grid */}
          <SectionTitle>Match Intelligence · full market radar</SectionTitle>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2">
            {RADARS.map(([title, groups]) => {
              const ms = pred.markets.filter((m) => groups.includes(m.market.group));
              const unavailable =
                (groups.includes("CORNERS") && !lg.hasCornerData) ||
                (groups.includes("CARDS") && !lg.hasCardData);
              if (ms.length === 0 && !unavailable) return null;
              return (
                <Panel key={title} className="p-3">
                  <div className="font-mono text-[9px] tracking-widest text-mut mb-2">{title}</div>
                  {unavailable ? (
                    <div className="font-mono text-[11px] text-mut py-3 text-center">DATA UNAVAILABLE</div>
                  ) : (
                    <div className="space-y-1.5">
                      {ms.sort((a, b) => b.probability - a.probability).map((m) => (
                        <div key={m.market.code} className="flex items-center gap-2">
                          <span className="text-[11px] text-sec w-40 truncate shrink-0">{m.market.label}</span>
                          <ProbBar p={m.probability} className="flex-1" />
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>
              );
            })}
          </div>

          {/* form analysis */}
          <SectionTitle>Form Analysis · inputs to the model</SectionTitle>
          <div className="grid lg:grid-cols-2 gap-2">
            {forms.map(({ team, rows }) => (
              <Panel key={team.id} className="p-3 overflow-x-auto">
                <div className="text-[13px] font-medium mb-2">{team.name}</div>
                <table className="w-full text-[11px] min-w-[430px]">
                  <thead>
                    <tr className="font-mono text-[9px] tracking-wider text-mut text-right border-b border-edge">
                      <th className="text-left py-1 font-normal">WINDOW</th>
                      <th className="font-normal py-1">P</th>
                      <th className="font-normal py-1">GF</th>
                      <th className="font-normal py-1">GA</th>
                      <th className="font-normal py-1">O1.5</th>
                      <th className="font-normal py-1">BTTS</th>
                      <th className="font-normal py-1">1H+</th>
                      <th className="font-normal py-1">2H+</th>
                      <th className="font-normal py-1">CS</th>
                      <th className="font-normal py-1">CRN</th>
                      <th className="font-normal py-1">CRD</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {rows.map((r) => (
                      <tr key={r.window} className="text-right border-b border-edge/40 last:border-0">
                        <td className="text-left py-1 text-sec">{r.window}</td>
                        <td className="py-1 text-sec">{r.played}</td>
                        <td className="py-1">{r.scored}</td>
                        <td className="py-1">{r.conceded}</td>
                        <td className="py-1">{r.over15}/{r.played}</td>
                        <td className="py-1">{r.btts}/{r.played}</td>
                        <td className="py-1">{r.fh_o05}/{r.played}</td>
                        <td className="py-1">{r.sh_o05}/{r.played}</td>
                        <td className="py-1">{r.cleanSheets}/{r.played}</td>
                        <td className="py-1 text-sec">{r.avgCorners ?? "—"}</td>
                        <td className="py-1 text-sec">{r.avgCards ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            ))}
          </div>
        </>
      )}

      {/* post-match verification — strictly separate from generation */}
      {fx.status === "FINISHED" && fx.result && !insufficient && (
        <>
          <SectionTitle>Post-Match Verification · never rewrites the original snapshot</SectionTitle>
          <Panel className="p-3">
            <div className="font-mono text-[12px] text-sec">
              Final: <span className="text-fg">{home.name} {fx.result.hg}–{fx.result.ag} {away.name}</span>
              <span className="text-mut"> (HT {fx.result.hg1}–{fx.result.ag1})</span>
            </div>
            <div className="mt-2 space-y-1">
              {pred.top3.map((m) => {
                const won = evalMarket(m.market.code, fx.result!);
                return (
                  <div key={m.market.code} className="flex items-center gap-2 text-[12px]">
                    <span className="text-sec">{m.market.label}</span>
                    <span className="font-mono text-mut tabular-nums">{m.probability.toFixed(0)}%</span>
                    <span className={`ml-auto font-mono text-[10px] tracking-widest ${won ? "text-acc" : "text-bad"}`}>
                      {won === null ? "VOID" : won ? "WIN" : "LOSS"}
                    </span>
                  </div>
                );
              })}
            </div>
          </Panel>
        </>
      )}

      <p className="mt-6 font-mono text-[10px] text-mut">
        {data.mode === "DEMO"
          ? "Probabilistic estimates from synthetic DEMO DATA — not guarantees, not betting advice."
          : "Probabilistic estimates — not guarantees, not betting advice. Football data provided by the football-data.org API."}
      </p>
    </div>
  );
}
