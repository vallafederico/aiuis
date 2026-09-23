import {
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  splitProps,
  type JSX,
} from "solid-js";
import { isServer } from "solid-js/web";
import { createParticles, type ParticlesController } from "shooosh";
import { readCssColor } from "./css-color";
import { DotCoverCtx, type DotCover } from "./dot-cover";
import { webgl } from "~/lib/stores/webglStore";
import { Scroll } from "~/lib/utils/scroll";

type GlDotProps = {
  children: JSX.Element;
  /** Whether to render the WebGL dot (default true). Reactive. */
  show?: boolean;
  /** Size multiplier relative to the wrapper box (default 0.8, ±15% per-dot jitter). */
  scale?: number;
  /** RGBA color 0–1 (default: --color-key blue). */
  color?: [number, number, number, number];
  /** 0–1 hover grow. The dot scales up from its rest size and eases back. */
  grow?: number;
};

/**
 * Wraps children in an inline-block div. When `show` is true (default) and
 * the WebGL engine is ready, renders a single circular particle overlaid on
 * the children. The dot is sized to roughly the wrapper box (with a small
 * per-dot random size variation) and is offset from center by a small stable
 * random amount so it never sits exactly centered.
 *
 * The circle is published so the letter underneath can invert inside it.
 */
export default function GlDot(props: GlDotProps) {
  const [local] = splitProps(props, ["children", "show", "scale", "color", "grow"]);

  const offsetXFraction = (Math.random() < 0.5 ? -1 : 1) * (0.08 + Math.random() * 0.1);
  const offsetYFraction = (Math.random() < 0.5 ? -1 : 1) * (0.08 + Math.random() * 0.1);
  const scaleJitter = 0.85 + Math.random() * 0.3;

  let el!: HTMLDivElement;
  let particles: ParticlesController | undefined;
  const [box, setBox] = createSignal({ w: 0, h: 0 });
  const [cover, setCover] = createSignal<DotCover | null>(null);

  const getColor = (): [number, number, number, number] => {
    if (local.color) return local.color;
    return [...readCssColor("--color-key"), 1];
  };

  const computePosition = (rect: DOMRect, boxSize: number): Float32Array => {
    const cx = rect.left + rect.width / 2 + offsetXFraction * boxSize;
    const cy = rect.top + rect.height / 2 + offsetYFraction * boxSize;
    const clipX = (cx / window.innerWidth) * 2 - 1;
    const clipY = 1 - (cy / window.innerHeight) * 2;
    return new Float32Array([clipX, clipY]);
  };

  const DotCover = DotCoverCtx.Provider;

  if (isServer) {
    return (
      <DotCover value={cover}>
        <div data-gl-dot style={{ display: "inline-block" }}>
          {local.children}
        </div>
      </DotCover>
    );
  }

  onMount(() => {
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setBox({ w: rect.width, h: rect.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  });

  createEffect(() => {
    const { w, h } = box();
    const grow = local.grow ?? 0;
    const boxSize = Math.max(w, h);
    if (boxSize < 1) return;
    const scale = (local.scale ?? 0.8) * scaleJitter;
    const size = boxSize * scale * (1 + grow * 0.55);
    particles?.setSize(size);
    setCover({
      x: w / 2 + offsetXFraction * boxSize,
      y: h / 2 + offsetYFraction * boxSize,
      r: size / 2,
    });
  });

  createEffect(() => {
    const show = local.show ?? true;
    if (!webgl.loaded || !show) return;

    const color = getColor();
    const scale = (local.scale ?? 0.8) * scaleJitter;

    let rect = el.getBoundingClientRect();
    let boxSize = Math.max(rect.width, rect.height);
    let dotSize = boxSize * scale;

    let particlesLocal: ParticlesController | undefined = createParticles({
      positions: computePosition(rect, boxSize),
      size: dotSize,
      color,
      layer: 11,
    });
    particles = particlesLocal;

    const removeScroll = Scroll.add(() => {
      if (!particlesLocal) return;
      const r = el.getBoundingClientRect();
      particlesLocal.setPositions(computePosition(r, boxSize));
    });

    const onResize = () => {
      particlesLocal?.destroy();
      rect = el.getBoundingClientRect();
      boxSize = Math.max(rect.width, rect.height);
      dotSize = boxSize * scale * (1 + (local.grow ?? 0) * 0.55);
      particlesLocal = createParticles({
        positions: computePosition(rect, boxSize),
        size: dotSize,
        color,
        layer: 11,
      });
      particles = particlesLocal;
    };
    window.addEventListener("resize", onResize);

    onCleanup(() => {
      removeScroll();
      window.removeEventListener("resize", onResize);
      particles?.destroy();
      particles = undefined;
      particlesLocal = undefined;
    });
  });

  return (
    <DotCover value={cover}>
      <div ref={el} data-gl-dot style={{ display: "inline-block" }}>
        {local.children}
      </div>
    </DotCover>
  );
}
