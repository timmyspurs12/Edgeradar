import { ConfidenceTier } from "./types";

// All timestamps render in the app display timezone (configurable via DISPLAY_TZ).
export const APP_TZ = process.env.DISPLAY_TZ || "Africa/Lagos";
export const APP_TZ_LABEL = APP_TZ === "Africa/Lagos" ? "WAT" : APP_TZ;

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: APP_TZ });

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: APP_TZ });

export const fmtDateTime = (iso: string) => `${fmtDate(iso)} · ${fmtTime(iso)}`;

// Day-key in display TZ (used to group "today's" fixtures the way the user sees them).
export const dayKeyInTz = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-CA", { timeZone: APP_TZ }); // YYYY-MM-DD

export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function tierLabel(t: ConfidenceTier): string {
  switch (t) {
    case "EXTREME": return "EXTREME";
    case "VERY_HIGH": return "VERY HIGH";
    case "HIGH": return "HIGH";
    case "MODERATE_HIGH": return "MOD-HIGH";
    case "MODERATE": return "MODERATE";
    default: return "LOW";
  }
}

export function tierClass(t: ConfidenceTier): string {
  switch (t) {
    case "EXTREME":
    case "VERY_HIGH": return "text-acc border-acc/40";
    case "HIGH": return "text-acc/80 border-acc/25";
    case "MODERATE_HIGH": return "text-warn border-warn/30";
    case "MODERATE": return "text-warn/80 border-warn/25";
    default: return "text-mut border-edge";
  }
}

export function probClass(p: number): string {
  if (p >= 85) return "text-acc";
  if (p >= 75) return "text-fg";
  if (p >= 65) return "text-sec";
  return "text-mut";
}

export function barClass(p: number): string {
  if (p >= 85) return "bg-acc";
  if (p >= 75) return "bg-acc/60";
  if (p >= 65) return "bg-sec/60";
  return "bg-mut/50";
}
