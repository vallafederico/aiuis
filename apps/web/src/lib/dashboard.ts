/**
 * Type an Analytic's generative dashboard — the metrics a board can be built from,
 * the board a language model writes over them, and what each widget resolves to.
 *
 * Client-safe. Fetchers live in ~/lib/dashboard-data, the model in
 * ~/lib/dashboard-compose. The model arranges; it never supplies a number.
 */

export type Range = "day" | "week" | "month";

export const RANGES: readonly Range[] = ["day", "week", "month"];

export const RANGE_LABELS: Record<Range, string> = {
  day: "24h",
  week: "7d",
  month: "30d",
};

export type Source = "cloudflare" | "ai-gateway" | "content";

export type Unit = "count" | "usd" | "bytes" | "neurons" | "percent";

export type MetricShape = "series" | "breakdown" | "scalar" | "list";

export type MetricDef = {
  shape: MetricShape;
  unit: Unit;
  sources: Source[];
  /** What it measures — the model reads this. */
  about: string;
  /** Series only: how a window collapses to one number. */
  aggregate?: "sum" | "mean";
};

export const METRICS = {
  visitors: {
    shape: "series",
    unit: "count",
    sources: ["cloudflare"],
    about: "unique visitors per day (per hour for 24h)",
    aggregate: "mean",
  },
  pageviews: { shape: "series", unit: "count", sources: ["cloudflare"], about: "page views", aggregate: "sum" },
  requests: { shape: "series", unit: "count", sources: ["cloudflare"], about: "all HTTP requests to the site", aggregate: "sum" },
  bandwidth: { shape: "series", unit: "bytes", sources: ["cloudflare"], about: "bytes served", aggregate: "sum" },
  threats: { shape: "series", unit: "count", sources: ["cloudflare"], about: "threats blocked at the edge", aggregate: "sum" },
  cache_rate: { shape: "scalar", unit: "percent", sources: ["cloudflare"], about: "share of requests served from cache" },
  countries: { shape: "breakdown", unit: "count", sources: ["cloudflare"], about: "requests by visitor country" },
  browsers: { shape: "breakdown", unit: "count", sources: ["cloudflare"], about: "page views by browser" },
  pages: { shape: "breakdown", unit: "count", sources: ["cloudflare"], about: "most visited pages (paths), sampled" },
  devices: { shape: "breakdown", unit: "count", sources: ["cloudflare"], about: "page loads by device type, sampled" },

  ai_spend: {
    shape: "series",
    unit: "usd",
    sources: ["ai-gateway", "cloudflare"],
    about: "money spent on AI: AI Gateway models plus Workers AI at list price",
    aggregate: "sum",
  },
  ai_requests: {
    shape: "series",
    unit: "count",
    sources: ["ai-gateway", "cloudflare"],
    about: "number of AI model calls",
    aggregate: "sum",
  },
  ai_tokens: {
    shape: "series",
    unit: "count",
    sources: ["ai-gateway", "cloudflare"],
    about: "AI tokens read and written (input and output)",
    aggregate: "sum",
  },
  neurons: {
    shape: "series",
    unit: "neurons",
    sources: ["cloudflare"],
    about: "Workers AI neurons used, against 10,000 free per day",
    aggregate: "sum",
  },
  spend_by_model: { shape: "breakdown", unit: "usd", sources: ["ai-gateway", "cloudflare"], about: "AI spend per model" },
  calls_by_model: { shape: "breakdown", unit: "count", sources: ["ai-gateway", "cloudflare"], about: "AI calls per model" },
  credits_balance: { shape: "scalar", unit: "usd", sources: ["ai-gateway"], about: "AI Gateway credit left (now, not ranged)" },
  credits_used: { shape: "scalar", unit: "usd", sources: ["ai-gateway"], about: "AI Gateway credit used, all time" },

  chapters: { shape: "scalar", unit: "count", sources: ["content"], about: "published chapters on the site" },
  chapters_by_section: { shape: "breakdown", unit: "count", sources: ["content"], about: "chapters per section" },
  chapters_by_tag: { shape: "breakdown", unit: "count", sources: ["content"], about: "chapters per data tag" },
  recent_chapters: { shape: "list", unit: "count", sources: ["content"], about: "most recently updated chapters" },
} satisfies Record<string, MetricDef>;

