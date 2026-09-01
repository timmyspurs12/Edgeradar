import Link from "next/link";
import { tryGetAppData } from "@/lib/service";
import { WarmingUp } from "@/components/WarmingUp";
import { dayKeyInTz } from "@/lib/format";
import { MatchRow } from "@/components/MatchRow";
import { Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

const RANGES = [
  ["today", "Today"], ["tomorrow", "Tomorrow"], ["3d", "Next 3 Days"], ["7d", "Next 7 Days"], ["all", "All Upcoming"], ["finished", "Finished"],
] as const;
const CONFS = [["0", "Any conf."], ["75", "≥75%"], ["80", "≥80%"], ["85", "≥85%"], ["90", "≥90%"]] as const;
const TIERS = [["0", "All tiers"], ["1", "Tier 1"], ["2", "Tier 2"], ["3", "Tier 3"]] as const;
const CASTS = [["all", "Any coverage"], ["verified", "Broadcast verified"]] as const;

export default async function Matches({
  searchParams,
}: { searchParams: Record<string, string | undefined> }) {
  const res = await tryGetAppData();
  if (res.warming) return <WarmingUp loaded={res.loaded} total={res.total} />;
  const data = res.data;
  const q = (searchParams.q ?? "").toLowerCase().trim();
  const range = searchParams.range ?? (q ? "all" : "3d");
  const conf = Number(searchParams.conf ?? 0);
  const tier = Number(searchParams.tier ?? 0);
  const lgFilter = searchParams.league ?? "";
  const cast = searchParams.cast ?? "all";

  const now = Date.now();
  const todayKey = dayKeyInTz(new Date());
  const tomorrowKey = dayKeyInTz(new Date(now + 86400000));

  const team = (id: string) => data.teams.find((t) => t.id === id)!;
  const league = (id: string) => data.leagues.find((l) => l.id === id)!;

  let list = data.fixtures.filter((f) => {
    const ko = new Date(f.kickoff).getTime();
    if (range === "finished") return f.status === "FINISHED";
    if (f.status === "FINISHED") return false;
    if (range === "today") return dayKeyInTz(f.kickoff) === todayKey;
    if (range === "tomorrow") return dayKeyInTz(f.kickoff) === tomorrowKey;
    if (range === "3d") return ko <= now + 3 * 86400000;
    if (range === "7d") return ko <= now + 7 * 86400000;
    return true;
  });

  list = list.filter((f) => {
    const lg = league(f.leagueId);
    if (tier && lg.tier !== tier) return false;
    if (lgFilter && lg.id !== lgFilter) return false;
    if (cast === "verified" && lg.broadcastStatus !== "BROADCAST_VERIFIED") return false;
    if (conf) {
      const p = data.predictions.get(f.id);
      if (!p || p.matchConfidence < conf) return false;
    }
    if (q) {
      const hay = `${team(f.homeId).name} ${team(f.awayId).name} ${lg.name} ${lg.country}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  list.sort((a, b) => a.kickoff.localeCompare(b.kickoff));

  const sel = "bg-surface border border-edge rounded px-2 py-1.5 text-[12px] font-mono text-sec focus:outline-none focus:border-acc/50";

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight" style={{ fontStretch: "120%" }}>MATCH CENTER</h1>
      <p className="text-[12px] text-sec mt-0.5">Fixture discovery with pre-match prediction status. Predictions lock at kickoff.</p>

      {/* sticky filter bar */}
      <form className="sticky top-12 z-20 bg-ink/95 backdrop-blur py-2 -mx-3 px-3 md:mx-0 md:px-0 border-b border-edge mt-3 flex flex-wrap gap-2 items-center">
        <select name="range" defaultValue={range} className={sel}>
          {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
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
        <span className="ml-auto font-mono text-[10px] text-mut">{list.length} fixtures</span>
      </form>

      {q && (
        <div className="mt-2 font-mono text-[11px] text-sec">
          Search: <span className="text-acc">&quot;{q}&quot;</span>{" "}
          <Link href="/matches" className="text-mut hover:text-fg">✕ clear</Link>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-2 mt-3">
        {list.map((f) => (
          <MatchRow
            key={f.id} fx={f} home={team(f.homeId)} away={team(f.awayId)}
            league={league(f.leagueId)} pred={data.predictions.get(f.id)}
          />
        ))}
      </div>
      {list.length === 0 && (
        <Panel className="p-8 text-center font-mono text-[11px] text-mut mt-3">
          NO FIXTURES MATCH THESE FILTERS
        </Panel>
      )}
    </div>
  );
}
