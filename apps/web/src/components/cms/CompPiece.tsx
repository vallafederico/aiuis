import { For, Show, createEffect, on, onCleanup, type JSX } from "solid-js";
import { isServer } from "solid-js/web";
import { createAsync } from "@solidjs/router";
import { A, onEnter, onLeave, useLocation } from "@acme/router";
import "./CompPiece.css";
import CmsMsdfBlock from "./CmsMsdfBlock";
import MsdfText from "~/components/webgl/MsdfText";
import GlRoundRect from "~/components/webgl/GlRoundRect";
import { CountDigits } from "~/components/CountDigits";
import { NavHit, NavHitText, createWipe } from "~/components/NavHit";
import { getNavCatalog, navNumberFor } from "~/lib/sections";
import { labelForTag, tagPath } from "~/uis/meta";
import { readCssColor } from "~/components/webgl/css-color";

const FEATURE_FADE_MS = 120;
/** The CTA waits at least past the feature fade in, and never longer than this. */
const CTA_MIN_WAIT_MS = 600;
const CTA_MAX_WAIT_MS = 5000;
const CTA_POLL_MS = 100;
/** Beat between the page settling and the fill wiping in, then the label. */
const CTA_BEAT_MS = 150;
const CTA_LABEL_DELAY_MS = 260;

/** Entrances are keyframe animations; transitions are state changes (walkthroughs, hovers). */
function hasRunningIntro(root: Element) {
  return root.getAnimations({ subtree: true }).some((a) => {
    if (a.playState !== "running" || a instanceof CSSTransition) return false;
    return Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity);
  });
}

/**
 * Resolves once nothing in `root` is mid-entrance. Schematics mount lazily, so it
 * polls until two quiet checks in a row rather than trusting the first frame.
 */
function whenSettled(root: Element, isCancelled: () => boolean) {
  return new Promise<void>((resolve) => {
    const start = performance.now();
    let quiet = 0;
    const check = () => {
      if (isCancelled()) return;
      const elapsed = performance.now() - start;
      quiet = hasRunningIntro(root) ? 0 : quiet + 1;
      if ((quiet >= 2 && elapsed >= CTA_MIN_WAIT_MS) || elapsed >= CTA_MAX_WAIT_MS) {
        resolve();
        return;
      }
      window.setTimeout(check, CTA_POLL_MS);
    };
    check();
  });
}
const PILL: [number, number, number] = [0.8745, 0.8745, 0.8745];

