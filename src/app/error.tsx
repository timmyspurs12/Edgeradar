"use client";

import { describeProviderError, INTEGRITY_NOTE } from "@/lib/providerErrorCopy";

/**
 * Client-side error boundary.
 *
 * Pages already catch provider failures and render `<ProviderFailure>` inline,
 * so this is the backstop for anything else that throws during interaction
 * (hydration errors, unexpected runtime failures). Both surfaces share their
 * copy via `describeProviderError`, so a user never sees two different
 * explanations for the same problem.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const info = describeProviderError(error);

  return (
    <div className="max-w-xl mx-auto mt-16 border border-bad/40 rounded bg-surface p-6">
      <div className="font-mono text-[11px] tracking-widest text-bad">
        {info.title} · {error?.name ?? "ERROR"}
      </div>
      <p className="text-[13px] text-sec mt-2 leading-relaxed">{INTEGRITY_NOTE}</p>

      {info.message && (
        <pre className="mt-3 font-mono text-[11px] text-fg bg-ink border border-edge rounded p-2.5 whitespace-pre-wrap break-words">
          {info.message}
        </pre>
      )}

      <ul className="text-[12px] text-mut mt-3 space-y-1 list-disc pl-4">
        {info.hints.map((h) => (
          <li key={h}>{h}</li>
        ))}
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
