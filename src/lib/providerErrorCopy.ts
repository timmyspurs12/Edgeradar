import { ProviderConfigError, ProviderError, WarmingUpError } from "./providers/types";

/**
 * Shared copy + classification for provider failures.
 *
 * Kept free of React so both the server-rendered `ProviderFailure` panel and
 * the client-side `error.tsx` boundary show the exact same guidance.
 */

export type ProviderFailureKind = "CONFIG" | "UPSTREAM" | "WARMUP" | "UNKNOWN";

export interface DescribedProviderError {
  kind: ProviderFailureKind;
  title: string;
  message: string;
  hints: string[];
  /** True when retrying without changing anything could succeed. */
  retryable: boolean;
}

export function describeProviderError(e: unknown): DescribedProviderError {
  const err = e as (Error & { missing?: string[] }) | undefined;
  const message = err?.message || "Unknown data provider failure.";

  if (e instanceof ProviderConfigError || err?.name === "ProviderConfigError") {
    return {
      kind: "CONFIG",
      title: "DATA PROVIDER MISCONFIGURED",
      message,
      retryable: false,
      hints: [
        `Set the missing variable${err?.missing && err.missing.length > 1 ? "s" : ""} ${
          err?.missing?.length ? `(${err.missing.join(", ")}) ` : ""
        }in the environment. On Vercel: Project → Settings → Environment Variables, then redeploy.`,
        "Valid providers: custom, api-football, football-data, openfootball, demo.",
        "Set DATA_PROVIDER=demo to opt into the clearly labeled synthetic dataset — it is never selected silently.",
      ],
    };
  }

  if (e instanceof WarmingUpError || err?.name === "WarmingUpError") {
    return {
      kind: "WARMUP",
      title: "LIVE DATA STILL WARMING UP",
      message,
      retryable: true,
      hints: [
        "Rate-limited free-tier APIs need 1–3 minutes on a cold start to fill the cache.",
        "This page refreshes on its own; no action needed.",
      ],
    };
  }

  if (e instanceof ProviderError || err?.name === "ProviderError") {
    const retryable = (e as ProviderError).retryable !== false;
    return {
      kind: "UPSTREAM",
      title: "LIVE DATA PROVIDER FAILURE",
      message,
      retryable,
      hints: retryable
        ? [
            "The upstream API is rate limiting or returning errors — this is usually transient. Retry shortly.",
            "Check the provider's status page and your plan's request quota.",
          ]
        : [
            "The provider returned a payload EdgeRadar cannot use (bad shape, no fixtures, unparseable kickoffs).",
            "Nothing was substituted — fix the upstream feed, or set DATA_PROVIDER=demo to opt into synthetic data explicitly.",
          ],
    };
  }

  return {
    kind: "UNKNOWN",
    title: "DATA PROVIDER ERROR",
    message,
    retryable: true,
    hints: [
      "Check DATA_PROVIDER and its credentials in the environment.",
      "Nothing was substituted or fabricated — in live mode EdgeRadar refuses to serve synthetic data in place of a real feed.",
    ],
  };
}

export const INTEGRITY_NOTE =
  "EdgeRadar never mixes demo and live data, and never silently downgrades: a live provider that " +
  "fails surfaces here instead of being replaced by synthetic numbers.";
