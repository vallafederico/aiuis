import {
  Show,
  createContext,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type JSX,
} from "solid-js";
import { A } from "@acme/router";
import GlRoundRect from "./webgl/GlRoundRect";
import MsdfText from "./webgl/MsdfText";
import { readCssColor } from "./webgl/css-color";

const WipeCtx = createContext<() => number>(() => 0);

const DURATION = 400;

function easeOut(t: number) {
  return 1 - (1 - t) ** 4;
}

export function createWipe(duration = DURATION) {
  const [wipe, setWipe] = createSignal(0);
  let raf = 0;
  let from = 0;
  let to = 0;
  let start = 0;

  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    setWipe(from + (to - from) * easeOut(t));
    if (t < 1 && typeof requestAnimationFrame === "function") {
      raf = requestAnimationFrame(tick);
    }
  };

  const go = (next: number) => {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof requestAnimationFrame !== "function") {
      setWipe(next);
      return;
    }
    from = wipe();
    to = next;
    start = performance.now();
    raf = requestAnimationFrame(tick);
  };

  onCleanup(() => {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
  });
  return { wipe, enter: () => go(1), leave: () => go(0) };
}

function HoverStrike(props: { wipe: number }) {
  return (
    <GlRoundRect
      layer={8}
      radius={0}
      wipe={props.wipe}
      fill={readCssColor("--color-key")}
      class="pointer-events-none absolute top-1/2 -right-[0.28em] -left-[0.16em] h-[1.15em] -translate-y-1/2"
    />
  );
}

export function NavHit(props: {
  href: string;
  class?: string;
  current?: boolean;
  end?: boolean;
  onPointerEnter?: () => void;
  children: JSX.Element;
}) {
  const motion = createWipe();
  return (
    <WipeCtx.Provider value={motion.wipe}>
      <A
        href={props.href}
        end={props.end}
        class={props.class}
        aria-current={props.current ? "page" : undefined}
        onPointerEnter={() => {
          props.onPointerEnter?.();
          if (!props.current) motion.enter();
        }}
        onPointerLeave={() => motion.leave()}
        onFocusIn={() => {
          if (!props.current) motion.enter();
        }}
        onFocusOut={() => motion.leave()}
      >
        <Show when={!props.current && motion.wipe() > 0.001}>
          <HoverStrike wipe={motion.wipe()} />
        </Show>
        {props.children}
      </A>
    </WipeCtx.Provider>
  );
}

export function NavHitText(props: {
  text: string;
  font?: string;
  tracking?: number;
  lineHeight?: number;
  class?: string;
  /** Recede treatment (nav search); MSDF paints via WebGL, so CSS opacity can't dim it. */
  alpha?: number;
  /** The nav's distorted letterforms; off for links set in body copy. */
  weird?: boolean;
}) {
  const wipe = useContext(WipeCtx);
  const [box, setBox] = createSignal({ origin: 0, span: 1 });
  let shell: HTMLSpanElement | undefined;

  const measure = () => {
    const text = shell?.getBoundingClientRect();
    const bar = shell?.closest("a")?.getBoundingClientRect();
    if (!text || !bar || bar.width < 1 || text.width < 1) return;
    const origin = (text.left - bar.left) / bar.width;
    const span = text.width / bar.width;
    setBox((prev) =>
      Math.abs(prev.origin - origin) < 0.001 && Math.abs(prev.span - span) < 0.001
        ? prev
        : { origin, span },
    );
  };

  onMount(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (shell) ro.observe(shell);
    const anchor = shell?.closest("a");
    if (anchor) ro.observe(anchor);
    onCleanup(() => ro.disconnect());
  });

  return (
    <span ref={shell} class="relative inline-flex w-max max-w-full">
      <MsdfText
        text={props.text}
        font={props.font}
        tracking={props.tracking}
        lineHeight={props.lineHeight}
        class={props.class}
        alpha={props.alpha}
        knockout
        wipe={wipe()}
        wipeOrigin={box().origin}
        wipeSpan={box().span}
        weird={props.weird ?? true}
      />
    </span>
  );
}
