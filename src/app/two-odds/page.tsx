import Link from "next/link";
import { loadAppData } from "@/lib/service";
import { WarmingUp } from "@/components/WarmingUp";
import { ProviderFailure } from "@/components/ProviderFailure";
import { Panel, SectionTitle } from "@/components/ui";
import { getBankerSlip, BANKER_MARKET_LABELS, BANKER_MARKET_CODES, DEFAULT_MAX_LEGS, DEFAULT_MIN_PROBABILITY, DEFAULT_TARGET_ODDS } from "@/lib/banker";
import { fmtDateTime, APP_TZ_LABEL } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: allow slow live-data cold starts

const HORIZONS = [["1", "24 hours"], ["3", "Next 3 days"], ["7", "Next 7 days"]] as const;
const FLOORS = [["75", "≥75%"], ["78", "≥78%"], ["82", "≥82%"], ["85", "≥85%"], ["90", "≥90%"]] as const;
const LEGS = [["2", "2 legs"], ["3", "3 legs"], ["4", "4 legs"], ["5", "5 legs"], ["6", "6 legs"]] as const;
const TARGETS = [["1.8", "1.80"], ["2.0", "2.00"], ["2.5", "2.50"], ["3.0", "3.00"]] as const;

export default async function TwoOddsPage({
  searchParams,
}: { searchParams: Record<string, string | undefined> }) {
  const res = await loadAppData();
  if (res.state === "warming") return <WarmingUp loaded={res.loaded} total={res.total} />;
  if (res.state === "error") return <ProviderFailure error={res.error} />;
  const data = res.data;

  const targetOdds = clamp(Number(searchParams.target ?? DEFAULT_TARGET_ODDS), 1.01, 50, DEFAULT_TARGET_ODDS);
  const minProbability = clamp(Number(searchParams.minProb ?? DEFAULT_MIN_PROBABILITY), 50, 99, DEFAULT_MIN_PROBABILITY);
  const maxLegs = Math.round(clamp(Number(searchParams.legs ?? DEFAULT_MAX_LEGS), 2, 10, DEFAULT_MAX_LEGS));
  const horizonRaw = Math.round(clamp(Number(searchParams.horizon ?? 3), 1, 7, 3));
  const horizonDays = (horizonRaw <= 1 ? 1 : horizonRaw >= 7 ? 7 : 3) as 1 | 3 | 7;
  const tierRaw = Math.round(clamp(Number(searchParams.tier ?? 0), 0, 3, 0));
  const tier = tierRaw >= 1 && tierRaw <= 3 ? tierRaw : 0;
  const leagueId = searchParams.league ?? "";

  const slip = getBankerSlip(data, {
    targetOdds, minProbability, maxLegs, horizonDays, tier,
    leagueId: leagueId || undefined,
  });

  const sel =
    "bg-surface border border-edge rounded px-2 py-1.5 text-[12px] font-mono text-sec focus:outline-none focus:border-acc/50";

  return (
    <div>
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" style={{ fontStretch: "120%" }}>
            {targetOdds.toFixed(2)} ODDS BANKER
          </h1>
          <p className="text-[12px] text-sec mt-0.5">
            A high-confidence accumulator built strictly from{" "}
            <span className="text-fg">Over 1.5 Goals</span> and{" "}
            <span className="text-fg">2nd Half Over 0.5 Goals</span> — one pick per match, no
            shared teams, priced to land on {targetOdds.toFixed(2)}.
          </p>
        </div>
        <div className="font-mono text-[10px] text-mut text-right">
          <div>{data.mode} MODE · provider: {data.providerId}</div>
          <div>kickoffs in {APP_TZ_LABEL}</div>
        </div>
      </div>

      {/* controls */}
      <form className="mt-4 flex flex-wrap gap-2 items-center bg-surface border border-edge rounded p-3">
        <label className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] tracking-widest text-mut">TARGET</span>
          <select name="target" defaultValue={String(targetOdds)} className={sel}>
            {TARGETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] tracking-widest text-mut">FLOOR</span>
          <select name="minProb" defaultValue={String(minProbability)} className={sel}>
            {FLOORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] tracking-widest text-mut">MAX LEGS</span>
          <select name="legs" defaultValue={String(maxLegs)} className={sel}>
            {LEGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] tracking-widest text-mut">WINDOW</span>
          <select name="horizon" defaultValue={String(horizonDays)} className={sel}>
            {HORIZONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] tracking-widest text-mut">LEAGUE</span>
          <select name="league" defaultValue={leagueId} className={sel}>
            <option value="">All leagues</option>
            {data.leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="font-mono text-[9px] tracking-widest text-mut">TIER</span>
          <select name="tier" defaultValue={String(tier)} className={sel}>
            <option value="0">All</option>
            <option value="1">Tier 1</option>
            <option value="2">Tier 2</option>
            <option value="3">Tier 3</option>
          </select>
        </label>
        <button className="font-mono text-[11px] tracking-widest px-3 py-1.5 rounded border border-acc/50 text-acc hover:bg-acc hover:text-ink transition-colors">
          REBUILD SLIP
        </button>
        <span className="ml-auto font-mono text-[10px] text-mut">
          {slip.candidateCount} eligible leg{slip.candidateCount === 1 ? "" : "s"} in window
        </span>
      </form>

      {/* headline numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3">
        {[
          ["COMBINED ODDS", slip.combinedOdds?.toFixed(2) ?? "—", slip.targetReached ? "text-acc" : "text-warn"],
          ["TARGET", targetOdds.toFixed(2), "text-sec"],
          ["COMBINED PROBABILITY", slip.combinedProbability !== null ? `${slip.combinedProbability.toFixed(1)}%` : "—", "text-fg"],
          ["MARKET IMPLIED", slip.impliedProbability !== null ? `${slip.impliedProbability.toFixed(1)}%` : "—", "text-sec"],
        ].map(([label, value, cls]) => (
          <Panel key={label} corner className="p-3">
            <div className="font-mono text-[9px] tracking-widest text-mut">{label}</div>
            <div className={`font-mono text-2xl font-semibold tabular-nums mt-1 ${cls}`}>{value}</div>
          </Panel>
        ))}
      </div>

      {/* the slip */}
      <SectionTitle
        right={
          <span className="font-mono text-[9px] tracking-widest text-mut">
            WHITELIST: {BANKER_MARKET_CODES.join(" · ")}
          </span>
        }
      >
        The Slip · {slip.legs.length} leg{slip.legs.length === 1 ? "" : "s"}
      </SectionTitle>

      {slip.legs.length === 0 ? (
        <Panel className="p-8 text-center font-mono text-[11px] text-mut">
          NO SELECTIONS CLEARED THE {minProbability}% FLOOR IN THIS WINDOW — the banker never pads a
          slip with weaker or off-whitelist picks. Widen the window or lower the floor.
        </Panel>
      ) : (
        <Panel className="overflow-x-auto">
          <table className="w-full text-[12px] min-w-[720px]">
            <thead>
              <tr className="border-b border-edge font-mono text-[9px] tracking-widest text-mut text-left">
                <th className="px-3 py-2 font-normal">#</th>
                <th className="px-3 py-2 font-normal">MATCH</th>
                <th className="px-3 py-2 font-normal">KICKOFF</th>
                <th className="px-3 py-2 font-normal">SELECTION</th>
                <th className="px-3 py-2 font-normal text-right">PROB</th>
                <th className="px-3 py-2 font-normal text-right">EDGE</th>
                <th className="px-3 py-2 font-normal text-right">ODDS</th>
              </tr>
            </thead>
            <tbody>
              {slip.legs.map((leg, i) => (
                <tr key={leg.fixtureId} className="border-b border-edge/50 last:border-0 hover:bg-surface2/60">
                  <td className="px-3 py-2 font-mono text-[11px] text-mut">{String(i + 1).padStart(2, "0")}</td>
                  <td className="px-3 py-2">
                    <Link href={`/match/${leg.fixtureId}`} className="hover:text-acc font-medium">
                      {leg.match}
                    </Link>
                    <div className="font-mono text-[9px] text-mut">{leg.leagueName}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-sec tabular-nums whitespace-nowrap">
                    {fmtDateTime(leg.kickoffUtc)}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-sec">{leg.marketLabel}</span>
                    <div className="font-mono text-[9px] text-mut">
                      {leg.seasonHits}/{leg.seasonTotal} season · league {leg.leagueRate.toFixed(0)}% · n≈{leg.sampleSize}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-fg">{leg.probability.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-sec">E{leg.edgeScore}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-acc whitespace-nowrap">
                    {leg.odds.toFixed(2)}
                    {leg.oddsSource === "MODEL" && (
                      <span className="block font-mono text-[8px] text-warn tracking-widest">MODEL</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* market mix */}
      {slip.legs.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-2 mt-2">
          {BANKER_MARKET_CODES.map((code) => {
            const n = slip.legs.filter((l) => l.marketCode === code).length;
            return (
              <Panel key={code} className="p-3">
                <div className="font-mono text-[9px] tracking-widest text-mut">{BANKER_MARKET_LABELS[code]}</div>
                <div className="font-mono text-lg tabular-nums text-sec mt-0.5">
                  {n} leg{n === 1 ? "" : "s"}
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {/* anti-correlation contract */}
      <SectionTitle>Anti-Correlation Contract</SectionTitle>
      <Panel className="p-3 space-y-1.5 text-[12px] text-sec">
        <div className="flex gap-2"><span className="text-acc font-mono">✓</span> At most one selection per fixture — same-match outcomes are never multiplied together.</div>
        <div className="flex gap-2"><span className="text-acc font-mono">✓</span> No two selections share a team — a team&apos;s scoring environment moves both of its fixtures together.</div>
        <div className="flex gap-2"><span className="text-acc font-mono">✓</span> Only <span className="font-mono text-fg">{BANKER_MARKET_CODES.join(" / ")}</span> are eligible; nothing else can enter the slip.</div>
        <div className="flex gap-2"><span className="text-acc font-mono">✓</span> Every leg clears ≥{minProbability}% on a sample of ≥12 comparable matches.</div>
        <div className="flex gap-2"><span className="text-acc font-mono">✓</span> Only fixtures that have not kicked off are eligible — locked snapshots are never re-priced.</div>
      </Panel>

      {slip.warnings.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {slip.warnings.map((w, i) => (
            <p key={i} className="text-[11px] text-warn border border-warn/30 rounded px-2 py-1.5">{w}</p>
          ))}
        </div>
      )}

      <p className="mt-4 font-mono text-[10px] text-mut leading-relaxed">
        Odds provenance: {slip.oddsSource === "FEED"
          ? "bookmaker prices supplied by the configured data provider."
          : slip.oddsSource === "MODEL"
            ? "model-derived fair odds (100 ÷ probability) — no bookmaker feed is configured, so these are not quotes."
            : slip.oddsSource === "MIXED"
              ? "a mix of provider prices and model-derived fair odds."
              : "n/a."}{" "}
        Probabilities are statistical estimates, not guarantees. An accumulator fails if any single
        leg fails. Nothing here is betting advice.
      </p>
    </div>
  );
}

function clamp(n: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
