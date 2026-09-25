import { loadTexture } from "shooosh";
import { readCssColor } from "~/components/webgl/css-color";
import { glslShaders } from "~/components/webgl/shaders";

export type BallTexture = Awaited<ReturnType<typeof loadTexture>>;

const TEXTURE_PX = 512;
/** The decal spans this much of the sphere's diameter, so type stays off the rim. */
const DECAL = 0.78;

/**
 * A lit sphere on a flat quad. The title is a decal on the front and back
 * hemispheres of the ball, looked up through the ball's rotation, so it rolls
 * with it and foreshortens toward the rim like print on a real sphere.
 *
 * uUni[0]: alpha, hit (0 paper ball, 1 key ball), radius in device px, unused.
 * uUni[1] is shooosh's: it writes the texture fit there every frame.
 * uUni[2].xyz, uUni[3].xyz: first two rows of the object-from-view rotation;
 * the third is their cross product.
 */
export function ballShaders() {
  const [kr, kg, kb] = readCssColor("--color-key");
  const [pr, pg, pb] = readCssColor("--color-paper");
  const vec = (r: number, g: number, b: number) =>
    `vec3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)})`;
  return glslShaders(`#version 300 es
precision highp float;
in vec2 vUv;
uniform vec4 uUni[4];
uniform sampler2D uTexture;
out vec4 outColor;

const vec3 KEY = ${vec(kr, kg, kb)};
const vec3 PAPER = ${vec(pr, pg, pb)};
const float DECAL = ${DECAL.toFixed(4)};

float decal(vec2 p, float facing) {
  vec2 uv = p / DECAL * 0.5 + 0.5;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  return texture(uTexture, uv).a * inside * smoothstep(0.05, 0.25, facing);
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  p.y = -p.y;
  float len = length(p);
  float edge = clamp((1.0 - len) * uUni[0].z, 0.0, 1.0);
  float z = sqrt(max(1.0 - dot(p, p), 0.0));
  vec3 n = vec3(p, z);

  vec3 row0 = uUni[2].xyz;
  vec3 row1 = uUni[3].xyz;
  vec3 d = vec3(dot(row0, n), dot(row1, n), dot(cross(row0, row1), n));
  float front = decal(vec2(d.x, -d.y), d.z);
  float back = decal(vec2(-d.x, -d.y), -d.z);
  float ink = max(front, back);

  float hit = uUni[0].y;
  vec3 ball = mix(mix(PAPER, vec3(1.0), 0.55), KEY, hit);
  vec3 print = mix(KEY, PAPER, hit);
  vec3 color = mix(ball, print, ink);

  vec3 light = normalize(vec3(-0.45, 0.6, 0.75));
  float diffuse = max(dot(n, light), 0.0);
  color *= 0.74 + 0.26 * diffuse;
  float rim = pow(1.0 - z, 3.0);
  color = mix(color, KEY * 0.85, rim * 0.28);
  vec3 bounce = reflect(-light, n);
  // Matte paper, not gloss: a faint, broad sheen.
  float spec = pow(max(bounce.z, 0.0), 8.0);
  color += vec3(spec * 0.1);

  float alpha = edge * uUni[0].x;
  outColor = vec4(color * alpha, alpha);
}`);
}

function wrapTitle(ctx: CanvasRenderingContext2D, title: string, width: number) {
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The title in the site's grotesk, white on clear; the shader tints it. */
export async function titleTexture(title: string): Promise<BallTexture> {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_PX;
  canvas.height = TEXTURE_PX;
  const ctx = canvas.getContext("2d")!;
  const box = TEXTURE_PX * 0.86;
  let size = 124;
  let lines: string[] = [];
  for (; size > 40; size -= 6) {
    ctx.font = `700 ${size}px alte-haas, sans-serif`;
    ctx.letterSpacing = `${-0.07 * size}px`;
    lines = wrapTitle(ctx, title, box);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest <= box && lines.length * size * 0.98 <= box) break;
  }
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lead = size * 0.98;
  const top = TEXTURE_PX / 2 - ((lines.length - 1) * lead) / 2;
  lines.forEach((l, i) => ctx.fillText(l, TEXTURE_PX / 2, top + i * lead));
  return loadTexture(canvas);
}
