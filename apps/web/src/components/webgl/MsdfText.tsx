import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  splitProps,
  useContext,
  type JSX,
} from "solid-js";
import { isServer } from "solid-js/web";
import { createItem, type ItemController } from "shooosh";
import { getCanvasDensity, webgl } from "~/lib/stores/webglStore";
import {
  registerArticleLine,
  type ArticleFocusSample,
} from "~/lib/article-focus";
import { buildMsdfTextFragment, loadMsdfFont } from "./msdf-text";
import { DotCoverCtx } from "./dot-cover";
import { buildWeirdFragment } from "./msdf-weird";
import type { ProgressiveBlur } from "./sdf-texture";
import { readCssColor } from "./css-color";

type MsdfTextProps = JSX.HTMLAttributes<HTMLSpanElement> & {
  text: string;
  font?: string;
  tracking?: number;
  lineHeight?: number;
  fontSize?: number;
  fitWidth?: boolean;
  blur?: ProgressiveBlur;
  color?: [number, number, number];
  alpha?: number;
  weird?: boolean;
  knockout?: boolean;
  /** Whole-string invert (tags) instead of a left-to-right wipe. */
  knockoutFill?: boolean;
  wipe?: number;
  /** Text box inside the link, so a wide bar and the glyphs share one wipe. */
  wipeOrigin?: number;
  wipeSpan?: number;
  /** Viewport zoom and clarity, driven by the article focus pass. */
  articleLine?: boolean;
};

export default function MsdfText(props: MsdfTextProps) {
  const [local, rest] = splitProps(props, [
    "text",
    "font",
    "tracking",
    "lineHeight",
    "fontSize",
    "fitWidth",
    "blur",
    "color",
    "alpha",
    "weird",
    "knockout",
    "knockoutFill",
    "wipe",
    "wipeOrigin",
    "wipeSpan",
    "articleLine",
  ]);
  const [aspect, setAspect] = createSignal<number>();
  const coverCtx = useContext(DotCoverCtx);

  let shell!: HTMLSpanElement;
  let el!: HTMLSpanElement;
  let item: ItemController | undefined;
  let disposed = false;
  let generation = 0;
  let wipeRef = 0;
  let focus: ArticleFocusSample = { scale: 1, alpha: 1, blur: 0 };

  const applyFocus = (sample: ArticleFocusSample) => {
    focus = sample;
    if (!local.articleLine) return;
    shell.style.transform = sample.scale === 1 ? "" : `scale(${sample.scale})`;
    const dpr = getCanvasDensity();
    item?.setUni({
      value1: (local.alpha ?? 1) * sample.alpha,
      value3: ((local.blur?.radius ?? 0) + sample.blur) * dpr,
    });
    syncSize();
  };

  // The aa band scales with these. A read while hidden (display:none,
  // mid-transition) returns 0 and would leave the glyphs soft once shown.
  const syncSize = () => {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = getCanvasDensity();
    item?.setUni({
      value2: rect.width * dpr,
      value4: rect.height * dpr,
    });
  };

  onMount(() => {
    const resize = new ResizeObserver(syncSize);
    resize.observe(el);
    onCleanup(() => resize.disconnect());
  });

  onMount(() => {
    if (!local.articleLine) return;
    onCleanup(registerArticleLine(shell, applyFocus));
  });

  const pushCover = () => {
    if (!item) return;
    const cover = coverCtx?.() ?? null;
    if (!cover || cover.r <= 0) {
      item.setUni({ value14: 0 });
      return;
    }
    const text = el.getBoundingClientRect();
    const wrap = el.closest("[data-gl-dot]")?.getBoundingClientRect();
    if (!wrap || text.width < 1) {
      item.setUni({ value14: 0 });
      return;
    }
    const dpr = getCanvasDensity();
    item.setUni({
      value12: (wrap.left + cover.x - text.left) * dpr,
      value13: (wrap.top + cover.y - text.top) * dpr,
      value14: cover.r * dpr,
    });
  };

  createEffect(() => {
    coverCtx?.();
    pushCover();
  });

  createEffect(() => {
    if (!webgl.loaded) return;
    const { text, font, tracking, lineHeight, weird, blur, color, alpha, knockout, knockoutFill } = local;
    const current = ++generation;

    loadMsdfFont(font ?? "Garara")
      .then(({ metrics, texture }) => {
        if (disposed || current !== generation) return;

        const layoutColor = color ?? readCssColor("--color-key");
        const layoutAlpha = alpha ?? 1.0;
        const layout = {
          tracking,
          lineHeight,
          blur,
          color: layoutColor,
          alpha: layoutAlpha,
          knockout: !!knockout,
          knockoutFill: !!knockoutFill,
          paper: knockout ? readCssColor("--color-paper") : undefined,
        };
        const { fragment, aspect: asp } = weird
          ? buildWeirdFragment(metrics, text, { ...layout, weird: true })
          : buildMsdfTextFragment(metrics, text, layout);
        setAspect(asp);
        item?.destroy();
        const rect = el.getBoundingClientRect();
        const dpr = getCanvasDensity();
        item = createItem(el, {
          texture,
          shaders: { fragment, fragmentGlsl: fragment },
          uni: {
            value1: layoutAlpha * (local.articleLine ? focus.alpha : 1),
            value2: (rect.width || 1) * dpr,
            value3: knockout
              ? 0
              : ((blur?.radius ?? 0) + (local.articleLine ? focus.blur : 0)) * dpr,
            value4: (rect.height || 1) * dpr,
            value9: knockout ? wipeRef : 1,
            value10: local.wipeOrigin ?? 0,
            value11: local.wipeSpan ?? 1,
            value14: 0,
          },
          layer: coverCtx ? 12 : undefined,
        });
        queueMicrotask(pushCover);
        if (local.articleLine) applyFocus(focus);
        window.requestAnimationFrame(syncSize);
      })
      .catch((error) => console.error("[MsdfText]", local.text, error));
  });

  createEffect(() => {
    if (!local.knockout) return;
    wipeRef = local.wipe ?? 0;
    item?.setUni({
      value9: wipeRef,
      value10: local.wipeOrigin ?? 0,
      value11: local.wipeSpan ?? 1,
    });
  });

  onCleanup(() => {
    disposed = true;
    if (isServer) return;
    item?.destroy();
  });

  const useAspect = () => local.fitWidth && aspect() !== undefined;

  return (
    <span
      ref={shell}
      {...rest}
      style={{
        display: "inline-block",
        position: "relative",
        "transform-origin": "center center",
        ...(useAspect() ? { "aspect-ratio": String(aspect()) } : {}),
        ...(local.fontSize ? { "font-size": `${local.fontSize}px` } : {}),
        ...(typeof rest.style === "object" && rest.style !== null
          ? (rest.style as Record<string, string>)
          : {}),
      }}
    >
      {/* Real HTML stays in the tree for layout, hit-testing, screen
          readers, and crawlers. [data-msdf] is visually hidden while
          WebGL paints; <noscript> in entry-server reveals it without JS. */}
      <span
        ref={el}
        data-msdf
        style={{ "white-space": "pre" }}
      >
        {local.text}
      </span>
    </span>
  );
}
