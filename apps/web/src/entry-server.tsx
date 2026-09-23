// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

const PAPER = "#E9E9EA";

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="robots" content="index, follow" />
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          <link rel="icon" href="/favicon.ico" sizes="32x32" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
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
