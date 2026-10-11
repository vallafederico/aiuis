---
_kind: skill
name: customize-studio
audience: [dev-agent, local, human]
attach: global
mode: on-demand
description: "Change how this project's Studio looks and is organised (colours for light and dark mode, font, radius, density, top tabs and structure, field labels, field widgets) without breaking its consistency or contrast"
---
# Customise Studio

Use this when someone asks to change how their Studio looks or is laid out: "make Studio match our brand", "fix the dark mode colours", "rename Posts to Articles", "hide the Knowledge tab", "add a Products group", "add a tab for low-stock products", "make the body field bigger".

Studio is a shared app. A project changes it through a few settings, and Studio derives everything else from them: hover fills, surfaces, status chips, focus rings, every size. That is what keeps a customised Studio readable and consistent. Your job is to set those few settings well, never to work around them.

**Theming is a developer task.** The theme (colours, font, size, radius, density) lives in `studio/theme.yaml` in the site's repository and reaches the project only through `content push` with an admin token. Studio cannot change it: its Settings view shows the theme read-only, editor sessions are refused, and the chat inside Studio has no tool for it. Never try to change the theme through Studio or by asking the in-Studio chat to do it. If you are that chat, tell the person a developer has to change `studio/theme.yaml` in the repository and push it, and offer to draft the change for them to hand over.

Navigation, panes, actions, field labels and field widgets are different: editors and their agents may change `studio/config.yaml`, `studio/widgets.yaml` and the labels in the schema, with an ordinary project token as well as an admin one. The same checks apply to those writes.

Every Studio has a light and a dark mode, and every editor sees whichever their system or their Studio setting picks. A project cannot turn either off. If the theme gives one palette, Studio derives the other from it, so every colour change shows up in both modes.

## What you can change today

| File (in the repo, under the `content/` folder you push) | What it changes |
| --- | --- |
| `studio/theme.yaml` (developer only, admin token) | 6 colours, optionally a separate dark palette, the font (`inter` or `ibm-plex-sans`), the base size, the corner radius, the density |
| `studio/config.yaml` | Studio title, the top tabs (`tools:`: order, labels, icons, hidden, custom tools) and structure (`structure:`: sections of collections, singletons, filtered lists, nested groups), document panes and actions, preview |
| `schema/<collection>.md`, `schema/slices/<type>.md` | Field labels (`title`) and help text (`description`) in the Studio form; form tabs (`groups`, and `group` on fields) and collapsible sections (`fieldsets`, and `fieldset` on fields) |
| `studio/widgets.yaml` | Which built-in editor a field uses: `large-text`, `image-only` |

Nothing else is customisable. There is no custom CSS, no custom font upload, no way to turn off light or dark mode and no way to restyle one button. If the person asks for one of those, say it is not supported and offer the closest setting.

**Custom widget modules are off limits.** `widgets.yaml` can point a field at a JavaScript module (`module:<id>` plus a `modules:` entry). Those modules run inside Studio with the signed-in editor's session and can do anything that editor can. Until Studio runs them sandboxed, do not write, upload or register one, even if asked. Only the built-in `module:color-accent` is fine. Tell the person why if they ask.

## Rules

1. **Change tokens, nothing else.** The colour keys are `bg` (page), `panel` (cards, inputs, menus), `text`, `muted` (hints and meta), `accent` (focus ring and links), `err` (errors). Any other key is rejected on push.
2. **Flat surfaces, no borders for decoration.** Studio separates areas with surface steps (`bg` against `panel`) and spacing. Cards, buttons and panels are flat; only menus, dialogs and other floating layers get a soft shadow, and nothing is embossed, inset or made to look pressed. Borders stay on inputs, focus rings and table rows, mixed from `text` as near-invisible hairlines; they are not made stronger for emphasis, and focus shows with the focus ring. There is no border colour to set. Older theme files may still have a `line` key: Studio ignores it, so remove it when you edit the file. If the person wants areas to stand apart more, or asks for shadows or depth on cards, increase the difference between `bg` and `panel`; Studio stays flat by design.
3. **Opaque hex only.** `"#1f2937"` or `"#fff"`. No names, `rgb()`, transparency or `var()`: Studio mixes these colours together, and translucent inputs give unpredictable mixes.
4. **Contrast must pass in both modes**, in `colors:` and again in `dark:` (or in the palette Studio derives, when there is no `dark:`):
   - `text` and `muted` on `bg` and on `panel`: at least 4.5:1.
   - `err` on `bg` and on `panel`: at least 4.5:1.
   - `accent` on `bg` and on `panel`: at least 3:1 (it draws the focus ring).
   - `bg` and `panel` both light or both dark.
   Compute the ratios (the WCAG formula) for both modes and show them to the person before pushing. If a brand colour fails, keep its hue and darken it (light palette) or lighten it (dark palette) until it passes, and say so. A brand colour that only works on light (a navy accent, say) needs its own lighter value in `dark:`; otherwise Studio lightens it for dark mode on its own.
