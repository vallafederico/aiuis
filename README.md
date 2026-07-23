# aiuis

Solid Start monorepo (from the turbo-solid template, sanity/shopify/next/astro
stripped out). Content is file-based mdx, webgl is the native
[`ssscript-webgl`](../LIBS/ssscript-webgl) engine, pnpm-linked from
`workspace/LIBS`.

```bash
pnpm install
pnpm web        # dev (turbo dev --filter=web)
pnpm build      # build everything
pnpm msdf       # fonts + svgs → msdf atlases (public/msdf)
pnpm optimise   # images → webp/avif, fonts → woff2
```

## Layout

| Path | What |
|------|------|
| `apps/web` | solid start app |
| `packages/content` | mdx CMS — collections, frontmatter schemas, rendering ([docs](packages/content/docs.md)) |
| `packages/router` | `@acme/router` — page transitions |
| `packages/tailwind`, `packages/config` | shared theme + config |
| `scripts/msdf` | fonts/svgs → msdf textures ([docs](scripts/msdf/README.md)) |
| `scripts/optimise` | image/font optimisers |
| `config.ts` | script config: `OPTIMISE`, `MSDF` |

## Content (`@local/content`)

`.md`/`.mdx` files in `apps/web/src/content/<collection>/`, zod-validated
frontmatter, components inside the markdown — astro-style. Demo at
`/_/content`. See `packages/content/docs.md`.

## WebGL (`@ssscript/webgl`)

- `<Canvas />` (app.tsx) owns the engine — one fullscreen fixed canvas
- `<GlItem />` — DOM-tracked quads with custom shaders (wgsl-ish or raw
  `#version 300 es` glsl)
- `msdf-text.ts` — draws text on the background plane from an msdf atlas;
  demo at `/_/webgl`
- editing the lib in `workspace/LIBS/ssscript-webgl` (`pnpm dev` there)
  hard-reloads this app via `vite-plugin-gl-reload`

## Fonts & palette

- **alte-haas** (AlteHaasGroteskBold) — the site font, everything DOM
- **garara** (variable, wght 0–20) — webgl-only, rendered from its msdf atlas
- ttf sources in `apps/web/src/assets/fonts/` → `pnpm optimise` emits woff2,
  `pnpm msdf` emits atlases
- palette hangs off `--color-key` (full blue) in `apps/web/src/app.css`;
  `--color-paper` is derived from it — swap key to re-skin
