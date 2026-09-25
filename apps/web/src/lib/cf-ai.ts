import { getRequestEvent } from "solid-js/web";

type AiBinding = {
  run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
};

type CfEnv = {
  AI?: AiBinding;
};

const PROXY_KEY = "__aiuisPlatformProxy";
const PROXY_FAILED_KEY = "__aiuisPlatformProxyFailedAt";
/** After a failed proxy start, wait this long before trying again. */
const PROXY_RETRY_MS = 30_000;

type PlatformProxy = { env: CfEnv };

async function platformEnv(): Promise<CfEnv | undefined> {
  if (!import.meta.env.DEV) return undefined;
  const store = globalThis as Record<string, unknown>;
  const cached = store[PROXY_KEY] as PlatformProxy | undefined;
  if (cached) return cached.env;
  const failedAt = store[PROXY_FAILED_KEY] as number | undefined;
  if (failedAt && Date.now() - failedAt < PROXY_RETRY_MS) return undefined;
  try {
    const { getPlatformProxy } = await import("wrangler");
    const proxy = (await getPlatformProxy({
      persist: true,
    })) as PlatformProxy;
    store[PROXY_KEY] = proxy;
    return proxy.env;
  } catch (error) {
    // The remote AI binding needs a wrangler login with Workers permissions.
    // Callers treat a missing binding as "Workers AI unavailable".
    store[PROXY_FAILED_KEY] = Date.now();
    console.warn("cf-ai: wrangler platform proxy unavailable", error);
    return undefined;
  }
}

export async function getAi(): Promise<AiBinding | null> {
  const event = getRequestEvent();
  const fromRequest = (
    event?.nativeEvent as { context?: { cloudflare?: { env?: CfEnv } } } | undefined
  )?.context?.cloudflare?.env?.AI;
  if (fromRequest) return fromRequest;

  const fromDev = await platformEnv();
  return fromDev?.AI ?? null;
}
