import type { APIEvent } from "@solidjs/start/server";
import { getCmsBinding } from "~/lib/cms";

// Derived CMS content references assets by origin-relative path
// (/api/v1/assets/...), so the site proxies them to the CMS instance.
const CMS_BASE =
  (typeof process !== "undefined" && process.env.CMS_API_URL) ||
  "http://localhost:8787";

export async function GET({ params }: APIEvent) {
  const binding = getCmsBinding();
  let upstream: Response;
  try {
    if (binding) {
      upstream = await binding.fetch(`https://cms/api/v1/assets/${params.path}`);
    } else {
      upstream = await fetch(`${CMS_BASE}/api/v1/assets/${params.path}`);
    }
  } catch {
    return new Response("Content service is offline", { status: 503 });
  }
  const headers = new Headers();
  for (const h of ["content-type", "cache-control", "etag", "content-length"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
