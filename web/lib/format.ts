import type { Decision, HazardType } from "./types";

export const DECISION_LABEL: Record<Decision, string> = {
  go: "Go",
  caution: "Caution",
  no_go: "No-go",
};

export const DECISION_LONG: Record<Decision, string> = {
  go: "Good to go",
  caution: "Go with care",
  no_go: "Don't go",
};

export const HAZARD_LABEL: Record<HazardType, string> = {
  closure: "Closure",
  wildlife: "Wildlife",
  weather: "Weather",
  fire: "Fire",
  water: "Water",
  geologic: "Geologic",
  construction: "Construction",
  air_quality: "Air quality",
  road: "Road",
  facility: "Facility",
  other: "Other",
};

export function hazardLabel(h: string): string {
  return (HAZARD_LABEL as Record<string, string>)[h] ?? h;
}

/** "Hawaiʻi Volcanoes National Park" → "Hawaiʻi Volcanoes" */
export function shortParkName(name: string): string {
  return name
    .replace(/\s+(National (Park|Military Park|Historical Park|Historic Site|Monument|Recreation Area|Seashore|Lakeshore|Preserve|Scenic Trail|Scenic River(way)?s?|Memorial|Battlefield|Parkway|River)( and Preserve)?)$/i, "")
    .replace(/\s+NMP$/i, "")
    .trim();
}

export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", opts);
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function durationMs(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const d = new Date(b).getTime() - new Date(a).getTime();
  return Number.isFinite(d) ? d : null;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Math.round((now - t) / 1000);
  const abs = Math.abs(diff);
  const fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return fmt.format(-diff, "second");
  if (abs < 3600) return fmt.format(-Math.round(diff / 60), "minute");
  if (abs < 86400) return fmt.format(-Math.round(diff / 3600), "hour");
  return fmt.format(-Math.round(diff / 86400), "day");
}

export function pct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function usd(x: number): string {
  if (x === 0) return "$0";
  if (x < 0.1) return `$${x.toFixed(3)}`;
  return `$${x.toFixed(2)}`;
}

/** Human step label: "fetch_alerts:havo" → { label: "Fetch alerts", target: "havo" } */
export function stepLabel(name: string): { label: string; target?: string } {
  const [base, target] = name.split(":");
  const label = base.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  return { label, target };
}

export type StepFlag = "retried" | "resumed" | null;

export function stepFlag(step: { attempt: number; error?: string | null; status: string }): StepFlag {
  const e = (step.error ?? "").toLowerCase();
  if (/(crash|killed|resum|heartbeat|restarted worker)/.test(e)) return "resumed";
  if (step.attempt > 1 || step.status === "retrying" || /retr/.test(e)) return "retried";
  return null;
}
