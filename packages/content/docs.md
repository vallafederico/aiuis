# @local/content

Minimal file-based mdx CMS, shaped after astro's content collections:
`.md`/`.mdx` files + frontmatter + components inside the markdown. No server,
no database — content is part of the bundle, validated at build time.

## Wiring (already done in apps/web)

**1. Vite plugin** — compiles `.md`/`.mdx` to solid components
(`app.config.ts`):

```ts
import { contentPlugin } from "@local/content/vite";

export default defineConfig({
  extensions: ["mdx", "md"],
  vite: { plugins: [contentPlugin()] },
});
```

**2. Collections** — one folder per collection under `src/content/`, schema in
`src/content/config.ts`:

```ts
import { defineCollection, z } from "@local/content";

export const collections = {
  pages: defineCollection({}),
  posts: defineCollection({
    schema: z.object({
      date: z.coerce.date(),
      tags: z.array(z.string()).default([]),
    }),
  }),
};
```

**3. Index** — the globs must live next to the content
(`src/content/index.ts`):

```ts
import { createContent } from "@local/content";
import { collections } from "./config";

export const { getCollection, getEntry, getPage, getLlms } = createContent(collections, {
  frontmatter: import.meta.glob("./**/*.{md,mdx}", { eager: true, import: "frontmatter" }),
  modules: import.meta.glob("./**/*.{md,mdx}"),
  llms: import.meta.glob(["./llms.txt", "./**/*.llms.txt"], { eager: true, query: "?raw", import: "default" }),
});
```

**4. Provider** — mount the content api at the app root (`app.tsx`) so
`<Slot>` can resolve pages anywhere; `components` go into the mdx scope of
every document a slot renders:

```tsx
import { ContentProvider } from "@local/content/solid";
import * as content from "~/content";

<ContentProvider content={content} components={{ Marker }}>
  {/* app */}
</ContentProvider>
```

## Base metadata

Every file — any collection — carries page metadata by default; collection
schemas only add to it (or override a field):

```yaml
---
title: Hello          # required
description: One-liner for meta/og    # optional
image:                # og image, optional
  src: /og/hello.png
  alt: Hello
draft: true           # excluded from prod page routing, default false
updated: 2026-07-23   # last content change — sitemap lastmod, optional
llms: ./hello.llms.txt  # pair llms.txt overriding the base one, optional
---
```

`entry.data` is the validated frontmatter (base + collection fields); invalid
frontmatter throws at module init (build/dev time), naming the file and the
failing fields. `<PageMeta data={entry.data} />` renders the head tags —
title, description, og:\* — from it.

## Pages

`pages` is a reserved collection: file path = url path.

| file                        | url              |
| --------------------------- | ---------------- |
| `pages/index.mdx`           | `/`              |
| `pages/team.mdx`            | `/team`          |
| `pages/legal/imprint.mdx`   | `/legal/imprint` |
| `pages/legal/index.mdx`     | `/legal`         |

`getPage("/team")` resolves a pathname (or bare slug) to the entry — drafts
only resolve in dev. `pagePath(entry.slug)` goes the other way for building
links. The catch-all route (`routes/[...404].tsx`) renders any page without a
route file using the default layout, so a cms-only page needs nothing but the
`.mdx` file.

## Slot — mixing cms documents and custom pages

Give a custom-developed route and a cms document the same name and connect
them with `<Slot />`:

```tsx
// routes/about.tsx ← content/pages/about.mdx
import { Slot } from "@local/content/solid";

export default function About() {
  return (
    <div>
      <CustomHero />
      <Slot />          {/* head metadata + mdx body from the cms */}
      <CustomFooter />
    </div>
  );
}
```

The slot resolves the current pathname through `getPage`; the document's
frontmatter becomes the page's head. Props:

- `name` — target a page explicitly instead of the current path
  (`<Slot name="legal/imprint" />`)
- `children` — fallback when no document matches
- `meta={false}` — body only, e.g. a second slot on the same page
- `components` — extra mdx-scope components, merged over the provider's

Route files always win over cms pages: the file router matches them first,
and the catch-all only sees paths without a route. So a page can start as
pure markdown, then graduate to a custom `.tsx` with a `<Slot />` — the
content and url never move.

## llms.txt

Every entry can pair with an llm-friendly document. The main md file links
its pair in the frontmatter — relative to the file (`llms: ./about.llms.txt`)
or to the content root (`llms: pages/shared.llms.txt`); a dead link fails the
build. `getLlms(entry)` returns the pair's text, falling back to the base
`src/content/llms.txt`; `getLlms()` returns the base itself.

Serving is app-side middleware (`src/middleware.ts` + `middleware` in
`app.config.ts`): `/llms.txt` → base, `/<page>/llms.txt` → pair or base,
urls without a cms entry → 404.

## Sitemap

App-side too — `routes/sitemap.xml.ts` builds the url set from the
collections (`pagePath(page.slug)` for pages, the app's own url scheme for
other collections), with `data.updated` as lastmod.

## Querying

Synchronous, isomorphic, typed by the collection schema:

```ts
const posts = getCollection("posts", (p) => !p.data.draft);
const post = getEntry("posts", "hello-world"); // CollectionEntry | undefined
const about = getPage("/about");               // pages by url path
```

## Rendering

```tsx
import { MDXContent, PageMeta } from "@local/content/solid";

<PageMeta data={post.data} />
<MDXContent entry={post} components={{ Marker }} />
```

The body is lazy-loaded (code-split per document). `components` injects solid
components into the mdx scope — usable without an import — and can override
html tags (`h2`, `a`, `code`, …). Documents can also `import` components
directly, astro-style, and `frontmatter` is in scope inside the file:
`{frontmatter.title}`.

## Adding a collection

1. Create `src/content/<name>/`, drop `.md`/`.mdx` files in it
2. Add `<name>: defineCollection({ schema })` to `src/content/config.ts`

Nothing else — the globs pick the folder up by name.
