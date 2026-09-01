"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-lg mx-auto mt-16 border border-bad/40 rounded bg-surface p-6">
      <div className="font-mono text-[11px] tracking-widest text-bad">DATA PROVIDER ERROR</div>
      <p className="text-[13px] text-sec mt-2 leading-relaxed">
        EdgeRadar could not load data from the configured provider. Nothing was substituted or
        fabricated — the app refuses to mix demo and live data silently.
      </p>
      <ul className="text-[12px] text-mut mt-3 space-y-1 list-disc pl-4">
        <li>Check <span className="font-mono text-sec">FOOTBALL_DATA_API_KEY</span> in <span className="font-mono text-sec">.env.local</span> (free key: football-data.org/client/register)</li>
        <li>Or force demo mode with <span className="font-mono text-sec">DATA_PROVIDER=demo</span></li>
        <li>The free tier allows 10 requests/minute — a cold start can take ~1–2 minutes; retry shortly</li>
      </ul>
      <button
        onClick={reset}
        className="mt-4 font-mono text-[11px] tracking-widest px-3 py-1.5 rounded border border-acc/50 text-acc hover:bg-acc hover:text-ink transition-colors"
      >
        RETRY
      </button>
    </div>
  );
}
