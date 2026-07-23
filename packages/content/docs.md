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
  posts: defineCollection({
    schema: z.object({
      title: z.string(),
      date: z.coerce.date(),
      draft: z.boolean().default(false),
    }),
  }),
};
```

**3. Index** — the globs must live next to the content
(`src/content/index.ts`):

```ts
import { createContent } from "@local/content";
import { collections } from "./config";

export const { getCollection, getEntry } = createContent(collections, {
  frontmatter: import.meta.glob("./**/*.{md,mdx}", { eager: true, import: "frontmatter" }),
  modules: import.meta.glob("./**/*.{md,mdx}"),
});
```

## Querying

Synchronous, isomorphic, typed by the collection schema:

```ts
const posts = getCollection("posts", (p) => !p.data.draft);
const post = getEntry("posts", "hello-world"); // CollectionEntry | undefined
```

`entry.data` is the validated frontmatter; invalid frontmatter throws at
module init (build/dev time), naming the file and the failing fields.

## Rendering

```tsx
import { MDXContent } from "@local/content/solid";

<MDXContent entry={post} components={{ Marker }} />
```

The body is lazy-loaded (code-split per post). `components` injects solid
components into the mdx scope — usable in posts without an import — and can
override html tags (`h2`, `a`, `code`, …). Posts can also `import` components
directly, astro-style:

```mdx
---
title: Hello
date: 2026-07-22
---

import Callout from "~/components/content/Callout";

<Callout kind="info">Components inside markdown.</Callout>
```

`frontmatter` is in scope inside the file: `{frontmatter.title}`.

## Adding a collection

1. Create `src/content/<name>/`, drop `.md`/`.mdx` files in it
2. Add `<name>: defineCollection({ schema })` to `src/content/config.ts`

Nothing else — the globs pick the folder up by name.
