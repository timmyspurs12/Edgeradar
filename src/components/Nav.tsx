"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Dashboard", code: "DSH" },
  { href: "/matches", label: "Matches", code: "MTC" },
  { href: "/leagues", label: "Leagues", code: "LGE" },
  { href: "/radar", label: "League Radar", code: "RDR" },
  { href: "/builder", label: "Combination", code: "CMB" },
  { href: "/track-record", label: "Track Record", code: "TRK" },
  { href: "/model", label: "Model", code: "MDL" },
  { href: "/sources", label: "Data Sources", code: "SRC" },
];

const MOBILE = [
  { href: "/", label: "Radar" },
  { href: "/matches", label: "Matches" },
  { href: "/leagues", label: "Leagues" },
  { href: "/track-record", label: "Record" },
  { href: "/model", label: "Model" },
];

export function Nav() {
  const path = usePathname();
  const active = (href: string) =>
    href === "/" ? path === "/" : path.startsWith(href);

  return (
    <>
      {/* desktop sidebar */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-52 flex-col border-r border-edge bg-ink z-40">
        <Link href="/" className="px-4 py-4 border-b border-edge block">
          <div className="font-mono text-[10px] text-mut tracking-widest">PRE-MATCH TERMINAL</div>
          <div className="text-lg font-semibold tracking-tight" style={{ fontStretch: "125%" }}>
            EDGE<span className="text-acc">RADAR</span>
          </div>
        </Link>
        <nav className="flex-1 py-2">
          {ITEMS.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className={`flex items-center justify-between px-4 py-2 text-[13px] border-l-2 transition-colors ${
                active(it.href)
                  ? "border-acc text-fg bg-surface"
                  : "border-transparent text-sec hover:text-fg hover:bg-surface/60"
              }`}
            >
              <span>{it.label}</span>
              <span className={`font-mono text-[9px] ${active(it.href) ? "text-acc" : "text-mut"}`}>{it.code}</span>
            </Link>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-edge">
          <div className="font-mono text-[10px] text-mut">MODEL</div>
          <div className="font-mono text-[11px] text-sec">EdgeRadar v1.0</div>
        </div>
      </aside>

      {/* mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-surface border-t border-edge flex">
        {MOBILE.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className={`flex-1 py-3 text-center text-[11px] font-medium border-t-2 ${
              active(it.href) ? "border-acc text-acc" : "border-transparent text-sec"
            }`}
          >
            {it.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
