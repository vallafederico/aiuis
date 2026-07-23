# msdf

Converts fonts, svgs and pngs into SDF/MSDF textures for the webgl layer —
the offline half of a troika-three-text-style sdf text pipeline. Config lives
in the root `config.ts` (`MSDF`), same pattern as `scripts/optimise`.

```bash
pnpm msdf          # from the repo root (turbo)
bun run index.ts   # from this folder
```

## fonts

Drop `.ttf`/`.otf` files into `apps/web/src/assets/fonts/`. Each becomes:

- `<name>.png` — glyph atlas (pages: `<name>.0.png`, … if it overflows)
- `<name>.json` — bmfont metrics (glyph uv/advance/kerning), the format
  msdf text renderers consume

`fieldType` defaults to `"sdf"` (single channel): the msdfgen vendored in
msdf-bmfont-xml is old — its msdf edge coloring beads/notches on thin or
noisy outlines (it mangled both project fonts). Plain sdf only rounds sharp
corners slightly at extreme magnification. Raise `fontSize` for hairline
faces (Garara ships at 256).

Note: the deployed woff/woff2 in `public/fonts` can't be used as sources —
msdf generation needs the ttf/otf originals.

## svgs

Drop `.svg` files into `apps/web/src/assets/msdf/svg/` — any svg works
(multi-path included). The vector is rasterized with sharp at `size`, then
distance-transformed (Felzenszwalb EDT) into a single-channel sdf:
`<name>.png` + a `<name>.json` sidecar (`{ type, width, height, spread }`).

## pngs

Drop `.png` files (alpha = shape) into `apps/web/src/assets/msdf/png/`.
Same output as svgs, at the source resolution.

## decoding in a shader

```glsl
float median(vec3 c) { return max(min(c.r, c.g), min(c.b, c.r)); }

float sd = median(texture(uTexture, uv).rgb) - 0.5; // sdf: r == median
// analytic aa — avoid fwidth() in divergent flow (garbage on some gpus)
float screenSd = sd * uPxRange * texelToScreenScale;
float alpha = clamp(screenSd + 0.5, 0.0, 1.0);
```

`uPxRange` is `distanceRange` (fonts) / `spread` (svgs & pngs, × 2). See
`apps/web/src/components/webgl/msdf-text.ts` and `sdf-texture.ts` for the
live versions.
