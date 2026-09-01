import { getProvider } from "@/lib/providers";
import { WarmingUpError } from "@/lib/providers/types";
import { timeAgo } from "@/lib/format";
import { Panel, SectionTitle } from "@/components/ui";
import { WarmingUp } from "@/components/WarmingUp";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: allow slow live-data cold starts

export default async function SourcesPage() {
  const provider = getProvider();
  let sources;
  try {
    sources = await provider.getSources();
  } catch (e) {
    if (e instanceof WarmingUpError) return <WarmingUp loaded={e.loaded} total={e.total} />;
    throw e;
  }

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight" style={{ fontStretch: "120%" }}>DATA SOURCES</h1>
      <p className="text-[12px] text-sec mt-0.5">
        Provider abstraction layer status. The engine and frontend never talk to a vendor directly —
        swap providers via environment configuration.
      </p>

      <SectionTitle>Active Providers · mode: {provider.mode}</SectionTitle>
      <div className="grid md:grid-cols-2 gap-2">
        {sources.map((s) => (
          <Panel key={s.id} corner className="p-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium">{s.name}</span>
              <span className={`font-mono text-[9px] px-1.5 py-0.5 border rounded-sm tracking-widest ${s.mode === "DEMO" ? "text-warn border-warn/40" : "text-acc border-acc/40"}`}>
                {s.mode}
              </span>
              <span className={`ml-auto font-mono text-[9px] px-1.5 py-0.5 border rounded-sm ${s.status === "LIVE" ? "text-acc border-acc/30" : s.status === "RECENT" ? "text-sec border-edge" : "text-bad border-bad/40"}`}>
                {s.status}
              </span>
            </div>
            <div className="font-mono text-[10px] text-mut mt-1">
              kind: {s.kind} · last updated {timeAgo(s.lastUpdated)}
            </div>
            <p className="text-[11px] text-sec mt-1.5">{s.notes}</p>
          </Panel>
        ))}
      </div>

      <SectionTitle>Connecting Live Data</SectionTitle>
      <Panel className="p-4">
        <ol className="text-[12px] text-sec space-y-2 list-decimal pl-4">
          <li>
            Implement <span className="font-mono text-fg">FootballDataProvider</span> in{" "}
            <span className="font-mono text-fg">src/lib/providers/</span> (interfaces: LeaguesProvider,
            FixturesProvider, StatisticsProvider, InjuryProvider, OddsProvider, BroadcastProvider).
          </li>
          <li>
            Register it in <span className="font-mono text-fg">src/lib/providers/index.ts</span> and set{" "}
            <span className="font-mono text-fg">DATA_PROVIDER=live</span>.
          </li>
          <li>
            Keys go in server-side env vars only (<span className="font-mono text-fg">FOOTBALL_API_KEY</span>,{" "}
            <span className="font-mono text-fg">ODDS_API_KEY</span>) — they are never shipped to the browser;
            all vendor requests run in server routes.
          </li>
          <li>
            Connect <span className="font-mono text-fg">DATABASE_URL</span> (PostgreSQL) and run{" "}
            <span className="font-mono text-fg">prisma migrate dev</span> — the full schema ships in{" "}
            <span className="font-mono text-fg">prisma/schema.prisma</span> (fixtures, predictions,
            immutable snapshots, results, odds, injuries, lineups, broadcast evidence, model versions).
          </li>
          <li>
            Rules the app enforces regardless of provider: no fabricated statistics (missing data renders
            as &quot;Data unavailable&quot;), demo and live data are never mixed, snapshots lock at kickoff,
            stale sources reduce confidence.
          </li>
        </ol>
      </Panel>
    </div>
  );
}
