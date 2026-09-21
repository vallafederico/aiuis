import type { APIEvent } from "@solidjs/start/server";
import { cms } from "~/lib/cms";

// Derived CMS content references assets by origin-relative path
// (/api/v1/assets/...), so the site proxies them to the content.software project.

export async function GET({ params }: APIEvent) {
  let upstream: Response;
  try {
    upstream = await cms().fetchAsset(params.path);
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
