import { createCompute, getDefaultEngine, type ComputePingPong, type ComputeSession } from "shooosh";

/**
 * Fading pointer trail that the magnifier samples instead of a proximity circle.
 * WebGPU writes it with a compute shader into a storage-texture ping-pong.
 * WebGL2 writes it with a fullscreen fragment pass into a framebuffer ping-pong.
 * The field is top-origin on WebGPU and bottom-origin on WebGL2, matching each
 * post chain's `uv`. `.r` is the lens strength along the path. `.gb` packs the
 * uv offset to that stamp's focal point (0.5 means no offset).
 */

export type LensTrailInput = {
  /** Pointer in the post pass's uv space. */
  x: number;
  y: number;
  /** Stamp radius, as a fraction of the screen height. */
  radius: number;
  /** 0..1, how hard this frame's brush is. */
  stamp: number;
  dt: number;
  canvasWidth: number;
  canvasHeight: number;
  gl: WebGL2RenderingContext | null;
};

export type LensTrailHandle = {
  texture: unknown;
  gl?: WebGL2RenderingContext;
  view?: unknown;
};

export type LensTrail = {
  step: (input: LensTrailInput) => void;
  handle: () => LensTrailHandle | null;
  hot: () => boolean;
  destroy: () => void;
};

const TRAIL_SCALE = 0.5;
const FADE_RATE = 4.2 / 1.6 / 1.6;
/** A jump bigger than this starts a new stroke instead of bridging the gap. */
const MAX_SEGMENT = 0.2;

type Stamp = {
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  radius: number;
  stamp: number;
  fade: number;
  aspect: number;
  width: number;
  height: number;
};

function trailSize(canvasWidth: number, canvasHeight: number) {
  return {
    width: Math.max(64, Math.round(canvasWidth * TRAIL_SCALE)),
    height: Math.max(64, Math.round(canvasHeight * TRAIL_SCALE)),
  };
}

const COMPUTE_WGSL = /* wgsl */ `
struct Params {
  mouse: vec4f,
  brush: vec4f,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba16float, write>;

fn closestOnSeg(p: vec2f, a: vec2f, b: vec2f) -> vec2f {
  let ab = b - a;
  let l2 = dot(ab, ab);
  if (l2 <= 1e-8) {
    return a;
  }
  let t = clamp(dot(p - a, ab) / l2, 0.0, 1.0);
  return a + t * ab;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  if (gid.x >= size.x || gid.y >= size.y) {
    return;
  }
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(size);
  var prevTex = textureLoad(src, vec2i(gid.xy), 0);
  var prev = prevTex.r * params.brush.z;
  if (params.brush.z <= 0.0) {
    prev = 0.0;
    prevTex = vec4f(0.0, 0.5, 0.5, 1.0);
  }
  let aspect = vec2f(max(params.brush.w, 0.001), 1.0);
  let closest = closestOnSeg(uv * aspect, params.mouse.zw * aspect, params.mouse.xy * aspect) / aspect;
  let radius = max(params.brush.x, 1e-4);
  let fall = length((uv - closest) * aspect) / radius;
  let brush = exp(-fall * fall) * params.brush.y;
  // One focal point for the whole stamp. A per-texel closest point turns the
  // stroke into a rod lens with a ridge down the middle.
  let focal = (params.mouse.xy + params.mouse.zw) * 0.5;
  let packed = clamp(focal - uv, vec2f(-0.25), vec2f(0.25)) * 2.0 + 0.5;
  let w = prev + brush;
  if (w < 1e-4) {
    textureStore(dst, vec2i(gid.xy), vec4f(0.0, 0.5, 0.5, 1.0));
  } else {
    let intensity = 1.0 - (1.0 - clamp(prev, 0.0, 1.0)) * (1.0 - clamp(brush, 0.0, 1.0));
    let blended = (prevTex.gb * prev + packed * brush) / w;
    textureStore(dst, vec2i(gid.xy), vec4f(intensity, blended, 1.0));
  }
}
`;

const GL_VS = `#version 300 es
layout(location = 0) in vec2 aPosition;
out vec2 vUv;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vUv = aPosition * 0.5 + 0.5;
}
`;

const GL_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uPrev;
uniform vec4 uMouse;
uniform vec4 uBrush;
out vec4 outColor;

vec2 closestOnSeg(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float l2 = dot(ab, ab);
  if (l2 <= 1e-8) return a;
  float t = clamp(dot(p - a, ab) / l2, 0.0, 1.0);
  return a + t * ab;
}

