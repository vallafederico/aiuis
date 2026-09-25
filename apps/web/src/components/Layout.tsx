import { Show, Suspense, type JSX } from "solid-js";
import {
  useLayoutTransition,
  useLocation,
  type TransitionContextValue,
} from "@acme/router";

import Grid from "~/components/Grid";
import { Nav } from "~/components/Nav";
import { Scroll, scroll } from "~/lib/utils/scroll";
import { beginPageEntry, beginPageLeave } from "~/components/webgl/mosaic-clock";

const resetScroll = (_ctx: TransitionContextValue) => {
  Scroll.lenis?.scrollTo(0, { immediate: true });
  Scroll.refresh();
};

const GlobalLayout = (props: { children: JSX.Element; bare?: boolean }) => {
  useLayoutTransition({
    onEnter: (ctx) => resetScroll(ctx),
    leave: () => beginPageLeave(),
    enter: () => beginPageEntry(),
  });

  return (
    <main
      id="content"
      tabindex="-1"
      use:scroll
      style={props.bare ? undefined : "padding-inline: var(--main-inset)"}
    >
      {props.children}
    </main>
  );
};

export default function Layout(props: {
  children: JSX.Element;
}) {
  const location = useLocation();
  const bare = () => location.pathname.replace(/\/+$/, "") === "/ai-viz";

  return (
    <>
      <Show when={!bare()}>
        <a href="#content" sr-only>
          Skip to content
        </a>
        <Nav />
        <Grid />
      </Show>

      <Suspense>
        <GlobalLayout bare={bare()}>{props.children}</GlobalLayout>
      </Suspense>
    </>
  );
}