5. **Keep the type scale.** `font.size` is the base that every size steps from. Use a whole number from 12 to 16; 14 is the default. Do not try to set individual sizes, weights, line heights or letter-spacing.
6. **Keep spacing on the scale.** `density` (`compact`, `comfortable`, `spacious`) is the only spacing control. Compact suits editors who work in long lists; comfortable suits everyone else.
7. **Radius** is a whole number of px from 0 to 12. Studio derives the smaller and larger corners from it.
8. **Only the fonts Studio ships.** `font.family` is one of two names: `inter` (the default) or `ibm-plex-sans`. Functional values (slugs, IDs, dates, counts, key caps) and code always use Geist Mono. Studio loads these fonts itself and no others; any other value, the brand's font included, is rejected on push.
9. **Navigation names things that exist.** Every structure item's `collection` is in the schema, a singleton's `slug` is the document it should open, and icons are lucide names Studio bundles (see "Tools and structure" below). Tools are built-ins (`structure`, `context`, `media`, `queries`, `analytics`, `guide`, `settings`) or custom tools of kind `structure`, `query` or `link`; there is no custom-code tool.
10. **Labels and help text are short.** Sentence case, one line, says what goes in the field: `title: SEO title`, `description: Shown in search results. Keep it under 60 characters.`
11. **Groups split long forms, nothing more.** Add `groups` when a form has more than about eight fields that fall into clear sets (content, contact, SEO). Three or four groups, short titles, one `default: true` (usually content). A field may name several groups (`group: [content, seo]`); fields with no group still show under "All fields". Every name a field uses must be declared in `groups` or `fieldsets`, or the push fails. `fieldsets` (`{ name, title, collapsed }`) group a few related fields inside a tab; an `object` field takes its own `fieldsets` for its nested fields. Groups and fieldsets change the form only, never the data.
12. **One change at a time,** shown to the person before it is pushed.

## Tools and structure

Studio is laid out like Sanity Studio: a slim rail on the left, and one panel with a row of top tabs (Structure, Knowledge, Media, Queries, Guide, Settings and any custom tools) over the open tool. The Structure tab shows the structure: groups of collections separated by dividers, opening panes to the right and documents as drawers. The tabs and the structure both come from `studio/config.yaml`, which editors may change.

