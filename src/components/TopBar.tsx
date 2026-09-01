import Link from "next/link";
import { getProvider } from "@/lib/providers";
import { APP_TZ_LABEL } from "@/lib/format";

export function TopBar() {
  let mode: "DEMO" | "LIVE" = "DEMO";
  let modeError = false;
  try {
    mode = getProvider().mode;
  } catch {
    modeError = true;
  }

  return (
    <header className="sticky top-0 z-30 bg-ink/95 backdrop-blur border-b border-edge">
      <div className="flex items-center gap-3 px-3 md:px-6 h-12 max-w-[1400px] mx-auto">
        <Link href="/" className="md:hidden font-semibold tracking-tight text-sm">
          EDGE<span className="text-acc">RADAR</span>
        </Link>
        <form action="/matches" className="flex-1 max-w-md hidden sm:block">
          <input
            name="q"
            placeholder="Search team, league, country…"
            className="w-full bg-surface border border-edge rounded px-3 py-1.5 text-[13px] placeholder:text-mut focus:outline-none focus:border-acc/50 font-mono"
          />
        </form>
        <div className="flex-1 sm:hidden" />
        {modeError ? (
          <span className="font-mono text-[10px] px-2 py-1 rounded-sm border border-bad/40 text-bad tracking-widest whitespace-nowrap">
            PROVIDER MISCONFIGURED
          </span>
        ) : mode === "DEMO" ? (
          <span className="font-mono text-[10px] px-2 py-1 rounded-sm border border-warn/40 text-warn tracking-widest whitespace-nowrap">
            DEMO DATA
          </span>
        ) : (
          <span className="font-mono text-[10px] px-2 py-1 rounded-sm border border-acc/40 text-acc tracking-widest whitespace-nowrap">
            LIVE DATA
          </span>
        )}
        <span className="hidden md:inline font-mono text-[10px] text-mut whitespace-nowrap">
          {mode === "DEMO"
            ? `synthetic dataset — no live provider · times in ${APP_TZ_LABEL}`
            : `football-data.org · times in ${APP_TZ_LABEL}`}
        </span>
      </div>
    </header>
  );
}