function lerp3(
  from: [number, number, number],
  to: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

function TagHit(props: { href: string; label: string; class?: string }) {
  const motion = createWipe(220);
  const fill = () => lerp3(PILL, readCssColor("--color-key"), motion.wipe());
  return (
    <A
      href={props.href}
      class={`uis-tag pointer-events-auto ${props.class ?? ""}`}
      onPointerEnter={() => motion.enter()}
      onPointerLeave={() => motion.leave()}
      onFocusIn={() => motion.enter()}
      onFocusOut={() => motion.leave()}
    >
      <GlRoundRect class="uis-tag-fill" fill={fill()} />
      <MsdfText
        text={props.label}
        font="AlteHaasGroteskBold"
        tracking={0.32}
        knockout
        knockoutFill
        wipe={motion.wipe()}
        weird
      />
    </A>
  );
}

export function CompPiece(props: {
  title: string;
  body: string;
  tags: string[];
  updated: string | null;
  /** When set, a pill link to the other view (schematic ↔ component) sits at the bottom of the meta sidebar. */
  altHref?: string;
  altLabel?: string;
  /** The alt link rests struck in key blue and wipes clear on hover. */
  altInverted?: boolean;
  children: JSX.Element;
}) {
  const location = useLocation();
  const catalog = createAsync(() => getNavCatalog(), { deferStream: true });
  const number = () => {
    const sections = catalog();
    if (!sections) return null;
    return navNumberFor(sections, location.pathname);
  };

  const blurb = () => {
    const body = props.body.trim();
    if (!body) return props.title;
    return `${props.title} — ${body}`;
  };

  // The fade in is a CSS animation from first paint (LCP must not wait on
  // hydration). JS only drives the leave, and undoes it if a leave is cancelled.
  let feature: HTMLDivElement | undefined;

  onEnter(() => feature?.classList.remove("is-out"));

  onLeave(() => {
    if (!feature || typeof window === "undefined") return;
    feature.classList.add("is-out");
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, FEATURE_FADE_MS);
    });
  });

  onCleanup(() => feature?.classList.remove("is-out"));

  // Its own beat: hidden until the page and schematic have landed, then the fill
  // wipes in and the label follows. Re-runs when a UI page swaps in place.
  const cta = createWipe();
  const ctaLabel = createWipe(300);
  createEffect(
    on(
      () => location.pathname,
      () => {
        if (isServer || !props.altInverted) return;
        let cancelled = false;
        let labelTimer = 0;
        let beatTimer = 0;
        cta.reset();
        ctaLabel.reset();
        const show = () => {
          if (cancelled) return;
          cta.enter();
          labelTimer = window.setTimeout(() => ctaLabel.enter(), CTA_LABEL_DELAY_MS);
        };
        onCleanup(() => {
          cancelled = true;
          window.clearTimeout(labelTimer);
          window.clearTimeout(beatTimer);
        });
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !feature) {
          show();
          return;
        }
        void whenSettled(feature, () => cancelled).then(() => {
          beatTimer = window.setTimeout(show, CTA_BEAT_MS);
        });
      },
    ),
  );
  const ctaReveal = () => (props.altInverted ? cta.wipe() : 1);
  const ctaAlpha = () => (props.altInverted ? ctaLabel.wipe() : undefined);

  return (
    <div class="uis-page">
      <h1 class="sr-only">{props.title}</h1>
      <div class="uis-feature" ref={feature}>
        {props.children}
      </div>
      {/* Last two grid columns, gx gutter to the viewport. Copy wraps at 80%. */}
      <aside
        data-ui-component-hide
        data-mosaic-chrome="meta"
        class="uis-meta pointer-events-none fixed top-0 right-0 z-5 flex h-lvh flex-col justify-center pr-gx py-[3svh]"
      >
        <div class="uis-meta-col flex w-grids-2 flex-col gap-8">
          <Show when={number()}>
            {(n) => (
              <p class="uis-meta-num" aria-hidden="true">
                <CountDigits value={n()} />
              </p>
            )}
          </Show>
          <p class="uis-meta-blurb max-w-[80%]">
            <CmsMsdfBlock text={blurb()} tracking={-0.053} />
          </p>
          <Show when={props.tags.length > 0}>
            <div class="flex flex-col gap-4">
              <p class="uis-meta-label">
                <MsdfText text="DATA" font="Garara-10" weird />
              </p>
              <ul class="flex flex-wrap items-start gap-2">
                <For each={props.tags}>
                  {(tag) => (
                    <li class="w-max">
                      <TagHit
                        href={tagPath(tag)}
                        label={labelForTag(tag)}
                      />
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </Show>
          <Show when={props.updated}>
            {(date) => (
              <div class="flex flex-col gap-4">
                <p class="uis-meta-label">
                  <MsdfText text="LAST UPDATED" font="Garara-10" weird />
                </p>
                <p class="uis-meta-date">
                  <MsdfText
                    text={date()}
                    font="AlteHaasGroteskBold"
                    tracking={0.32}
                    weird
                  />
                </p>
              </div>
            )}
          </Show>
          <Show when={props.altHref}>
            {(href) => (
              <NavHit
                href={href()}
                inverted={props.altInverted}
                reveal={ctaReveal()}
                class={`uis-meta-alt pointer-events-auto relative inline-flex items-center min-h-6 min-w-6${props.altInverted ? " uis-meta-cta" : ""}`}
              >
                <span class="relative inline-flex w-max">
                  <NavHitText
                    text={props.altLabel ?? ""}
                    font="AlteHaasGroteskBold"
                    alpha={ctaAlpha()}
                  />
                </span>
              </NavHit>
            )}
          </Show>
        </div>
      </aside>
    </div>
  );
}
