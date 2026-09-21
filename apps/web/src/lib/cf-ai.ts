import { getRequestEvent } from "solid-js/web";

type AiBinding = {
  run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
};

type CfEnv = {
  AI?: AiBinding;
};

const PROXY_KEY = "__aiuisPlatformProxy";

type PlatformProxy = { env: CfEnv };

async function platformEnv(): Promise<CfEnv | undefined> {
  if (!import.meta.env.DEV) return undefined;
  const cached = (globalThis as Record<string, unknown>)[PROXY_KEY] as
    | PlatformProxy
    | undefined;
  if (cached) return cached.env;
  const { getPlatformProxy } = await import("wrangler");
  const proxy = (await getPlatformProxy({
    persist: true,
  })) as PlatformProxy;
  (globalThis as Record<string, unknown>)[PROXY_KEY] = proxy;
  return proxy.env;
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
