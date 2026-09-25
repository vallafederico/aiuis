import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { createMsdfGlyphs, getDefaultEngine, type MsdfGlyphsHandle } from "shooosh";
import GlFill from "~/components/webgl/GlFill";
import { readCssColor } from "~/components/webgl/css-color";
import {
  getCharMap,
  getMsdfFontMetricsSync,
  loadMsdfFont,
  type BmFont,
} from "~/components/webgl/msdf-text";
import { webgl } from "~/lib/stores/webglStore";

const FONT = "AlteHaasGroteskBold";

export type GlLine = {
  glyphData: Float32Array;
  glyphCount: number;
  /** Advance in font units, and the pen after each character (for a caret). */
  width: number;
  pens: number[];
};

/**
 * One line of glyphs on the font's own line box rather than its ink bounds,
 * so the baseline never jumps as ascenders and descenders come and go.
 */
export function layoutLine(font: BmFont, text: string, trackingEm: number): GlLine {
  const chars = getCharMap(font);
  const { scaleW, scaleH, lineHeight } = font.common;
  const size = font.info.size;
  const tracking = trackingEm * size;
  const boxes: number[][] = [];
  const pens = [0];
  let pen = 0;
  for (const ch of text) {
    const g = chars.get(ch);
    if (!g) {
      pen += size * 0.33 + tracking;
      pens.push(pen);
      continue;
    }
    if (g.width > 0 && g.height > 0) {
      boxes.push([
        pen + g.xoffset,
        g.yoffset,
        pen + g.xoffset + g.width,
        g.yoffset + g.height,
        g.x / scaleW,
        g.y / scaleH,
        (g.x + g.width) / scaleW,
        (g.y + g.height) / scaleH,
      ]);
    }
    pen += g.xadvance + tracking;
    pens.push(pen);
  }
  const width = Math.max(1, text ? pen - tracking : 1);
  const glyphData = new Float32Array(boxes.length * 8);
  boxes.forEach((b, i) => {
    glyphData.set(
      [b[0] / width, b[1] / lineHeight, b[2] / width, b[3] / lineHeight, b[4], b[5], b[6], b[7]],
      i * 8,
    );
  });
  return { glyphData, glyphCount: boxes.length, width, pens };
}

/**
 * A single centred line of text drawn with instanced MSDF glyphs, so it can
 * change on every keystroke without compiling anything. The DOM keeps a
 * transparent copy for layout and assistive tech; this only paints.
 */
export function GlTextLine(props: {
  text: string;
  /** Rendered size of the matching DOM text, in CSS px. */
  fontPx: number;
  trackingEm: number;
  alpha?: number;
  class?: string;
  /** Caret after this many characters, or null for none. */
  caret?: number | null;
}) {
  const font = getMsdfFontMetricsSync(FONT)!;
  const scale = () => props.fontPx / font.info.size;
  const line = createMemo(() => layoutLine(font, props.text, props.trackingEm));
  const size = () => ({
    w: line().width * scale(),
    h: font.common.lineHeight * scale(),
  });

  let el!: HTMLSpanElement;
  let glyphs: MsdfGlyphsHandle | undefined;

  createEffect(() => {
    if (!webgl.loaded) return;
    let disposed = false;
    void loadMsdfFont(FONT).then(({ metrics, texture }) => {
      if (disposed) return;
      const current = line();
      glyphs = createMsdfGlyphs(el, {
        texture,
        glyphData: current.glyphData,
        glyphCount: current.glyphCount,
        distanceRange: metrics.distanceField?.distanceRange ?? 8,
        atlasWidth: metrics.common.scaleW,
        color: readCssColor("--color-key") as [number, number, number],
        alpha: props.alpha ?? 1,
        boxAspect: current.width / metrics.common.lineHeight,
        uni: { value2: size().w, value4: size().h },
      });
      getDefaultEngine()?.requestFrame();
    });
    onCleanup(() => {
      disposed = true;
      glyphs?.destroy();
      glyphs = undefined;
    });
  });

  createEffect(() => {
    const current = line();
    const { w, h } = size();
    glyphs?.setGlyphData(current.glyphData, current.glyphCount, current.width / font.common.lineHeight);
    glyphs?.setUni({ value2: w, value4: h });
  });

  // Blink by collapsing the caret: a zero-size box is culled, no quad rebuild.
  const [blinkOn, setBlinkOn] = createSignal(true);
  createEffect(() => {
    if (props.caret == null) return;
    props.text;
    setBlinkOn(true);
    const id = window.setInterval(() => {
      setBlinkOn((on) => !on);
      getDefaultEngine()?.requestFrame();
    }, 530);
    onCleanup(() => window.clearInterval(id));
  });

  const caretX = () => {
    const at = props.caret;
    if (at == null) return 0;
    const pens = line().pens;
    return (pens[Math.min(at, pens.length - 1)] ?? 0) * scale();
  };

  return (
    <span
      ref={el}
      class={props.class}
      aria-hidden="true"
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: `${size().w}px`,
        height: `${size().h}px`,
        transform: "translate(-50%, -50%)",
        "pointer-events": "none",
      }}
    >
      <Show when={props.caret != null}>
        <span
          style={{
            position: "absolute",
            left: `${caretX()}px`,
            top: `${(size().h - props.fontPx) / 2}px`,
            width: blinkOn() ? "2px" : "0px",
            height: `${props.fontPx}px`,
          }}
        >
          <GlFill class="flt-gl-fill" layer={10} />
        </span>
      </Show>
    </span>
  );
}
