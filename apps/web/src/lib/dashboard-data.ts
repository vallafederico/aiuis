/**
 * Server-only data behind the Type an Analytic dashboard.
 *
 * Cloudflare (zone traffic, Workers AI neurons) reads CF_ANALYTICS_TOKEN; the zone
 * and account are looked up from the site host unless CF_ZONE_ID /
 * CF_ACCOUNT_ID are set. AI spend reads AI_GATEWAY_API_KEY. Content reads the
 * published catalog. A missing key makes a widget `unavailable`, never invented.
 */
import { gateway } from "ai";
import {
  METRICS,
  formatValue,
  type MetricDef,
  type MetricId,
  type Point,
  type Range,
  type Resolved,
  type Source,
  type Unit,
  type Widget,
} from "~/lib/dashboard";

const CF_API = "https://api.cloudflare.com/client/v4";
const CACHE_TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 10_000;

/** Workers AI list price; the first 10k neurons of each UTC day are free. */
const USD_PER_NEURON = 0.011 / 1000;
const FREE_NEURONS_PER_DAY = 10_000;

function env(name: string): string | undefined {
  const value = typeof process !== "undefined" ? process.env[name] : undefined;
  return value?.trim() || undefined;
}

/** Which sources can answer right now — the model is told, so it builds on what exists. */
export function sourcesAvailable(): Record<Source, boolean> {
  return {
    cloudflare: Boolean(env("CF_ANALYTICS_TOKEN")),
    "ai-gateway": Boolean(env("AI_GATEWAY_API_KEY")),
    content: true,
  };
}

const cache = new Map<string, { at: number; value: Promise<unknown> }>();

/** Per-isolate memo; a failed fetch is dropped so the next request retries. */
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

type Window = {
  key: string;
  range: Range;
  start: Date;
  end: Date;
  /** Hourly buckets for a day, daily otherwise. */
  hourly: boolean;
};

const DAYS: Record<Range, number> = { day: 1, week: 7, month: 30 };

