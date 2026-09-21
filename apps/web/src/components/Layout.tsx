import { Suspense, type JSX } from "solid-js";
import {
  useLayoutTransition,
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

const GlobalLayout = (props: { children: JSX.Element }) => {
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
      style="padding-inline: calc(2/12*100vw)"
    >
      {props.children}
    </main>
  );
};

export default function Layout(props: {
  children: JSX.Element;
}) {
  return (
    <>
      <a href="#content" sr-only>
        Skip to content
      </a>
      <Nav />
      <Grid />

      <Suspense>
        <GlobalLayout>{props.children}</GlobalLayout>
      </Suspense>
    </>
  );
}