export type MetricId = keyof typeof METRICS;

export const METRIC_IDS = Object.keys(METRICS) as MetricId[];

export function isMetricId(value: unknown): value is MetricId {
  return typeof value === "string" && value in METRICS;
}

export function isRange(value: unknown): value is Range {
  return value === "day" || value === "week" || value === "month";
}

export function metric(id: MetricId): MetricDef {
  return METRICS[id];
}

// ——— the board the model writes ——————————————————————————————

export type WidgetKind = "number" | "trend" | "ranking" | "ratio" | "list" | "note";

export const WIDGET_KINDS: readonly WidgetKind[] = ["number", "trend", "ranking", "ratio", "list", "note"];

export type WidgetSize = "s" | "m" | "l";

export type Widget = {
  id: string;
  kind: WidgetKind;
  title: string;
  size: WidgetSize;
  metrics: MetricId[];
  /** Compare with the period before. */
  compare?: boolean;
  /** Ratio: multiply the quotient, e.g. 1000 for "per 1k visitors". */
  scale?: number;
  /** Ratio: what the quotient reads as, e.g. "per 1k visitors". */
  per?: string;
  /** Note: the model's own words. Never a number. */
  text?: string;
};

export type Board = {
  title: string;
  /** How the model read the need, in its own words. */
  reading?: string;
  range: Range;
  widgets: Widget[];
};

/** Which shapes each widget kind can draw. */
const ACCEPTS: Record<WidgetKind, MetricShape[]> = {
  number: ["series", "scalar"],
  trend: ["series"],
  ranking: ["breakdown"],
  ratio: ["series", "scalar"],
  list: ["list"],
  note: [],
};

const MAX_WIDGETS = 8;

/** Coerce a (possibly partial) model board into one the page can draw. */
export function normalizeBoard(raw: unknown, fallbackRange: Range = "week"): Board | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const range = isRange(rec.range) ? rec.range : fallbackRange;
  const list = Array.isArray(rec.widgets) ? rec.widgets : [];
  const widgets: Widget[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const w = item as Record<string, unknown>;
    const kind = WIDGET_KINDS.includes(w.kind as WidgetKind) ? (w.kind as WidgetKind) : null;
    if (!kind) continue;
    const metrics = (Array.isArray(w.metrics) ? w.metrics : [])
      .filter(isMetricId)
      .filter((id) => ACCEPTS[kind].includes(METRICS[id].shape));
    const title = typeof w.title === "string" ? w.title.trim().slice(0, 80) : "";
    const text = typeof w.text === "string" ? w.text.trim().slice(0, 280) : "";
    if (kind === "note" ? !text && !title : metrics.length === 0) continue;
    if (kind === "ratio" && metrics.length < 2) continue;
    const size: WidgetSize = w.size === "s" || w.size === "m" || w.size === "l" ? w.size : "m";
    widgets.push({
      id: `w${widgets.length}`,
      kind,
      title,
      size,
      metrics: kind === "trend" ? metrics.slice(0, 3) : kind === "ratio" ? metrics.slice(0, 2) : metrics.slice(0, 1),
      compare: w.compare === true && kind !== "ranking" && kind !== "list" && kind !== "note",
      scale: typeof w.scale === "number" && w.scale > 0 && w.scale <= 1e6 ? w.scale : undefined,
      per: typeof w.per === "string" ? w.per.trim().slice(0, 40) : undefined,
      text: kind === "note" ? text : undefined,
    });
    if (widgets.length >= MAX_WIDGETS) break;
  }
  const title = typeof rec.title === "string" ? rec.title.trim().slice(0, 90) : "";
  const reading = typeof rec.reading === "string" ? rec.reading.trim().slice(0, 140) : "";
  if (!title && widgets.length === 0) return null;
  return { title, reading: reading || undefined, range, widgets };
}

// ——— what a widget resolves to ————————————————————————————————

export type Point = { t: string; v: number };

