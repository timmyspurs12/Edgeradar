import { Panel } from "./ui";
import { describeProviderError, INTEGRITY_NOTE } from "@/lib/providerErrorCopy";

/**
 * Server-rendered provider failure panel.
 *
 * Rendered inline by pages instead of relying on the `error.tsx` boundary: when
 * a Server Component throws during the initial request, the boundary only
 * appears after client hydration, so the raw HTTP response would be an empty
 * 500 shell. Catching in the page guarantees the explanation is in the HTML —
 * which also makes it visible to curl, crawlers and monitoring.
 */
export function ProviderFailure({ error }: { error: unknown }) {
  const info = describeProviderError(error);
  return (
    <div className="max-w-2xl mx-auto mt-10">
      <Panel corner className="p-6 border-bad/40">
        <div className="font-mono text-[11px] tracking-widest text-bad">{info.title}</div>
        <p className="text-[13px] text-sec mt-2 leading-relaxed">{INTEGRITY_NOTE}</p>

        <pre className="mt-3 font-mono text-[11px] text-fg bg-ink border border-edge rounded p-2.5 whitespace-pre-wrap break-words">
          {info.message}
        </pre>

        <ul className="text-[12px] text-mut mt-3 space-y-1.5 list-disc pl-4">
          {info.hints.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>

        {info.retryable && (
          <p className="mt-4 font-mono text-[10px] text-mut">
            This condition is usually transient — reload the page shortly.
          </p>
        )}
      </Panel>
    </div>
  );
}
