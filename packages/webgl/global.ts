// Entry point for the IIFE/unpkg bundle: attaches the full API to a global.
// __GLOBAL_NAME__ is injected at build time (see bin/build.ts) so the global
// follows the package name automatically.
import * as lib from "./index";

declare const __GLOBAL_NAME__: string;

const globalScope =
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
      ? globalThis
      : typeof self !== "undefined"
        ? self
        : undefined;

if (globalScope) {
  (globalScope as unknown as Record<string, unknown>)[__GLOBAL_NAME__] = lib;
}
