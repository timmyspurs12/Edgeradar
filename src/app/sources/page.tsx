import { resolveProvider, providerStatus } from "@/lib/providers";
import { WarmingUpError } from "@/lib/providers/types";
import { timeAgo } from "@/lib/format";
import { Panel, SectionTitle } from "@/components/ui";
import { WarmingUp } from "@/components/WarmingUp";
import { ProviderFailure } from "@/components/ProviderFailure";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: allow slow live-data cold starts

export default async function SourcesPage() {
  // This page must stay readable even when the provider is misconfigured —
  // it is the page that tells you what to fix. So the registry is rendered
  // first and the failure is shown alongside it rather than throwing.
  let provider: ReturnType<typeof resolveProvider>["provider"] | null = null;
  let resolveError: unknown = null;
  try {
    provider = resolveProvider().provider;
  } catch (e) {
    resolveError = e;
  }

  const registry = providerStatus();

  let sources: Awaited<ReturnType<NonNullable<typeof provider>["getSources"]>> = [];
  let sourceError: unknown = null;
  if (provider) {
    try {
      sources = await provider.getSources();
    } catch (e) {
      if (e instanceof WarmingUpError) return <WarmingUp loaded={e.loaded} total={e.total} />;
      sourceError = e;
    }
  }
  const failure = resolveError ?? sourceError;

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight" style={{ fontStretch: "120%" }}>DATA SOURCES</h1>
      <p className="text-[12px] text-sec mt-0.5">
        Provider abstraction layer status. The engine and frontend never talk to a vendor directly —
        swap providers via environment configuration. Exactly one provider serves the app; demo and
        live data are never mixed.
      </p>

      {failure ? <ProviderFailure error={failure} /> : null}

      {provider && !failure && (
        <>
      <SectionTitle right={<span className="font-mono text-[9px] tracking-widest text-mut">MODE: {provider.mode}</span>}>
        Active Provider · {provider.name}
      </SectionTitle>
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
        </>
      )}

      <SectionTitle>Provider Registry · set DATA_PROVIDER to switch</SectionTitle>
      <Panel className="overflow-x-auto">
        <table className="w-full text-[12px] min-w-[620px]">
          <thead>
            <tr className="border-b border-edge font-mono text-[9px] tracking-widest text-mut text-left">
              <th className="px-3 py-2 font-normal">DATA_PROVIDER</th>
              <th className="px-3 py-2 font-normal">SOURCE</th>
              <th className="px-3 py-2 font-normal">MODE</th>
              <th className="px-3 py-2 font-normal">REQUIRED ENV</th>
              <th className="px-3 py-2 font-normal text-right">STATE</th>
            </tr>
          </thead>
          <tbody>
            {registry.map((p) => (
              <tr key={p.id} className={`border-b border-edge/50 last:border-0 ${p.active ? "bg-surface2/70" : ""}`}>
                <td className="px-3 py-2 font-mono text-[11px] text-fg">{p.id}</td>
                <td className="px-3 py-2 text-sec">{p.name}</td>
                <td className="px-3 py-2 font-mono text-[10px] tracking-widest">
                  <span className={p.mode === "DEMO" ? "text-warn" : "text-acc"}>{p.mode}</span>
                </td>
                <td className="px-3 py-2 font-mono text-[10px] text-mut">
                  {p.missing.length === 0
                    ? (p.id === "custom" ? "CUSTOM_API_URL · CUSTOM_API_KEY"
                      : p.id === "api-football" ? "APIFOOTBALL_KEY"
                      : p.id === "football-data" ? "FOOTBALL_DATA_API_KEY"
                      : p.id === "openfootball" ? "none (OPENFOOTBALL_* optional)"
                      : "none")
                    : <span className="text-bad">missing: {p.missing.join(", ")}</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {p.active
                    ? <span className="font-mono text-[9px] tracking-widest text-acc border border-acc/40 rounded-sm px-1.5 py-0.5">ACTIVE</span>
                    : p.configured
                      ? <span className="font-mono text-[9px] tracking-widest text-sec border border-edge rounded-sm px-1.5 py-0.5">READY</span>
                      : <span className="font-mono text-[9px] tracking-widest text-mut border border-edge rounded-sm px-1.5 py-0.5">UNCONFIGURED</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <p className="font-mono text-[10px] text-mut mt-1.5">
        Unset → auto-detected in the order above (custom → api-football → football-data →
        openfootball when OPENFOOTBALL_ENABLED=1 → demo). Requesting a live provider without its
        credentials is a hard configuration error, never a silent downgrade to demo data.
      </p>

      <SectionTitle>Connecting Live Data</SectionTitle>
      <Panel className="p-4">
        <ol className="text-[12px] text-sec space-y-2 list-decimal pl-4">
          <li>
            Point EdgeRadar at your own JSON endpoint with{" "}
            <span className="font-mono text-fg">DATA_PROVIDER=custom</span> plus{" "}
            <span className="font-mono text-fg">CUSTOM_API_URL</span> (and{" "}
            <span className="font-mono text-fg">CUSTOM_API_KEY</span> if it needs a secret). The
            contract is documented at the top of{" "}
            <span className="font-mono text-fg">src/lib/providers/customapi.ts</span>.
          </li>
          <li>
            Or use a built-in provider: <span className="font-mono text-fg">api-football</span>,{" "}
            <span className="font-mono text-fg">football-data</span> or{" "}
            <span className="font-mono text-fg">openfootball</span>. To add another, implement{" "}
            <span className="font-mono text-fg">FootballDataProvider</span> and register it in{" "}
            <span className="font-mono text-fg">src/lib/providers/index.ts</span>.
          </li>
          <li>
            Keys go in server-side env vars only — they are never shipped to the browser; all vendor
            requests run in server routes.
          </li>
          <li>
            Connect <span className="font-mono text-fg">DATABASE_URL</span> (PostgreSQL) and run{" "}
            <span className="font-mono text-fg">prisma migrate dev</span> — the full schema ships in{" "}
            <span className="font-mono text-fg">prisma/schema.prisma</span> (fixtures, predictions,
            immutable snapshots, results, odds, injuries, lineups, broadcast evidence, model versions).
          </li>
          <li>
            Rules the app enforces regardless of provider: no fabricated statistics (missing data
            renders as &quot;Data unavailable&quot;), demo and live data are never mixed, snapshots
            lock at kickoff, and a live provider that fails surfaces an error boundary rather than
            synthetic numbers.
          </li>
        </ol>
      </Panel>
    </div>
  );
}