void main() {
  vec4 prevTex = texture(uPrev, vUv);
  float prev = prevTex.r * uBrush.z;
  if (uBrush.z <= 0.0) {
    prev = 0.0;
    prevTex.gb = vec2(0.5);
  }
  vec2 aspect = vec2(max(uBrush.w, 0.001), 1.0);
  vec2 closest = closestOnSeg(vUv * aspect, uMouse.zw * aspect, uMouse.xy * aspect) / aspect;
  float radius = max(uBrush.x, 1e-4);
  float fall = length((vUv - closest) * aspect) / radius;
  float brush = exp(-fall * fall) * uBrush.y;
  vec2 focal = (uMouse.xy + uMouse.zw) * 0.5;
  vec2 packed = clamp(focal - vUv, vec2(-0.25), vec2(0.25)) * 2.0 + 0.5;
  float w = prev + brush;
  if (w < 1e-4) {
    outColor = vec4(0.0, 0.5, 0.5, 1.0);
  } else {
    float intensity = 1.0 - (1.0 - clamp(prev, 0.0, 1.0)) * (1.0 - clamp(brush, 0.0, 1.0));
    vec2 blended = (prevTex.gb * prev + packed * brush) / w;
    outColor = vec4(intensity, blended, 1.0);
  }
}
`;

class Stroke {
  private hasPrev = false;
  private prevX = 0;
  private prevY = 0;
  /** Energy left in the path behind the pointer. Decays every frame. */
  private tail = 0;
  /** Energy under the pointer. Holds while the brush is down, then decays. */
  private head = 0;
  private stamp = 0;
  private lastStamp = -1;
  private lastRadius = -1;
  private settledFrames = 0;

  prepare(input: LensTrailInput): Stamp | null {
    if (input.canvasWidth < 2 || input.canvasHeight < 2) return null;
    const dt = Math.min(Math.max(input.dt, 0), 0.1);
    const fade = Math.exp(-FADE_RATE * dt);
    const jump = this.hasPrev ? Math.hypot(input.x - this.prevX, input.y - this.prevY) : 0;
    const broken = !this.hasPrev || jump > MAX_SEGMENT;
    const fromX = broken ? input.x : this.prevX;
    const fromY = broken ? input.y : this.prevY;
    const moved = this.hasPrev && jump > 0.0008 && jump <= MAX_SEGMENT;
    const stamp = Math.min(Math.max(input.stamp, 0), 1);
    const changing =
      moved ||
      Math.abs(stamp - this.lastStamp) > 0.01 ||
      Math.abs(input.radius - this.lastRadius) > 0.0005;
    this.settledFrames = changing ? 0 : this.settledFrames + 1;
    this.prevX = input.x;
    this.prevY = input.y;
    this.hasPrev = true;
    this.lastStamp = stamp;
    this.lastRadius = input.radius;
    this.stamp = stamp;
    this.tail *= fade;
    if (moved) this.tail = 1;
    this.head = stamp < 0.01 ? this.head * fade : 1;
    if (this.tail < 0.02) this.tail = 0;
    if (this.head < 0.02) this.head = 0;
    const size = trailSize(input.canvasWidth, input.canvasHeight);
    return {
      x: input.x,
      y: input.y,
      fromX,
      fromY,
      radius: Math.max(input.radius, 0),
      stamp,
      fade,
      aspect: input.canvasWidth / Math.max(input.canvasHeight, 1),
      width: size.width,
      height: size.height,
    };
  }

  hot() {
    // The resting circle can freeze on the last field. The path behind the
    // pointer has to keep fading, and so does the circle once the pointer leaves.
    if (this.stamp < 0.01) return this.tail > 0 || this.head > 0;
    return this.tail > 0 || this.settledFrames < 2;
  }
}

function createGpuTrail(session: ComputeSession): LensTrail {
  const stroke = new Stroke();
  const pipeline = session.createPipeline(COMPUTE_WGSL, "lens-trail");
  const uniforms = session.createUniformBuffer(32, "lens-trail-uni");
  const scratch = new Float32Array(8);
  let fields: ComputePingPong | null = null;
  let width = 0;
  let height = 0;
  let pending: Stamp | null = null;
  let destroyed = false;
  let fresh = true;

  const ensure = (w: number, h: number) => {
    if (fields && width === w && height === h) return;
    fields?.destroy();
    fields = session.createPingPong(w, h, "lens-trail", "rgba16float");
    width = w;
    height = h;
    fresh = true;
  };

  session.setOnCompute(({ encoder }) => {
    if (destroyed || !pending) return;
    ensure(pending.width, pending.height);
    if (!fields) return;
    const stamp = pending;
    scratch[0] = stamp.x;
    scratch[1] = stamp.y;
    scratch[2] = stamp.fromX;
    scratch[3] = stamp.fromY;
    scratch[4] = stamp.radius;
    scratch[5] = stamp.stamp;
    scratch[6] = fresh ? 0 : stamp.fade;
    fresh = false;
    scratch[7] = stamp.aspect;
    session.writeBuffer(uniforms, scratch);
    session.dispatch(encoder, pipeline, stamp.width, stamp.height, [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: fields.readView },
      { binding: 2, resource: fields.writeView },
    ], "lens-trail");
    fields.swap();
  });

  return {
    step(input) {
      if (destroyed) return;
      pending = stroke.prepare(input);
    },
    handle() {
      if (!fields) return null;
      return { texture: fields.read, view: fields.readView };
    },
    hot: () => stroke.hot(),
    destroy() {
      destroyed = true;
      fields?.destroy();
      fields = null;
      uniforms.destroy();
      session.destroy();
    },
  };
}

type GlTarget = {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
};

function createGlTrail(): LensTrail {
  const stroke = new Stroke();
  let gl: WebGL2RenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let buffer: WebGLBuffer | null = null;
  let targets: GlTarget[] = [];
  let read = 0;
  let width = 0;
  let height = 0;
  let uPrev: WebGLUniformLocation | null = null;
  let uMouse: WebGLUniformLocation | null = null;
  let uBrush: WebGLUniformLocation | null = null;
  let failed = false;
  let fresh = true;

  const dropTargets = () => {
    if (!gl) {
      targets = [];
      return;
    }
    for (const target of targets) {
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    targets = [];
    width = 0;
    height = 0;
  };

  const compile = (context: WebGL2RenderingContext) => {
    const vs = context.createShader(context.VERTEX_SHADER);
    const fs = context.createShader(context.FRAGMENT_SHADER);
    const prog = context.createProgram();
    if (!vs || !fs || !prog) return false;
    context.shaderSource(vs, GL_VS);
    context.shaderSource(fs, GL_FS);
    context.compileShader(vs);
    context.compileShader(fs);
    context.attachShader(prog, vs);
    context.attachShader(prog, fs);
    context.linkProgram(prog);
    context.deleteShader(vs);
    context.deleteShader(fs);
    if (!context.getProgramParameter(prog, context.LINK_STATUS)) {
      console.warn("[lens-trail]", context.getProgramInfoLog(prog));
      context.deleteProgram(prog);
      return false;
    }
    program = prog;
    uPrev = context.getUniformLocation(prog, "uPrev");
    uMouse = context.getUniformLocation(prog, "uMouse");
    uBrush = context.getUniformLocation(prog, "uBrush");
    vao = context.createVertexArray();
    buffer = context.createBuffer();
    if (!vao || !buffer) return false;
    context.bindVertexArray(vao);
    context.bindBuffer(context.ARRAY_BUFFER, buffer);
    context.bufferData(
      context.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      context.STATIC_DRAW,
    );
    context.enableVertexAttribArray(0);
    context.vertexAttribPointer(0, 2, context.FLOAT, false, 0, 0);
    context.bindVertexArray(null);
    context.bindBuffer(context.ARRAY_BUFFER, null);
    return true;
  };

  const makeTarget = (
    context: WebGL2RenderingContext,
    w: number,
    h: number,
    internalFormat: number,
    type: number,
  ): GlTarget | null => {
    const texture = context.createTexture();
    const framebuffer = context.createFramebuffer();
    if (!texture || !framebuffer) return null;
    context.bindTexture(context.TEXTURE_2D, texture);
    context.texImage2D(context.TEXTURE_2D, 0, internalFormat, w, h, 0, context.RGBA, type, null);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
    context.bindFramebuffer(context.FRAMEBUFFER, framebuffer);
    context.framebufferTexture2D(
      context.FRAMEBUFFER,
      context.COLOR_ATTACHMENT0,
      context.TEXTURE_2D,
      texture,
      0,
    );
    const ok = context.checkFramebufferStatus(context.FRAMEBUFFER) === context.FRAMEBUFFER_COMPLETE;
    if (ok) {
      context.clearColor(0, 0.5, 0.5, 1);
      context.clear(context.COLOR_BUFFER_BIT);
    }
    context.bindFramebuffer(context.FRAMEBUFFER, null);
    context.bindTexture(context.TEXTURE_2D, null);
    if (!ok) {
      context.deleteTexture(texture);
      context.deleteFramebuffer(framebuffer);
      return null;
    }
    return { texture, framebuffer };
  };

  const ensure = (context: WebGL2RenderingContext, w: number, h: number) => {
    if (gl !== context) {
      dropTargets();
      gl = context;
      failed = false;
      program = null;
    }
    if (failed) return false;
    if (!program && !compile(context)) {
      failed = true;
      return false;
    }
    if (targets.length === 2 && width === w && height === h) return true;
    dropTargets();
    gl = context;
    const floatTargets = context.getExtension("EXT_color_buffer_float") != null;
    const internal = floatTargets ? context.RGBA16F : context.RGBA8;
    const type = floatTargets ? context.HALF_FLOAT : context.UNSIGNED_BYTE;
    let a = makeTarget(context, w, h, internal, type);
    let b = makeTarget(context, w, h, internal, type);
    if ((!a || !b) && floatTargets) {
      a?.framebuffer && context.deleteFramebuffer(a.framebuffer);
      a?.texture && context.deleteTexture(a.texture);
      b?.framebuffer && context.deleteFramebuffer(b.framebuffer);
      b?.texture && context.deleteTexture(b.texture);
      a = makeTarget(context, w, h, context.RGBA8, context.UNSIGNED_BYTE);
      b = makeTarget(context, w, h, context.RGBA8, context.UNSIGNED_BYTE);
    }
    if (!a || !b) {
      failed = true;
      return false;
    }
    targets = [a, b];
    read = 0;
    width = w;
    height = h;
    fresh = true;
    return true;
  };

  const draw = (context: WebGL2RenderingContext, stamp: Stamp) => {
    if (!ensure(context, stamp.width, stamp.height) || !program || !vao) return;
    const source = targets[read]!;
    const dest = targets[1 - read]!;
    const prevFb = context.getParameter(context.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const prevVp = context.getParameter(context.VIEWPORT) as Int32Array;
    const prevProg = context.getParameter(context.CURRENT_PROGRAM) as WebGLProgram | null;
    const prevVao = context.getParameter(context.VERTEX_ARRAY_BINDING) as WebGLVertexArrayObject | null;
    const prevActive = context.getParameter(context.ACTIVE_TEXTURE) as number;
    const prevBlend = context.isEnabled(context.BLEND);
    const prevDepth = context.isEnabled(context.DEPTH_TEST);

    context.bindFramebuffer(context.FRAMEBUFFER, dest.framebuffer);
    context.viewport(0, 0, stamp.width, stamp.height);
    context.disable(context.BLEND);
    context.disable(context.DEPTH_TEST);
    context.useProgram(program);
    context.activeTexture(context.TEXTURE0);
    context.bindTexture(context.TEXTURE_2D, source.texture);
    if (uPrev) context.uniform1i(uPrev, 0);
    if (uMouse) context.uniform4f(uMouse, stamp.x, stamp.y, stamp.fromX, stamp.fromY);
    if (uBrush) context.uniform4f(uBrush, stamp.radius, stamp.stamp, fresh ? 0 : stamp.fade, stamp.aspect);
    fresh = false;
    context.bindVertexArray(vao);
    context.drawArrays(context.TRIANGLES, 0, 3);

    context.bindVertexArray(prevVao);
    context.useProgram(prevProg);
    context.bindTexture(context.TEXTURE_2D, null);
    context.bindFramebuffer(context.FRAMEBUFFER, prevFb);
    context.viewport(prevVp[0] ?? 0, prevVp[1] ?? 0, prevVp[2] ?? 1, prevVp[3] ?? 1);
    context.activeTexture(prevActive);
    if (prevBlend) context.enable(context.BLEND);
    if (prevDepth) context.enable(context.DEPTH_TEST);
    read = 1 - read;
  };

  return {
    step(input) {
      const stamp = stroke.prepare(input);
      if (!stamp || !input.gl) return;
      draw(input.gl, stamp);
    },
    handle() {
      const target = targets[read];
      if (!gl || !target) return null;
      return { texture: target.texture, gl };
    },
    hot: () => stroke.hot(),
    destroy() {
      dropTargets();
      if (gl && program) gl.deleteProgram(program);
      if (gl && vao) gl.deleteVertexArray(vao);
      if (gl && buffer) gl.deleteBuffer(buffer);
      program = null;
      vao = null;
      buffer = null;
      gl = null;
    },
  };
}

export function createLensTrail(): LensTrail {
  const engine = getDefaultEngine();
  if (engine?.backend === "webgpu") {
    const session = createCompute(engine);
    if (session) return createGpuTrail(session);
  }
  return createGlTrail();
}
