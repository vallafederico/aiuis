import "./app.css";
import { Link, MetaProvider } from "@solidjs/meta";
import { Router } from "@acme/router";
import { clientOnly } from "@solidjs/start";
import { useViewport } from "~/lib/hooks/useViewport";

import Layout from "~/components/Layout";
import AppRoutes from "~/components/AppRoutes";

// Rendered as siblings of <Layout> (not inside it) so editing Layout.tsx
// doesn't remount the canvas and restart the whole webgl scene on HMR.
const ClientCanvas = clientOnly(
  () => import("~/components/webgl/Canvas"),
);
const ClientParticleGrid = clientOnly(
  () => import("~/components/webgl/ParticleGrid"),
);
const ClientMouseDistortion = clientOnly(
  () => import("~/components/webgl/MouseDistortion"),
);

export default function App() {
  useViewport();

  return (
    <Router
      root={(props) => (
        <MetaProvider>
          <>
            <Link
              rel="robots"
              type="text/plain"
              href="/robots.txt"
            />
            <Link rel="describedby" href="/llms.txt" />

            <Layout>{props.children}</Layout>

            <ClientCanvas />
            <ClientParticleGrid />
            <ClientMouseDistortion />
          </>
        </MetaProvider>
      )}
    >
      <AppRoutes />
    </Router>
  );
}
