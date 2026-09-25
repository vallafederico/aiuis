/**
 * Sketch Generation, art-directed: the page is the paper. Ink, the waiting
 * bleed and the developing image are one surface drawn by a shooosh item, so
 * the site's post effects apply. The site holds the prompt and shows it only
 * after the image exists.
 */
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { createItem, getDefaultEngine, type ItemController } from "shooosh";
import type { UiProps } from "../types";
import { SKETCH_BRIEF_CHIPS, type SketchBriefId } from "~/lib/sketch-generation";
import { getCanvasDensity, webgl } from "~/lib/stores/webglStore";
import { readCssColor } from "~/components/webgl/css-color";
import { glslShaders } from "~/components/webgl/shaders";
import MsdfText from "~/components/webgl/MsdfText";
import GlRoundRect from "~/components/webgl/GlRoundRect";
import CmsMsdfBlock from "~/components/cms/CmsMsdfBlock";
import { createWipe } from "~/components/NavHit";
import { scaleComponentLens } from "~/lib/component-view";
import { SketchGl } from "../sketch-generation-gl";
import { createSketchSession, sketchChipLabel } from "../sketch-session";
import "./SketchGeneration.css";

const PILL: [number, number, number] = [0.8745, 0.8745, 0.8745];
/** Long side of the line drawing and underpainting sent to the model. */
const EXPORT_MAX = 640;
/** Heavier than the schematic pad's line: the page is several times larger. */
const STROKE_WIDTH = 4.4;
/** How far the last image fades toward the paper as a new round is drawn. */
const REDRAW_DIM = 0.6;
const RENDER_DIM = 0.72;
/** Matches the session's idle trigger, for the arming line. */
const ARM_MS = 1500;
const ENGINE_WAIT_MS = 5000;
/** How far the glow may spill past the drawing area (CSS px), capped by its short side. */
const BLEED_PX = 220;
const BLEED_SHARE = 0.3;

/**
 * value1–2 surface size (CSS px, drawing area plus bleed), value3 dot grid
 * strength, value4 bleed (CSS px). value5–8 are the engine's texture-fit
 * slots and stay unused.
 */
function surfaceShaders() {
  const [r, g, b] = readCssColor("--color-key");
  return glslShaders(`#version 300 es
precision highp float;
in vec2 vUv;
uniform vec4 uUni[4];
uniform sampler2D uTexture;
out vec4 outColor;

void main() {
  vec3 key = vec3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)});
  float bleed = uUni[0].w;
  vec2 size = max(uUni[0].xy - 2.0 * bleed, vec2(1.0));
  vec2 px = vUv * uUni[0].xy - bleed;
  vec2 cell = mod(px - size * 0.5, 24.0) - 12.0;
  float dotA = (1.0 - smoothstep(0.55, 1.25, length(cell))) * uUni[0].z;
  float edge = min(min(px.x, size.x - px.x), min(px.y, size.y - px.y));
  dotA *= smoothstep(0.0, 96.0, edge);
  vec4 ink = texture(uTexture, vec2(vUv.x, 1.0 - vUv.y));
  outColor = ink + vec4(key * dotA, dotA) * (1.0 - ink.a);
}`);
}

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

/** A pill like the site's tags: grey at rest, key-filled when on or hovered. */
function Chip(props: { label: string; active?: boolean; onClick: () => void }) {
  const motion = createWipe(220);
  const [hover, setHover] = createSignal(false);
  createEffect(() => {
    if (props.active || hover()) motion.enter();
    else motion.leave();
  });
  const fill = () => lerp3(PILL, readCssColor("--color-key"), motion.wipe());
  return (
    <button
      type="button"
      class="sk-chip"
      aria-pressed={props.active === undefined ? undefined : props.active}
      onClick={() => props.onClick()}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocusIn={() => setHover(true)}
      onFocusOut={() => setHover(false)}
    >
      <GlRoundRect class="sk-chip-fill" fill={fill()} />
      <MsdfText
        text={props.label.toUpperCase()}
        font="AlteHaasGroteskBold"
        tracking={0.32}
        knockout
        knockoutFill
        wipe={motion.wipe()}
        weird
      />
    </button>
  );
}

