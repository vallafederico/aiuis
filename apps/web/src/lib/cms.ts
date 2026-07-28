// CMS server-side fetch helper.
// In dev, uses CMS_API_URL env var (defaults to http://localhost:8787).
// TODO: In prod, slot in a `CMS` service binding here instead of fetch.

const CMS_BASE =
  (typeof process !== "undefined" && process.env.CMS_API_URL) ||
  "http://localhost:8787";

export async function cmsGet<T = unknown>(path: string): Promise<T> {
  const url = `${CMS_BASE}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw Object.assign(new Error(`CMS ${res.status}: ${path}`), {
      status: res.status,
    });
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return res.json() as Promise<T>;
  }
  // html, markdown, and other text responses
  return res.text() as Promise<T>;
}
