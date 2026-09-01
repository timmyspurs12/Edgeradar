import { Panel } from "./ui";

/**
 * Shown while the live provider warms its cache (free-tier APIs are heavily
 * rate-limited — first cold load fetches 10 competitions at 10 requests/min).
 * Auto-refreshes; once enough competitions are cached the real page renders.
 */
export function WarmingUp({ loaded, total }: { loaded: number; total: number }) {
  const pct = total ? Math.round((loaded / total) * 100) : 0;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-head-element */}
      <meta httpEquiv="refresh" content="10" />
      <div className="max-w-lg mx-auto mt-16">
        <Panel corner className="p-6">
          <div className="font-mono text-[11px] tracking-widest text-acc">LIVE DATA WARM-UP</div>
          <p className="text-[13px] text-sec mt-2 leading-relaxed">
            Fetching live competitions from football-data.org. The free tier allows
            10 requests/minute, so the first load takes about 1–3 minutes. This page
            refreshes automatically — no action needed.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <div className="h-[6px] flex-1 bg-surface2 rounded-sm overflow-hidden border border-edge/60">
              <div className="h-full bg-acc transition-all" style={{ width: `${Math.max(4, pct)}%` }} />
            </div>
            <span className="font-mono text-[12px] text-fg tabular-nums">{loaded}/{total}</span>
          </div>
          <p className="font-mono text-[10px] text-mut mt-3">
            competitions cached · results are stored on disk, so this wait only happens
            on a cold start or after the 30-minute cache expires
          </p>
        </Panel>
      </div>
    </>
  );
}
