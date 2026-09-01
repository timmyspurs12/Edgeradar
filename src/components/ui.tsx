import { BroadcastStatus, ConfidenceTier, DataQuality, FixtureStatus } from "@/lib/types";
import { barClass, probClass, tierClass, tierLabel } from "@/lib/format";

export function Panel({ children, className = "", corner = false }: { children: React.ReactNode; className?: string; corner?: boolean }) {
  return (
    <div className={`bg-surface border border-edge rounded ${corner ? "corner" : ""} ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between mb-2 mt-6 first:mt-0">
      <h2 className="font-mono text-[11px] tracking-[0.18em] text-sec uppercase">{children}</h2>
      {right}
    </div>
  );
}

export function ProbBar({ p, className = "" }: { p: number; className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-[5px] flex-1 bg-surface2 rounded-sm overflow-hidden border border-edge/60">
        <div className={`h-full ${barClass(p)}`} style={{ width: `${Math.min(100, p)}%` }} />
      </div>
      <span className={`font-mono text-[12px] tabular-nums w-12 text-right ${probClass(p)}`}>
        {p.toFixed(1)}%
      </span>
    </div>
  );
}

export function StatusBadge({ status }: { status: FixtureStatus }) {
  const cls =
    status === "UPCOMING" ? "text-acc border-acc/40" :
    status === "LIVE" ? "text-warn border-warn/50" :
    "text-mut border-edge";
  return (
    <span className={`font-mono text-[9px] tracking-widest px-1.5 py-0.5 border rounded-sm ${cls}`}>
      {status}
    </span>
  );
}

export function BroadcastBadge({ status }: { status: BroadcastStatus }) {
  const map: Record<BroadcastStatus, [string, string]> = {
    BROADCAST_VERIFIED: ["BROADCAST VERIFIED", "text-acc/90 border-acc/30"],
    PUBLIC_COVERAGE_VERIFIED: ["PUBLIC COVERAGE", "text-sec border-edge"],
    LIMITED_DATA: ["LIMITED DATA", "text-warn border-warn/40"],
  };
  const [label, cls] = map[status];
  return (
    <span className={`font-mono text-[9px] tracking-wider px-1.5 py-0.5 border rounded-sm whitespace-nowrap ${cls}`}>
      {label}
    </span>
  );
}

export function QualityBadge({ q }: { q: DataQuality }) {
  const cls = q === "EXCELLENT" ? "text-acc/90 border-acc/30" : q === "GOOD" ? "text-sec border-edge" : q === "FAIR" ? "text-warn border-warn/40" : "text-bad border-bad/40";
  return (
    <span className={`font-mono text-[9px] tracking-wider px-1.5 py-0.5 border rounded-sm ${cls}`}>
      DATA {q}
    </span>
  );
}

export function TierBadge({ tier }: { tier: ConfidenceTier }) {
  return (
    <span className={`font-mono text-[9px] tracking-wider px-1.5 py-0.5 border rounded-sm whitespace-nowrap ${tierClass(tier)}`}>
      {tierLabel(tier)}
    </span>
  );
}

export function FlagChip({ flag }: { flag: string }) {
  const map: Record<string, [string, string]> = {
    TOP_EDGE: ["🔥 TOP EDGE", "text-acc border-acc/40"],
    LOW_SAMPLE: ["⚠ LOW SAMPLE", "text-warn border-warn/40"],
    CORRELATED: ["⚠ CORRELATED", "text-warn border-warn/40"],
    LOCKED: ["🔒 PRE-MATCH LOCKED", "text-sec border-edge"],
    AVOID: ["❌ AVOID", "text-bad border-bad/40"],
    STAT_EDGE: ["📊 STATISTICAL EDGE", "text-sec border-edge"],
  };
  const [label, cls] = map[flag] ?? [flag, "text-mut border-edge"];
  return (
    <span className={`font-mono text-[9px] tracking-wider px-1.5 py-0.5 border rounded-sm whitespace-nowrap ${cls}`}>
      {label}
    </span>
  );
}

export function EdgeScoreBox({ score }: { score: number }) {
  const cls = score >= 80 ? "text-acc border-acc/40" : score >= 70 ? "text-fg border-edge" : "text-sec border-edge";
  return (
    <div className={`border rounded-sm px-2 py-1 text-center ${cls}`}>
      <div className="font-mono text-[14px] leading-none tabular-nums font-semibold">{score}</div>
      <div className="font-mono text-[8px] tracking-widest text-mut mt-0.5">EDGE</div>
    </div>
  );
}

export function Medal({ i }: { i: number }) {
  return <span className="text-[14px]">{["🥇", "🥈", "🥉"][i] ?? "·"}</span>;
}
