import { compileShader, convertGlslFragmentToWgsl } from "shooosh/compiler";
import type { FullscreenPlaneShaders } from "shooosh";

/** WGSL `fn fsMain` → both backends. */
export function wgslShaders(source: string): FullscreenPlaneShaders {
  return compileShader(source);
}

/**
 * GLSL 300 es `void main` → both backends. If the converter rejects a
 * generated shader (baked glyph arrays, etc.), WebGL2 still runs it.
 */
export function glslShaders(source: string): FullscreenPlaneShaders {
  try {
    return { fragment: convertGlslFragmentToWgsl(source), fragmentGlsl: source };
  } catch (error) {
    console.warn("[shooosh] GLSL→WGSL failed; WebGL2-only for this item", error);
    return { fragment: source, fragmentGlsl: source };
  }
}
