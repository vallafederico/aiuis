// CMS server-side fetch helper.
// In dev, uses CMS_API_URL env var (defaults to http://localhost:8787).
// In prod, uses the CMS Cloudflare service binding when available.

import { getRequestEvent } from "solid-js/web";

interface Fetcher {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}

const CMS_BASE =
  (typeof process !== "undefined" && process.env.CMS_API_URL) ||
  "http://localhost:8787";

let _warnedHttpFallback = false;

export function getCmsBinding(): Fetcher | undefined {
  return getRequestEvent()?.nativeEvent?.context?._platform?.cloudflare?.env
    ?.CMS as Fetcher | undefined;
}

export async function cmsGet<T = unknown>(path: string): Promise<T> {
  const binding = getCmsBinding();
  let res: Response;
  if (binding) {
    try {
      res = await binding.fetch("https://cms" + path);
    } catch (cause) {
      throw Object.assign(new Error(`CMS unreachable: ${path}`), {
        status: 503,
        cause,
      });
    }
  } else {
    if (!_warnedHttpFallback && typeof process !== "undefined" && process.env.NODE_ENV === "production") {
      _warnedHttpFallback = true;
      console.warn("[cms] CMS service binding not found — falling back to HTTP fetch in production");
    }
    const url = `${CMS_BASE}${path}`;
    try {
      res = await fetch(url);
    } catch (cause) {
      // network-level failure (CMS worker not running / unreachable)
      throw Object.assign(new Error(`CMS unreachable: ${path}`), {
        status: 503,
        cause,
      });
    }
  }
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
