import { Suspense, type JSX } from "solid-js";
import {
  useLayoutTransition,
  type TransitionContextValue,
} from "@acme/router";

import Grid from "~/components/Grid";
import { Nav } from "~/components/Nav";
import gsap from "~/lib/gsap";
import { Scroll, scroll } from "~/lib/utils/scroll";

const FADE_DURATION = 0.4;

const resetScroll = (_ctx: TransitionContextValue) => {
  Scroll.lenis?.scrollTo(0, { immediate: true });
  Scroll.refresh();
};

const GlobalLayout = (props: { children: JSX.Element }) => {
  useLayoutTransition({
    onEnter: (ctx) => resetScroll(ctx),
    leave: (_ctx, el) =>
      new Promise((resolve) => {
        gsap.to(el, {
          opacity: 0,
          duration: FADE_DURATION,
          onComplete: resolve,
        });
      }),
    enter: (_ctx, el) => {
      gsap.set(el, { opacity: 0 });
      return new Promise((resolve) => {
        gsap.fromTo(
          el,
          { opacity: 0 },
          {
            opacity: 1,
            duration: FADE_DURATION,
            onComplete: resolve,
          },
        );
      });
    },
  });

  return (
    <main
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
      <Nav />
      <Grid />

      <Suspense>
        <GlobalLayout>{props.children}</GlobalLayout>
      </Suspense>
    </>
  );
}