export type WidgetData =
  | { kind: "number"; unit: Unit; value: number; prev?: number; spark?: Point[] }
  | {
      kind: "trend";
      unit: Unit;
      series: { name: string; points: Point[] }[];
      total: number;
      prev?: number;
      mark?: { v: number; label: string };
    }
  | { kind: "ranking"; unit: Unit; rows: { label: string; v: number }[]; total: number }
  | { kind: "ratio"; value: number; numerator: number; denominator: number; unit: Unit; per: string }
  | { kind: "list"; items: { label: string; sub: string }[] }
  | { kind: "note" }
  | { kind: "unavailable"; reason: string };

export type Resolved = {
  data: WidgetData;
  /** Where the numbers came from. */
  source: string;
  /** Set when a source could not cover everything asked. */
  note?: string;
};

/** Short, number-bearing digest of a resolved widget, for the caption pass. */
export function digest(widget: Widget, resolved: Resolved | undefined): string {
  const d = resolved?.data;
  if (!d) return "no data";
  switch (d.kind) {
    case "number":
      return `${formatValue(d.value, d.unit)}${d.prev != null ? ` (period before: ${formatValue(d.prev, d.unit)}, change ${formatDelta(d.value, d.prev)})` : ""}`;
    case "trend": {
      const peaks = d.series.map((s) => {
        const top = s.points.reduce((a, b) => (b.v > a.v ? b : a), s.points[0] ?? { t: "", v: 0 });
        return `${s.name} total ${formatValue(s.points.reduce((acc, p) => acc + p.v, 0), d.unit)}, peak ${formatValue(top.v, d.unit)} on ${formatBucket(top.t)}`;
      });
      return `${peaks.join("; ")}${d.prev != null ? `; period before: ${formatValue(d.prev, d.unit)}, change ${formatDelta(d.total, d.prev)}` : ""}`;
    }
    case "ranking":
      return d.rows
        .slice(0, 4)
        .map((r) => `${r.label} ${formatValue(r.v, d.unit)}`)
        .join(", ");
    case "ratio":
      return `${formatValue(d.value, d.unit)} ${d.per}`;
    case "list":
      return d.items
        .slice(0, 3)
        .map((i) => `${i.label} (${i.sub})`)
        .join(", ");
    case "note":
      return widget.text ?? "";
    case "unavailable":
      return `unavailable: ${d.reason}`;
  }
}

// ——— formatting ————————————————————————————————————————————————

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function formatValue(v: number, unit: Unit): string {
  if (!Number.isFinite(v)) return "—";
  switch (unit) {
    case "usd":
      if (v === 0) return "$0";
      if (Math.abs(v) < 0.01) return `$${v.toFixed(4)}`;
      if (Math.abs(v) < 100) return `$${v.toFixed(2)}`;
      return `$${compact.format(v)}`;
    case "bytes": {
      const units = ["B", "KB", "MB", "GB", "TB"];
      let n = v;
      let i = 0;
      while (n >= 1000 && i < units.length - 1) {
        n /= 1000;
        i += 1;
      }
      return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
    }
    case "percent":
      return `${Math.round(v * 100)}%`;
    case "neurons":
    case "count":
      if (v > 0 && v < 10 && !Number.isInteger(v)) return v.toFixed(1);
      return v < 1000 ? String(Math.round(v)) : compact.format(v);
  }
}

/** Relative change as "+12%" / "−8%", or null when there is nothing to compare. */
export function formatDelta(value: number, prev: number | undefined): string | null {
  if (prev == null || !Number.isFinite(prev)) return null;
  if (prev === 0) return value === 0 ? "±0%" : "new";
  const pct = Math.round(((value - prev) / Math.abs(prev)) * 100);
  return `${pct > 0 ? "+" : pct < 0 ? "−" : "±"}${Math.abs(pct)}%`;
}

/** Bucket label: "Sep 24" for days, "14:00" for hours. */
export function formatBucket(t: string): string {
  const date = new Date(t);
  if (Number.isNaN(date.getTime())) return t;
  if (t.length > 10) {
    return `${String(date.getUTCHours()).padStart(2, "0")}:00`;
  }
  return date.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
}