export default function SketchGenerationDirected(_props: UiProps) {
  const [glError, setGlError] = createSignal<string | null>(null);
  const [arm, setArm] = createSignal(0);
  const [penDown, setPenDown] = createSignal(false);

  // The lens distorts the page and the image as it prints, but not under a
  // pen: a stroke has to land exactly where it is drawn.
  createEffect(() => {
    scaleComponentLens(penDown() ? 0 : 1);
  });
  onCleanup(() => scaleComponentLens(1));

  let surface!: HTMLDivElement;
  let bleedEl!: HTMLDivElement;
  let gl: SketchGl | null = null;

  const session = createSketchSession({
    gl: () => gl,
    surface: () => surface,
  });
  const { phase, progress, briefId, pendingBrief, shown, hasInk } = session;

  onMount(() => session.pickRandomBrief());

  // The surface lives in the site engine's context; it exists once the scene does.
  createEffect(() => {
    if (!webgl.loaded) return;
    const engine = getDefaultEngine();
    const context = engine?.gl;
    if (!engine || !context) {
      setGlError("This page draws in WebGL2, which the site renderer did not get.");
      return;
    }
    const sketch = SketchGl.shared(context, readCssColor("--color-key"), {
      requestFrame: () => engine.requestFrame(),
      exportMax: EXPORT_MAX,
      strokeWidth: STROKE_WIDTH,
    });
    if (!sketch) {
      setGlError("The drawing surface could not start in this browser.");
      return;
    }
    setGlError(null);
    gl = sketch;

    let item: ItemController | undefined;
    const measure = () => {
      const rect = surface.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const bleed = Math.round(Math.min(BLEED_PX, Math.min(rect.width, rect.height) * BLEED_SHARE));
      bleedEl.style.inset = `${-bleed}px`;
      sketch.layoutSurface(rect.width, rect.height, getCanvasDensity(), bleed);
      const uni = { value1: rect.width + bleed * 2, value2: rect.height + bleed * 2, value4: bleed };
      if (item) {
        item.setUni(uni);
        return;
      }
      // The surface texture keeps its identity across resizes, so one item is enough.
      item = createItem(bleedEl, {
        layer: 5,
        shaders: surfaceShaders(),
        texture: sketch.surfaceTexture(),
        textureFit: "stretch",
        uni: { ...uni, value3: 0.16 },
        onFrame: () => sketch.renderShared(),
      });
      engine.requestFrame();
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(surface);

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyMotion = () => sketch.setMotion(!motionQuery.matches);
    applyMotion();
    motionQuery.addEventListener("change", applyMotion);

    const onLost = () => setGlError("The page lost its WebGL context. Reload to draw again.");
    engine.canvas.addEventListener("webglcontextlost", onLost);

    onCleanup(() => {
      observer.disconnect();
      motionQuery.removeEventListener("change", applyMotion);
      engine.canvas.removeEventListener("webglcontextlost", onLost);
      item?.destroy();
      sketch.dispose();
      if (gl === sketch) gl = null;
    });
  });

  onMount(() => {
    const timer = window.setTimeout(() => {
      if (!webgl.loaded) setGlError("This page draws in WebGL2, which this browser did not provide.");
    }, ENGINE_WAIT_MS);
    onCleanup(() => window.clearTimeout(timer));
  });

  // The last image falls back toward the paper while a new round is drawn or read.
  createEffect(() => {
    const p = phase();
    const dim =
      p === "generating" || p === "developing"
        ? RENDER_DIM
        : shown()
          ? progress() * REDRAW_DIM
          : 0;
    gl?.setDim(dim);
  });

  // The arming line: runs out over the idle wait before a render starts.
  createEffect(() => {
    if (phase() !== "armed") {
      setArm(0);
      return;
    }
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      setArm(Math.min(1, (now - start) / ARM_MS));
      if (now - start < ARM_MS) raf = requestAnimationFrame(tick);
    });
    onCleanup(() => cancelAnimationFrame(raf));
  });

  const stateLabel = () => {
    const pending = pendingBrief();
    const p = phase();
    if (p === "generating" && pending) return `READING · ${sketchChipLabel(pending).toUpperCase()}`;
    if (p === "developing" && pending) return `DEVELOPING · ${sketchChipLabel(pending).toUpperCase()}`;
    if (p === "armed") return "SKETCH · HOLD STILL";
    const s = shown();
    if (s && hasInk()) return `${s.label.toUpperCase()} · DRAW TO REVISE`;
    return "SKETCH";
  };

  const meterFill = () => (phase() === "generating" || phase() === "developing" ? 1 : progress());
  const pickBrief = (id: SketchBriefId) => session.pickBrief(id);

  return (
    <div class="sk-page" data-phase={phase()}>
      <div class="sk-head">
        <span class="sk-label" aria-hidden="true">
          <MsdfText text={stateLabel()} font="Garara-10" weird />
        </span>
        <span class="sk-meter" aria-hidden="true">
          <GlRoundRect class="sk-meter-track" radius={0} fill={lerp3(PILL, readCssColor("--color-key"), 0.18)} />
          <GlRoundRect class="sk-meter-fill" radius={0} wipe={meterFill()} fill={readCssColor("--color-key")} />
          <Show when={phase() === "armed"}>
            <GlRoundRect class="sk-meter-arm" radius={0} layer={10} wipe={arm()} fill={lerp3(PILL, readCssColor("--color-key"), 0.45)} />
          </Show>
        </span>
        <span class="sk-clear">
          <Show when={hasInk() || shown()}>
            <Chip label="clear" onClick={session.clear} />
          </Show>
        </span>
      </div>

      <div
        class="sk-surface"
        ref={surface}
        role="img"
        aria-label="Drawing surface. Draw with a mouse, pen, or finger; the image renders when you pause."
        onPointerDown={(event) => {
          setPenDown(true);
          session.onPointerDown(event);
        }}
        onPointerMove={session.onPointerMove}
        onPointerUp={(event) => {
          setPenDown(false);
          session.onPointerUp(event);
        }}
        onPointerCancel={(event) => {
          setPenDown(false);
          session.onPointerUp(event);
        }}
        onLostPointerCapture={(event) => {
          setPenDown(false);
          session.onPointerUp(event);
        }}
      >
        <div class="sk-bleed" ref={bleedEl} aria-hidden="true" />
        <Show when={phase() === "empty" && !shown() && !glError()}>
          <span class="sk-hint" aria-hidden="true">
            <MsdfText text="DRAW" font="Garara-10" weird alpha={0.55} />
          </span>
        </Show>
        <Show when={glError()}>
          {(message) => (
            <div class="sk-error">
              <CmsMsdfBlock text={message()} tracking={-0.07} />
            </div>
          )}
        </Show>
      </div>

      <aside class="sk-aside">
        <div class="sk-provenance" aria-live="polite">
          <Show when={shown()}>
            {(s) => (
              <>
                <p class="sk-small">
                  <MsdfText text="PROMPT · HELD BY THE SITE" font="Garara-10" weird />
                </p>
                <p class="sk-prompt">
                  <CmsMsdfBlock text={s().prompt} tracking={-0.07} />
                </p>
                <p class="sk-source">
                  {/* WebGL text ignores CSS opacity: the fallback dims through alpha. */}
                  <MsdfText
                    text={s().source.toUpperCase()}
                    font="AlteHaasGroteskBold"
                    tracking={0.32}
                    alpha={s().fallback ? 0.6 : 1}
                    weird
                  />
                </p>
              </>
            )}
          </Show>
        </div>

        <div class="sk-controls">
          <p class="sk-small">
            <MsdfText text="BRIEF" font="Garara-10" weird />
          </p>
          <ul class="sk-chips">
            <For each={SKETCH_BRIEF_CHIPS}>
              {(chip) => (
                <li>
                  <Chip
                    label={chip.label}
                    active={briefId() === chip.id}
                    onClick={() => pickBrief(chip.id)}
                  />
                </li>
              )}
            </For>
          </ul>
        </div>
      </aside>
    </div>
  );
}