/** `back` = 1 is the period just before this one. Ends snap to the hour so caches line up. */
function windowFor(range: Range, back = 0): Window {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  const span = DAYS[range] * 86_400_000;
  const end = new Date(now.getTime() + 3_600_000 - back * span);
  return { key: `${range}:${back}`, range, end, start: new Date(end.getTime() - span), hourly: range === "day" };
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const isoHour = (d: Date) => `${d.toISOString().slice(0, 13)}:00:00Z`;

/** Every bucket in the window, so quiet days draw as zero instead of vanishing. */
function buckets(w: Window): string[] {
  const out: string[] = [];
  if (w.hourly) {
    const t = new Date(w.start);
    while (t < w.end) {
      out.push(isoHour(t));
      t.setUTCHours(t.getUTCHours() + 1);
    }
  } else {
    const t = new Date(`${isoDate(w.start)}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + 1);
    while (t < w.end) {
      out.push(isoDate(t));
      t.setUTCDate(t.getUTCDate() + 1);
    }
  }
  return out;
}

/** Sources disagree on timestamp shape; a bare "YYYY-MM-DD HH:MM" is UTC. */
function utc(t: string): Date {
  const iso = t.includes("T") ? t : t.replace(" ", "T");
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) || iso.length <= 10 ? iso : `${iso}Z`);
}

function bucketOf(t: string, hourly: boolean): string {
  return hourly ? isoHour(utc(t)) : t.slice(0, 10);
}

function fill(keys: string[], values: Map<string, number>): Point[] {
  return keys.map((t) => ({ t, v: values.get(t) ?? 0 }));
}

function add(map: Map<string, number>, key: string, v: number) {
  map.set(key, (map.get(key) ?? 0) + v);
}

function topRows(map: Map<string, number>, limit: number) {
  return [...map.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, v]) => ({ label, v }));
}

const sumPoints = (points: Point[]) => points.reduce((acc, p) => acc + p.v, 0);

export class Unavailable extends Error {}

/** Optional source: a missing key or failed call reads as "no rows", with a note. */
async function optional<T>(load: () => Promise<T>, empty: T): Promise<{ value: T; note?: string }> {
  try {
    return { value: await load() };
  } catch (error) {
    return { value: empty, note: error instanceof Error ? error.message : String(error) };
  }
}

// ——— Cloudflare ———————————————————————————————————————————————

async function cfFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = env("CF_ANALYTICS_TOKEN");
  if (!token) throw new Unavailable("Cloudflare needs CF_ANALYTICS_TOKEN.");
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Cloudflare ${res.status}`);
  return (await res.json()) as T;
}

function siteHost(): string {
  try {
    return new URL(env("VITE_SITE_URL") ?? "https://aiu.is").hostname.replace(/^www\./, "");
  } catch {
    return "aiu.is";
  }
}

function cfIds(): Promise<{ zone: string; account: string }> {
  const zone = env("CF_ZONE_ID");
  const account = env("CF_ACCOUNT_ID");
  if (zone && account) return Promise.resolve({ zone, account });
  return cached("cf:ids", async () => {
    const found = await cfFetch<{
      result?: { id: string; account: { id: string } }[];
    }>(`/zones?name=${encodeURIComponent(siteHost())}`);
    const hit = found.result?.[0];
    if (!hit) throw new Unavailable(`No Cloudflare zone for ${siteHost()} on this token.`);
    return { zone: zone ?? hit.id, account: account ?? hit.account.id };
  });
}

async function cfGraphql<T>(query: string): Promise<T> {
  const body = await cfFetch<{ data?: T; errors?: { message: string }[] | null }>("/graphql", {
    method: "POST",
    body: JSON.stringify({ query }),
  });
  if (body.errors?.length) throw new Error(body.errors[0]!.message);
  if (!body.data) throw new Error("Cloudflare returned no data");
  return body.data;
}

type TrafficGroup = {
  dimensions: { t: string };
  uniq: { uniques: number };
  sum: {
    requests: number;
    pageViews: number;
    bytes: number;
    cachedRequests: number;
    threats: number;
    countryMap: { clientCountryName: string; requests: number }[];
    browserMap: { uaBrowserFamily: string; pageViews: number }[];
  };
};

function traffic(w: Window): Promise<TrafficGroup[]> {
  return cached(`cf:traffic:${w.key}`, async () => {
    const { zone } = await cfIds();
    const node = w.hourly
      ? `httpRequests1hGroups(limit: 100, filter: { datetime_geq: "${w.start.toISOString()}", datetime_lt: "${w.end.toISOString()}" }, orderBy: [datetime_ASC]) { dimensions { t: datetime }`
      : `httpRequests1dGroups(limit: 100, filter: { date_gt: "${isoDate(w.start)}", date_leq: "${isoDate(w.end)}" }, orderBy: [date_ASC]) { dimensions { t: date }`;
    const data = await cfGraphql<{ viewer: { zones: { groups: TrafficGroup[] }[] } }>(`{
      viewer { zones(filter: { zoneTag: "${zone}" }) {
        groups: ${node}
          uniq { uniques }
          sum {
            requests pageViews bytes cachedRequests threats
            countryMap { clientCountryName requests }
            browserMap { uaBrowserFamily pageViews }
          }
        }
      } }
    }`);
    return data.viewer.zones[0]?.groups ?? [];
  });
}

type Adaptive = {
  pages: { count: number; dimensions: { clientRequestPath: string } }[];
  devices: { count: number; dimensions: { clientDeviceType: string } }[];
};

/** Adaptive datasets have short look-backs on smaller plans; fall back to 24h. */
async function withShorterWindow<T>(
  w: Window,
  run: (w: Window) => Promise<T>,
): Promise<{ value: T; note?: string }> {
  try {
    return { value: await run(w) };
  } catch (error) {
    if (error instanceof Unavailable || w.range === "day") throw error;
    return { value: await run(windowFor("day")), note: "Last 24h only: the plan's look-back limit." };
  }
}

function adaptive(w: Window) {
  return cached(`cf:adaptive:${w.key}`, () =>
    withShorterWindow(w, async (win) => {
      const { zone } = await cfIds();
      const filter = `{ datetime_geq: "${win.start.toISOString()}", datetime_lt: "${win.end.toISOString()}", requestSource: "eyeball", edgeResponseContentTypeName: "html" }`;
      const data = await cfGraphql<{ viewer: { zones: Adaptive[] } }>(`{
        viewer { zones(filter: { zoneTag: "${zone}" }) {
          pages: httpRequestsAdaptiveGroups(limit: 10, filter: ${filter}, orderBy: [count_DESC]) {
            count dimensions { clientRequestPath }
          }
          devices: httpRequestsAdaptiveGroups(limit: 6, filter: ${filter}, orderBy: [count_DESC]) {
            count dimensions { clientDeviceType }
          }
        } }
      }`);
      return data.viewer.zones[0] ?? { pages: [], devices: [] };
    }),
  );
}

type Inference = {
  count: number;
  sum: { totalNeurons: number; totalInputTokens: number; totalOutputTokens: number };
  dimensions: { modelId: string; datetimeHour: string };
};

function workersAi(w: Window) {
  return cached(`cf:ai:${w.key}`, () =>
    withShorterWindow(w, async (win) => {
      const { account } = await cfIds();
      const data = await cfGraphql<{
        viewer: { accounts: { groups: Inference[] }[] };
      }>(`{
        viewer { accounts(filter: { accountTag: "${account}" }) {
          groups: aiInferenceAdaptiveGroups(limit: 5000, filter: { datetime_geq: "${win.start.toISOString()}", datetime_lt: "${win.end.toISOString()}" }, orderBy: [datetimeHour_ASC]) {
            count
            sum { totalNeurons totalInputTokens totalOutputTokens }
            dimensions { modelId datetimeHour }
          }
        } }
      }`);
      return data.viewer.accounts[0]?.groups ?? [];
    }),
  );
}

// ——— AI Gateway ——————————————————————————————————————————————

function requireGateway() {
  if (!env("AI_GATEWAY_API_KEY")) throw new Unavailable("AI spend needs AI_GATEWAY_API_KEY.");
}

function gatewayByDay(w: Window) {
  return cached(`gw:day:${w.key}`, async () => {
    requireGateway();
    const report = await gateway.getSpendReport({
      startDate: isoDate(w.start),
      endDate: isoDate(w.end),
      groupBy: "day",
      ...(w.hourly ? { datePart: "hour" as const } : {}),
    });
    return report.results.filter((row) => {
      const t = w.hourly ? row.hour : row.day;
      if (!t) return false;
      if (!w.hourly) return t > isoDate(w.start) && t <= isoDate(w.end);
      const at = utc(t).getTime();
      return at >= w.start.getTime() && at < w.end.getTime();
    });
  });
}

function gatewayByModel(w: Window) {
  return cached(`gw:model:${w.key}`, async () => {
    requireGateway();
    const report = await gateway.getSpendReport({
      startDate: isoDate(w.start),
      endDate: isoDate(w.end),
      groupBy: "model",
    });
    return report.results;
  });
}

function gatewayCredits() {
  return cached("gw:credits", async () => {
    requireGateway();
    return gateway.getCredits();
  });
}

// ——— Content ——————————————————————————————————————————————————

function chapters() {
  return cached("content:pieces", async () => {
    const { listSeoPieces } = await import("~/lib/llm-seo");
    return listSeoPieces();
  });
}

// ——— Metrics ——————————————————————————————————————————————————

type Series = { unit: Unit; series: { name: string; points: Point[] }[]; source: string; note?: string };

function partialNote(gw?: string, cf?: string): string | undefined {
  if (gw) return `Without AI Gateway: ${gw}`;
  if (cf) return `Without Workers AI: ${cf}`;
  return undefined;
}

/** Both AI sources, or throw when neither answered. */
async function aiSources(w: Window) {
  const [gw, cf] = await Promise.all([
    optional(() => gatewayByDay(w), []),
    optional(() => workersAi(w).then((r) => r.value), []),
  ]);
  if (gw.note && cf.note) throw new Unavailable(`${gw.note} ${cf.note}`);
  return { gw, cf, note: partialNote(gw.note, cf.note) };
}

async function seriesMetric(id: MetricId, w: Window): Promise<Series> {
  const keys = buckets(w);
  const unit = METRICS[id].unit;
  switch (id) {
    case "visitors":
    case "pageviews":
    case "requests":
    case "bandwidth":
    case "threats": {
      const groups = await traffic(w);
      const values = new Map<string, number>();
      for (const g of groups) {
        const v =
          id === "visitors"
            ? g.uniq.uniques
            : id === "pageviews"
              ? g.sum.pageViews
              : id === "requests"
                ? g.sum.requests
                : id === "bandwidth"
                  ? g.sum.bytes
                  : g.sum.threats;
        add(values, bucketOf(g.dimensions.t, w.hourly), v);
      }
      return { unit, source: "cloudflare", series: [{ name: id, points: fill(keys, values) }] };
    }
    case "neurons": {
      const { value, note } = await workersAi(w);
      const values = new Map<string, number>();
      for (const g of value) add(values, bucketOf(g.dimensions.datetimeHour, w.hourly), g.sum.totalNeurons);
      return { unit, note, source: "workers ai", series: [{ name: "neurons", points: fill(keys, values) }] };
    }
    case "ai_spend":
    case "ai_requests": {
      const { gw, cf, note } = await aiSources(w);
      const a = new Map<string, number>();
      const b = new Map<string, number>();
      for (const row of gw.value) {
        const t = bucketOf((w.hourly ? row.hour : row.day)!, w.hourly);
        add(a, t, id === "ai_spend" ? row.totalCost : (row.requestCount ?? 0));
      }
      for (const g of cf.value) {
        add(b, bucketOf(g.dimensions.datetimeHour, w.hourly), id === "ai_spend" ? g.sum.totalNeurons * USD_PER_NEURON : g.count);
      }
      const series = [{ name: "ai gateway", points: fill(keys, a) }];
      if (!cf.note) series.push({ name: "workers ai", points: fill(keys, b) });
      return { unit, note, source: cf.note ? "ai gateway" : "ai gateway + workers ai", series };
    }
    case "ai_tokens": {
      const { gw, cf, note } = await aiSources(w);
      const input = new Map<string, number>();
      const output = new Map<string, number>();
      for (const row of gw.value) {
        const t = bucketOf((w.hourly ? row.hour : row.day)!, w.hourly);
        add(input, t, (row.inputTokens ?? 0) + (row.cachedInputTokens ?? 0));
        add(output, t, row.outputTokens ?? 0);
      }
      for (const g of cf.value) {
        const t = bucketOf(g.dimensions.datetimeHour, w.hourly);
        add(input, t, g.sum.totalInputTokens);
        add(output, t, g.sum.totalOutputTokens);
      }
      return {
        unit,
        note,
        source: cf.note ? "ai gateway" : "ai gateway + workers ai",
        series: [
          { name: "input", points: fill(keys, input) },
          { name: "output", points: fill(keys, output) },
        ],
      };
    }
    default:
      throw new Unavailable(`${id} is not a time series.`);
  }
}

type Breakdown = { unit: Unit; rows: { label: string; v: number }[]; total: number; source: string; note?: string };

async function breakdownMetric(id: MetricId, w: Window): Promise<Breakdown> {
  const unit = METRICS[id].unit;
  const values = new Map<string, number>();
  let source = "cloudflare";
  let note: string | undefined;
  switch (id) {
    case "countries":
    case "browsers": {
      for (const g of await traffic(w)) {
        if (id === "countries") for (const c of g.sum.countryMap) add(values, c.clientCountryName, c.requests);
        else for (const b of g.sum.browserMap) add(values, b.uaBrowserFamily, b.pageViews);
      }
      break;
    }
    case "pages":
    case "devices": {
      const res = await adaptive(w);
      note = res.note;
      source = "cloudflare, sampled";
      if (id === "pages") for (const p of res.value.pages) add(values, p.dimensions.clientRequestPath, p.count);
      else for (const d of res.value.devices) add(values, d.dimensions.clientDeviceType, d.count);
      break;
    }
    case "spend_by_model":
    case "calls_by_model": {
      const [gw, cf] = await Promise.all([
        optional(() => gatewayByModel(w), []),
        optional(() => workersAi(w).then((r) => r.value), []),
      ]);
      if (gw.note && cf.note) throw new Unavailable(`${gw.note} ${cf.note}`);
      note = partialNote(gw.note, cf.note);
      source = cf.note ? "ai gateway" : "ai gateway + workers ai";
      for (const row of gw.value) {
        if (row.model) add(values, row.model, id === "spend_by_model" ? row.totalCost : (row.requestCount ?? 0));
      }
      for (const g of cf.value) {
        add(values, g.dimensions.modelId, id === "spend_by_model" ? g.sum.totalNeurons * USD_PER_NEURON : g.count);
      }
      break;
    }
    case "chapters_by_section":
    case "chapters_by_tag": {
      source = "content";
      for (const piece of await chapters()) {
        if (id === "chapters_by_section") add(values, piece.section, 1);
        else for (const tag of piece.tags) add(values, tag, 1);
      }
      break;
    }
    default:
      throw new Unavailable(`${id} is not a breakdown.`);
  }
  return {
    unit,
    source,
    note,
    rows: topRows(values, 8),
    total: [...values.values()].reduce((acc, v) => acc + v, 0),
  };
}

type Scalar = { unit: Unit; value: number; source: string; note?: string; spark?: Point[] };

function collapse(id: MetricId, s: Series): number {
  const total = s.series.reduce((acc, line) => acc + sumPoints(line.points), 0);
  if ((METRICS[id] as MetricDef).aggregate !== "mean") return total;
  const n = s.series[0]?.points.length ?? 1;
  return total / Math.max(1, n);
}

function stack(s: Series): Point[] {
  const first = s.series[0]?.points ?? [];
  return first.map((p, i) => ({ t: p.t, v: s.series.reduce((acc, line) => acc + (line.points[i]?.v ?? 0), 0) }));
}

async function scalarMetric(id: MetricId, w: Window): Promise<Scalar> {
  const def = METRICS[id];
  if (def.shape === "series") {
    const s = await seriesMetric(id, w);
    return { unit: def.unit, value: collapse(id, s), source: s.source, note: s.note, spark: stack(s) };
  }
  switch (id) {
    case "cache_rate": {
      const groups = await traffic(w);
      const requests = groups.reduce((acc, g) => acc + g.sum.requests, 0);
      const hit = groups.reduce((acc, g) => acc + g.sum.cachedRequests, 0);
      return { unit: "percent", value: requests ? hit / requests : 0, source: "cloudflare" };
    }
    case "credits_balance":
    case "credits_used": {
      const credits = await gatewayCredits();
      return {
        unit: "usd",
        value: Number(id === "credits_balance" ? credits.balance : credits.totalUsed),
        source: "ai gateway credits",
      };
    }
    case "chapters":
      return { unit: "count", value: (await chapters()).length, source: "content" };
    default:
      throw new Unavailable(`${id} is not a single number.`);
  }
}

/** Ranges do not apply to all-time or current-state numbers. */
function ranged(id: MetricId): boolean {
  return !["credits_balance", "credits_used", "chapters"].includes(id);
}

// ——— Widgets ——————————————————————————————————————————————————

async function resolve(widget: Widget, range: Range): Promise<Resolved> {
  const w = windowFor(range);
  const before = windowFor(range, 1);
  const [first, second] = widget.metrics;

  switch (widget.kind) {
    case "note":
      return { data: { kind: "note" }, source: "written by the model" };

    case "number": {
      const id = first!;
      const now = await scalarMetric(id, w);
      const prev =
        widget.compare && ranged(id) ? await scalarMetric(id, before).then((s) => s.value, () => undefined) : undefined;
      return {
        source: now.source,
        note: now.note,
        data: { kind: "number", unit: now.unit, value: now.value, prev, spark: now.spark },
      };
    }

    case "trend": {
      const lines = await Promise.all(
        widget.metrics.map(async (id) => ({ id, ...(await seriesMetric(id, w)) })),
      );
      const units = new Set(lines.map((l) => l.unit));
      // Mixed units cannot share an axis; keep the first metric's unit.
      const same = lines.filter((l) => l.unit === lines[0]!.unit);
      const series =
        same.length === 1
          ? same[0]!.series
          : same.map((l) => ({ name: l.id.replaceAll("_", " "), points: stack(l) }));
      const total = collapse(first!, same[0]!);
      const prev =
        widget.compare && widget.metrics.length === 1
          ? await seriesMetric(first!, before).then((s) => collapse(first!, s), () => undefined)
          : undefined;
      return {
        source: [...new Set(lines.map((l) => l.source))].join(" + "),
        note: lines.find((l) => l.note)?.note ?? (units.size > 1 ? "Metrics with other units were left off." : undefined),
        data: {
          kind: "trend",
          unit: same[0]!.unit,
          series,
          total,
          prev,
          ...(first === "neurons" && !w.hourly ? { mark: { v: FREE_NEURONS_PER_DAY, label: "free / day" } } : {}),
        },
      };
    }

    case "ranking": {
      const b = await breakdownMetric(first!, w);
      return { source: b.source, note: b.note, data: { kind: "ranking", unit: b.unit, rows: b.rows, total: b.total } };
    }

    case "ratio": {
      const [num, den] = await Promise.all([scalarMetric(first!, w), scalarMetric(second!, w)]);
      const scale = widget.scale ?? 1;
      return {
        source: [...new Set([num.source, den.source])].join(" + "),
        note: num.note ?? den.note,
        data: {
          kind: "ratio",
          value: den.value ? (num.value / den.value) * scale : 0,
          numerator: num.value,
          denominator: den.value,
          unit: num.unit,
          per: widget.per || `per ${scale === 1 ? "" : `${formatValue(scale, "count")} `}${second!.replaceAll("_", " ").replace(/s$/, "")}`,
        },
      };
    }

    case "list": {
      const pieces = (await chapters())
        .filter((p) => p.updated)
        .sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""))
        .slice(0, 6);
      return {
        source: "content",
        data: {
          kind: "list",
          items: pieces.map((p) => ({ label: p.title, sub: `${p.section} · ${p.updated?.slice(0, 10) ?? ""}` })),
        },
      };
    }
  }
}

export async function resolveWidget(widget: Widget, range: Range): Promise<Resolved> {
  try {
    return await resolve(widget, range);
  } catch (error) {
    const reason =
      error instanceof Unavailable
        ? error.message
        : `Source unreachable (${error instanceof Error ? error.message : String(error)}).`;
    if (!(error instanceof Unavailable)) console.warn(`dashboard: ${widget.kind} ${widget.metrics.join(",")} failed`, error);
    return {
      source: [...new Set(widget.metrics.flatMap((id) => METRICS[id].sources))].join(" + "),
      data: { kind: "unavailable", reason },
    };
  }
}
