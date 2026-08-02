import { createEffect, onCleanup } from "solid-js";
import { isServer } from "solid-js/web";
import { createPostProcessor } from "@ssscript/webgl";
import { webgl } from "~/lib/stores/webglStore";

type MouseDistortionProps = {
  /** Circle radius in pixels (default 48). */
  radius?: number;
  /** Magnification magnitude, 0-1 (default 0.3). */
  strength?: number;
  /** Pixel offset [x, y] applied to the lerped position (default [0, 0]). */
  offset?: [number, number];
};

const FRAGMENT_SHADER = `
vec4 applyEffect(vec4 color, vec2 uv, vec2 resolution, vec4 uni[4]) {
  // uni[0].x = mouseX (UV), uni[0].y = mouseY (UV)
  // uni[0].z = radiusUv, uni[0].w = currentStrength
  vec2 mouse = vec2(uni[0].x, uni[0].y);
  float radiusUv = uni[0].z;
  float strength = uni[0].w;

  // Aspect-correct distance to keep circle round
  vec2 aspect = vec2(resolution.x / resolution.y, 1.0);
  vec2 delta = (uv - mouse) * aspect;
  float dist = length(delta);

  // Soft circular mask
  float mask = smoothstep(radiusUv, radiusUv * 0.55, dist);

  // Zoom: pull uv toward the mouse center to magnify the area under the cursor
  float zoom = 1.0 - mask * strength;
  vec2 zoomed = mouse + (uv - mouse) * zoom;

  return texture(uTexture, zoomed);
}
`;

export default function MouseDistortion(props: MouseDistortionProps) {
  if (isServer) return null;

  createEffect(() => {
    if (!webgl.loaded) return;

    const radiusPx = props.radius ?? 48;
    const strengthMax = props.strength ?? 0.3;
    const offset = props.offset ?? [0, 0];

    // Lerp targets
    let targetX = 0.5;
    let targetY = 0.5;
    let targetStrength = 0;

    // Current lerped values
    let currentX = 0.5;
    let currentY = 0.5;
    let currentStrength = 0;

    // Radius in UV space (relative to viewport height, so resolution-independent)
    let radiusUv = radiusPx / window.innerHeight;

    const pp = createPostProcessor({
      onFrame(_post, frame) {
        // Already settled — skip the lerp and the setUni call so the engine
        // can go idle instead of chasing a target it will never exactly reach.
        if (currentX === targetX && currentY === targetY && currentStrength === targetStrength) {
          return;
        }

        const dt = Math.min(frame.delta * 0.001, 0.1); // seconds, clamped
        const k = 9;
        const t = 1 - Math.exp(-k * dt);

        currentX += (targetX - currentX) * t;
        currentY += (targetY - currentY) * t;
        currentStrength += (targetStrength - currentStrength) * t;

        // Snap once close enough — floating-point lerp never exactly converges.
        if (Math.abs(targetX - currentX) < 0.0005) currentX = targetX;
        if (Math.abs(targetY - currentY) < 0.0005) currentY = targetY;
        if (Math.abs(targetStrength - currentStrength) < 0.0005) currentStrength = targetStrength;

        pp.setEffectUni(effectId, {
          value1: currentX,
          value2: currentY,
          value3: radiusUv,
          value4: currentStrength,
        });
      },
    });

    const effectId = pp.addFragmentEffect({
      fragmentShader: FRAGMENT_SHADER,
      uni: {
        value1: currentX,
        value2: currentY,
        value3: radiusUv,
        value4: currentStrength,
      },
    });

    const onPointerMove = (e: PointerEvent) => {
      const ox = (offset[0]) / window.innerWidth;
      const oy = (offset[1]) / window.innerHeight;
      targetX = e.clientX / window.innerWidth + ox;
      targetY = e.clientY / window.innerHeight + oy;
      targetStrength = strengthMax;
    };

    const onPointerLeave = () => {
      targetStrength = 0;
    };

    const onResize = () => {
      radiusUv = radiusPx / window.innerHeight;
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("resize", onResize);

    onCleanup(() => {
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("resize", onResize);
      pp.removeEffect(effectId);
      pp.destroy();
    });
  });

  return null;
}
