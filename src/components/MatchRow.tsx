import Link from "next/link";
import { Fixture, League, MatchPrediction, Team } from "@/lib/types";
import { fmtDate, fmtTime, probClass } from "@/lib/format";
import { BroadcastBadge, StatusBadge, TierBadge } from "./ui";

export function MatchRow({
  fx, home, away, league, pred, showLeague = true,
}: {
  fx: Fixture; home: Team; away: Team; league: League;
  pred: MatchPrediction | undefined; showLeague?: boolean;
}) {
  const top = pred?.top3 ?? [];
  return (
    <Link
      href={`/match/${fx.id}`}
      className="block border border-edge bg-surface rounded hover:border-acc/40 transition-colors fade-up"
    >
      <div className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          {showLeague && (
            <span className="font-mono text-[10px] text-mut tracking-wider">
              {league.country.toUpperCase()} — {league.name.toUpperCase()}
            </span>
          )}
          <StatusBadge status={fx.status} />
          <BroadcastBadge status={league.broadcastStatus} />
          <span className="ml-auto font-mono text-[11px] text-sec tabular-nums">
            {fmtDate(fx.kickoff)} <span className="text-fg">{fmtTime(fx.kickoff)}</span>
          </span>
        </div>

        <div className="mt-2 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-medium truncate">{home.name}</div>
            <div className="text-[14px] font-medium truncate text-sec">{away.name}</div>
          </div>
          {pred && !pred.noStrongEdge && pred.headline ? (
            <div className="text-right shrink-0">
              <div className={`font-mono text-[20px] font-semibold tabular-nums ${probClass(pred.matchConfidence)}`}>
                {pred.matchConfidence.toFixed(0)}%
              </div>
              <TierBadge tier={pred.headline.confidenceTier} />
            </div>
          ) : (
            <div className="font-mono text-[10px] text-mut border border-edge rounded-sm px-2 py-1 shrink-0">
              {pred && pred.markets.length === 0 ? "INSUFFICIENT DATA" : "NO STRONG EDGE"}
            </div>
          )}
        </div>

        {top.length > 0 && (
          <div className="mt-2 border-t border-edge pt-2 space-y-1">
            {top.map((m) => (
              <div key={m.market.code} className="flex items-center gap-2 text-[12px]">
                <span className="text-acc">✓</span>
                <span className="text-sec truncate">{m.market.label}</span>
                <span className={`ml-auto font-mono tabular-nums ${probClass(m.probability)}`}>
                  {m.probability.toFixed(0)}%
                </span>
                <span className="font-mono text-[10px] text-mut w-14 text-right">E{m.edgeScore}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-2 flex items-center justify-between">
          <span className="font-mono text-[9px] text-mut">
            {pred ? `${pred.markets.length} markets analyzed · ${pred.modelVersion}` : ""}
          </span>
          <span className="font-mono text-[10px] text-acc/80 tracking-widest">ANALYZE →</span>
        </div>
      </div>
    </Link>
  );
}
