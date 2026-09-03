import Link from "next/link";
import { loadAppData } from "@/lib/service";
import { WarmingUp } from "@/components/WarmingUp";
import { ProviderFailure } from "@/components/ProviderFailure";
import { MatchRow } from "@/components/MatchRow";
import { Panel } from "@/components/ui";
import { queryFixtures, FixtureRange, StatusFilter } from "@/lib/repository";
import { APP_TZ_LABEL } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: allow slow live-data cold starts

const RANGES: [FixtureRange, string][] = [
  ["today", "Today"], ["tomorrow", "Tomorrow"], ["3d", "Next 3 Days"],
  ["7d", "Next 7 Days"], ["all", "Everything"], ["finished", "Finished"],
];
const STATUSES: [StatusFilter, string][] = [
  ["ALL", "Any status"], ["UPCOMING", "Upcoming"], ["LIVE", "In play"], ["FINISHED", "Finished"],
];
const CONFS = [["0", "Any conf."], ["75", "≥75%"], ["80", "≥80%"], ["85", "≥85%"], ["90", "≥90%"]] as const;
const TIERS = [["0", "All tiers"], ["1", "Tier 1"], ["2", "Tier 2"], ["3", "Tier 3"]] as const;
const CASTS = [["all", "Any coverage"], ["verified", "Broadcast verified"]] as const;

export default async function Matches({
  searchParams,
}: { searchParams: Record<string, string | undefined> }) {
  const res = await loadAppData();
  if (res.state === "warming") return <WarmingUp loaded={res.loaded} total={res.total} />;
  if (res.state === "error") return <ProviderFailure error={res.error} />;
  const data = res.data;

  const q = (searchParams.q ?? "").toLowerCase().trim();
  const rangeRaw = searchParams.range ?? (q ? "all" : "3d");
  const range: FixtureRange = RANGES.some(([v]) => v === rangeRaw) ? (rangeRaw as FixtureRange) : "3d";
  const statusRaw = searchParams.status ?? "ALL";
  const status: StatusFilter = STATUSES.some(([v]) => v === statusRaw) ? (statusRaw as StatusFilter) : "ALL";
  const conf = Number(searchParams.conf ?? 0);
  const tier = Number(searchParams.tier ?? 0);
  const lgFilter = searchParams.league ?? "";
  const cast = (searchParams.cast ?? "all") as "all" | "verified";

  // Single source of truth: timezone day boundaries, status handling and
  // sorting all happen inside queryFixtures.
  const rows = queryFixtures(data, {
    range,
    status,
    leagueId: lgFilter || undefined,
    tier: Number.isFinite(tier) ? tier : 0,
    minConfidence: Number.isFinite(conf) ? conf : 0,
    cast,
    searchQuery: q,
  });

  const sel = "bg-surface border border-edge rounded px-2 py-1.5 text-[12px] font-mono text-sec focus:outline-none focus:border-acc/50";

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight" style={{ fontStretch: "120%" }}>MATCH CENTER</h1>
      <p className="text-[12px] text-sec mt-0.5">
        Fixture discovery with pre-match prediction status. Day windows follow {APP_TZ_LABEL};
        predictions lock at kickoff.
      </p>

      {/* sticky filter bar */}
      <form className="sticky top-12 z-20 bg-ink/95 backdrop-blur py-2 -mx-3 px-3 md:mx-0 md:px-0 border-b border-edge mt-3 flex flex-wrap gap-2 items-center">
        <select name="range" defaultValue={range} className={sel}>
          {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="status" defaultValue={status} className={sel}>
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="league" defaultValue={lgFilter} className={sel}>
          <option value="">All leagues</option>
          {data.leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select name="tier" defaultValue={String(tier)} className={sel}>
          {TIERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="conf" defaultValue={String(conf)} className={sel}>
          {CONFS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="cast" defaultValue={cast} className={sel}>
          {CASTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {q && <input type="hidden" name="q" value={q} />}
        <button className="font-mono text-[11px] tracking-widest px-3 py-1.5 rounded border border-acc/50 text-acc hover:bg-acc hover:text-ink transition-colors">
          APPLY
        </button>
        <span className="ml-auto font-mono text-[10px] text-mut">{rows.length} fixtures</span>
      </form>

      {q && (
        <div className="mt-2 font-mono text-[11px] text-sec">
          Search: <span className="text-acc">&quot;{q}&quot;</span>{" "}
          <Link href="/matches" className="text-mut hover:text-fg">✕ clear</Link>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-2 mt-3">
        {rows.map((r) => (
          <MatchRow
            key={r.fixture.id} fx={r.fixture} home={r.homeTeam} away={r.awayTeam}
            league={r.league} pred={r.prediction ?? undefined}
          />
        ))}
      </div>
      {rows.length === 0 && (
        <Panel className="p-8 text-center font-mono text-[11px] text-mut mt-3">
          NO FIXTURES MATCH THESE FILTERS
        </Panel>
      )}
    </div>
  );
}