- `tools:` lists tabs in the order they should appear. A built-in is its id (`- media`) or a mapping with `id` and any of `title` (rename), `icon`, `hidden: true`. Built-ins left out follow in their default order, so to remove one, set `hidden: true`; do not just leave it out. Ids never change (`context` is labelled Knowledge); only `title` renames.
- Custom tools need `id` (lowercase, digits, `-`; not a built-in's id), `kind` and `title`:
  - `kind: structure` with its own `structure:` (a desk for one team, say);
  - `kind: query` with `query:`, a GROQ query whose results include `_type` and `"slug": slug.current` (or set `collection:`). Try the query in Queries first;
  - `kind: link` with an `https://` `url:`. It opens in a new tab.
  There is no tool that runs custom code: such code would run inside Studio with the editor's session. If asked, say so and offer a `query` or `link` tool instead.
- `structure:` is a list of groups (`title` optional, `items`), separated by dividers in the Structure pane. Items: a collection name (`- products`), `type: singleton` (`collection`, `slug`: one fixed document such as site settings), `type: list` (`collection`, `title`, `filter:` with `status: draft|published|archived`, `q`, or a GROQ `where`), `type: group` (`title`, `items`) for a nested set that opens its own pane, `type: query` (`title`, `query`, like a query tool but listed in the pane, results opening beside it), or `type: link` (`title`, `url`, opened in a new tab). Put saved queries and external links in the structure when they are shortcuts rather than whole tools. Every item takes `title`, `icon`, `description` (tooltip) and `hidden: true`; collection and list items take `badge: drafts`. `- divider` draws a hairline and `- section: Name` (optionally `collapsible: true`) heads the items after it; neither opens anything. Ids come from the collection or title and must be unique within a group's pane.
- Collection and list items shape their list with `preview` (merged over the schema's), `layout: rows|table|cards`, `columns: [title, author, updated]` (field paths, or `{ field, title, width }`), `orderable: true` and `new:` (`{ initial: { field: value } }`, or a list of `{ title, initial }` for a menu on "+"). `orderable` needs `order: { type: number }` in the collection's schema; it stores each document's position in that field, so moves are ordinary revisions and survive `content push`. Template values, columns and preview paths are checked against the schema on push.
- A schema's `preview:` sets how its documents show everywhere in Studio: `title` and `subtitle`/`description` are a field path or a template (`"{author.title} · {date}"`, references one level deep), `media` an asset field or an icon, `badges` a list of paths such as `[status, section]`. Slice schemas take it too, to label slices in the page editor. Without it Studio uses the title, the collection and updated date, the first asset field and the status.
- Icons are lucide names Studio bundles (such as `package`, `tags`, `file-text`, `settings`, `megaphone`, `newspaper`, `users`, `shopping-bag`; the full list is in `apps/cms/docs/studio.md`, Icons), an emoji (`"📰"`), or an image already uploaded to the media library (`assets/…/name.svg` or `.png`; SVGs are sanitised on upload). An unknown name or a missing image is rejected on push, with the closest icon name.
- Without `structure:`, Studio lists every collection, settings-like ones last. Older files with `nav:` still work; when you edit one, move it to `tools:` and `structure:` and remove `nav:`.

Example, for a shop:

```yaml
_kind: studio
title: Acme Shop
tools:
  - structure
  - { id: low-stock, kind: query, title: Low stock, icon: alert-triangle, query: '*[_type == "product" && stock < 5] { _type, title, "slug": slug.current }' }
  - { id: media, title: Assets }
  - { id: context, hidden: true }
  - { id: storefront, kind: link, title: Storefront, url: "https://shop.example.com" }
structure:
  - title: Shop
    items:
      - { type: collection, collection: products, title: Products, icon: package }
      - { type: collection, collection: categories, title: Categories, icon: tags }
      - { type: list, collection: products, title: Products in draft, icon: file-pen, filter: { status: draft } }
  - title: Website
    items:
      - { type: collection, collection: pages, title: Pages, icon: file-text }
      - { type: singleton, collection: settings, slug: site, title: Site settings, icon: settings }
```

## Make a change

1. **Read what is there.** Call `get_studio_config` (MCP) and read the `theme`, `config` and `widgets` it returns. Check whether the repo already has `content/studio/*.yaml`; if it does, edit those files, they are the source of truth. Note whether `theme` has a `dark` palette; if it has none, Studio derives dark mode from `colors`.
2. **Write the change** in the repository, in `content/studio/theme.yaml`, `config.yaml` or `widgets.yaml` (create the file from the example below if missing; keep the `_kind` line). Labels and help text go in `content/schema/<collection>.md`.
3. **Check it yourself** against the rules above: known keys only, no `line`, hex colours, a contrast table for light and for dark, `inter` or `ibm-plex-sans`, sizes in range, collections exist (`list_collections`), singleton documents exist or should be created, query tools return `_type` and `slug`.
4. **Show the person** the diff and, for colours, the contrast tables for both modes. **Wait for a yes.**
5. **Dry run:**

   ```sh
   content push content --dry-run
   ```

   Expected: `studio/theme.yaml: would be validated and written (unchanged ones are no-ops)` for each studio file, and `dry run: nothing was written` last. The dry run does not check studio files yet; the CMS checks them on the real push, and step 3 is your check before that.
6. **Push:**

   ```sh
   content push content
   ```

   Expected: `studio/theme.yaml: updated` (or `unchanged`), and a `warning:` line for anything Studio accepted but would rather you changed (an old `line` key, a colour it had to adjust for the derived mode). A `validation_fail` error means the file was rejected: contrast, an unknown key, a font Studio does not ship, a custom widget module. Read the message, fix, repeat from step 3. A `capability_denied` message means the token cannot write that file: `theme.yaml` always needs an admin token, so ask an organisation admin to run `content project token --admin` or push for you.

Example `content/studio/theme.yaml`:

```yaml
_kind: studio-theme
colors:
  bg: "#fafafa"
  panel: "#ffffff"
  text: "#171717"
  muted: "#6b6b6b"
  accent: "#4d7ef7"
  err: "#b91c1c"
dark:
  bg: "#171717"
  panel: "#252525"
  text: "#f5f5f5"
  muted: "#a3a3a3"
  accent: "#6b97ff"
  err: "#fca5a5"
font:
  family: inter
  size: 14
radius: 6
density: comfortable
```

## Verify

1. Call `get_studio_config` again and compare with what you wrote. A key you set that is not in the result was ignored: it was misspelt or is not a setting.
2. Ask the person to reload Studio (`https://<slug>.content.software/studio`) and look, in light mode and again in dark mode, at: the document list, one document form, a dialog (the asset picker), an error or empty state, and the phone layout. Switch modes with the system setting, or Studio's own appearance switch where it has one. Both modes always ship, so a change that only looks right in one is not done.
3. Ask whether every piece of text is easy to read and every focused control shows its ring when they press Tab.
4. Studio's Settings view shows the theme as Studio sees it, read-only: each colour's light and dark value, marked "derived" where Studio derived it. Use it to confirm the push landed.

## Undo

Revert the file in the repo and run `content push content` again. To go back to Studio's defaults, push a theme with only `_kind: studio-theme`.
