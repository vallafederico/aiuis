// @refresh reload
import { For } from "solid-js";
import { getRequestEvent } from "solid-js/web";
import { createHandler, StartServer } from "@solidjs/start/server";

import { isComponentView } from "~/lib/component-view";

const PAPER = "#E9E9EA";

function requestPath() {
  const raw = getRequestEvent()?.request?.url;
  if (!raw) return undefined;
  try {
    return new URL(raw).pathname;
  } catch {
    return undefined;
  }
}

function htmlClasses() {
  const path = requestPath();
  return path && isComponentView(path) ? "ui-component" : undefined;
}

/** Component views whose own HTML sets garara (the nav, hidden there, does elsewhere). */
const GARARA_COMPONENTS = new Set(["faqs", "type-an-analytic"]);

/**
 * Fonts the first paint lays out, preloaded so they are not found late via
 * CSS. The sans is everywhere; garara sets nav labels; the mono sets schematics
 * and the analytic board.
 */
function pageFonts(path = "/") {
  const fonts = ["AlteHaasGroteskBold"];
  const ui = /^\/uis\/([^/]+)(\/component)?\/?$/.exec(path);
  const component = ui?.[2] ? ui[1]! : null;
  if (!component || GARARA_COMPONENTS.has(component)) fonts.push("Garara");
  if (ui && !component) fonts.push("ChivoMono-Regular", "ChivoMono-Bold");
  if (component === "type-an-analytic") fonts.push("ChivoMono-Regular");
  return fonts;
}

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en" class={htmlClasses()}>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="robots" content="index, follow" />
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          <link rel="icon" href="/favicon.ico" sizes="32x32" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
          <For each={pageFonts(requestPath())}>
            {(font) => (
              <link
                rel="preload"
                href={`/fonts/${font}.woff2`}
                as="font"
                type="font/woff2"
                crossorigin="anonymous"
              />
            )}
          </For>
          <noscript>
            <style>{`[data-msdf]{opacity:1!important}`}</style>
          </noscript>
          {assets}
        </head>
        <body>
          {/* Paper-on-paper text so Chrome records FCP without a visible
              flash. Lighthouse otherwise aborts a11y / SEO / best-practices
              with NO_FCP; WebGL does not count as contentful paint. */}
          <span
            aria-hidden="true"
            data-fcp
            style={{
              position: "absolute",
              top: "0",
              left: "0",
              color: PAPER,
              "font-size": "16px",
              "line-height": "1",
              "pointer-events": "none",
              "user-select": "none",
            }}
          >
            aiuis
          </span>
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
