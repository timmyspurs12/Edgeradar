"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[EdgeRadar Error Boundary]:", error);
  }, [error]);

  const msg = error?.message || "Unknown data provider error";

  return (
    <div className="max-w-xl mx-auto mt-12 border border-bad/50 rounded bg-surface p-6 shadow-lg">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] px-2 py-0.5 rounded-sm border border-bad/50 text-bad bg-bad/10 tracking-widest uppercase">
          DATA PROVIDER ERROR
        </span>
      </div>

      <h2 className="text-lg font-semibold text-fg mt-3">
        Could not load live football data
      </h2>
      <p className="text-[13px] text-sec mt-1.5 leading-relaxed">
        EdgeRadar could not fetch data from the configured live provider. Nothing was
        fabricated — the app enforces strict data integrity and refuses to mix demo and live data silently.
      </p>

      {/* Actual Error Details */}
      <div className="mt-4 p-3 bg-ink rounded border border-edge font-mono text-[12px] text-bad break-words">
        <div className="text-[10px] text-mut uppercase tracking-wider mb-1">Error Details:</div>
        {msg}
      </div>

      {/* Troubleshooting Checklist */}
      <div className="mt-4 border-t border-edge pt-3">
        <div className="font-mono text-[10px] text-mut uppercase tracking-wider mb-2">
          Troubleshooting on Vercel:
        </div>
        <ul className="text-[12px] text-sec space-y-2 list-disc pl-4">
          <li>
            <strong className="text-fg">If using API-Football (api-sports.io):</strong>
            <div className="text-[11px] text-mut mt-0.5">
              Verify <span className="font-mono text-sec">APIFOOTBALL_KEY</span> is set in{" "}
              <strong>Vercel Settings → Environment Variables</strong>. If set, trigger a{" "}
              <strong>Redeploy</strong> in Vercel Deployments.
            </div>
          </li>
          <li>
            <strong className="text-fg">If using football-data.org:</strong>
            <div className="text-[11px] text-mut mt-0.5">
              Verify <span className="font-mono text-sec">FOOTBALL_DATA_API_KEY</span> is set. Free tier
              has a 10 req/min rate limit — allow 1–2 minutes on first cold boot.
            </div>
          </li>
          <li>
            <strong className="text-fg">To run in Demo Mode (Synthetic dataset):</strong>
            <div className="text-[11px] text-mut mt-0.5">
              Set <span className="font-mono text-sec">DATA_PROVIDER=demo</span> in Vercel environment variables and redeploy.
            </div>
          </li>
        </ul>
      </div>

      <div className="mt-5 pt-3 border-t border-edge flex items-center gap-3">
        <button
          onClick={reset}
          className="font-mono text-[11px] tracking-widest px-4 py-2 rounded border border-acc/60 text-acc hover:bg-acc hover:text-ink transition-colors font-semibold"
        >
          RETRY REQUEST
        </button>
        <Link
          href="/sources"
          className="font-mono text-[11px] tracking-widest px-3 py-2 text-sec hover:text-fg"
        >
          DATA SOURCES →
        </Link>
      </div>
    </div>
  );
}
