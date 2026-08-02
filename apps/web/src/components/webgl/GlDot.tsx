import {
  createEffect,
  onCleanup,
  splitProps,
  type JSX,
} from "solid-js";
import { isServer } from "solid-js/web";
import { createParticles, type ParticlesController } from "@ssscript/webgl";
import { readCssColor } from "./css-color";
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
};

/**
 * Wraps children in an inline-block div. When `show` is true (default) and
 * the WebGL engine is ready, renders a single circular particle overlaid on
 * the children. The dot is sized to roughly the wrapper box (with a small
 * per-dot random size variation) and is offset from center by a small stable
 * random amount so it never sits exactly centered.
 */
export default function GlDot(props: GlDotProps) {
  const [local] = splitProps(props, ["children", "show", "scale", "color"]);

  // Computed once per mount — stable, non-zero offsets in both axes.
  // Each sign() call is invoked immediately, producing a stable value.
  const offsetXFraction = (Math.random() < 0.5 ? -1 : 1) * (0.08 + Math.random() * 0.1);
  const offsetYFraction = (Math.random() < 0.5 ? -1 : 1) * (0.08 + Math.random() * 0.1);
  const scaleJitter = 0.85 + Math.random() * 0.3;

  let el!: HTMLDivElement;

  const getColor = (): [number, number, number, number] => {
    if (local.color) return local.color;
    return [...readCssColor("--color-key"), 1];
  };

  /** Compute clip-space position of the dot from the current wrapper rect. */
  const computePosition = (rect: DOMRect, boxSize: number): Float32Array => {
    const cx = rect.left + rect.width / 2 + offsetXFraction * boxSize;
    const cy = rect.top + rect.height / 2 + offsetYFraction * boxSize;
    const clipX = (cx / window.innerWidth) * 2 - 1;
    const clipY = 1 - (cy / window.innerHeight) * 2;
    return new Float32Array([clipX, clipY]);
  };

  if (isServer) {
    return <div style={{ display: "inline-block" }}>{local.children}</div>;
  }

  createEffect(() => {
    const show = local.show ?? true;
    if (!webgl.loaded || !show) return;

    const color = getColor();
    const scale = (local.scale ?? 0.8) * scaleJitter;

    // Measure initial box
    let rect = el.getBoundingClientRect();
    let boxSize = Math.max(rect.width, rect.height);
    let dotSize = boxSize * scale;

    let particles: ParticlesController | undefined = createParticles({
      positions: computePosition(rect, boxSize),
      size: dotSize,
      color,
      layer: 11,
    });

    // Update position on scroll
    const removeScroll = Scroll.add(() => {
      if (!particles) return;
      const r = el.getBoundingClientRect();
      particles.setPositions(computePosition(r, boxSize));
    });

    // On resize, re-measure and recreate particle (size may change)
    const onResize = () => {
      particles?.destroy();
      rect = el.getBoundingClientRect();
      boxSize = Math.max(rect.width, rect.height);
      dotSize = boxSize * scale;
      particles = createParticles({
        positions: computePosition(rect, boxSize),
        size: dotSize,
        color,
        layer: 11,
      });
    };
    window.addEventListener("resize", onResize);

    onCleanup(() => {
      removeScroll();
      window.removeEventListener("resize", onResize);
      particles?.destroy();
      particles = undefined;
    });
  });

  return (
    <div ref={el} style={{ display: "inline-block" }}>
      {local.children}
    </div>
  );
}
