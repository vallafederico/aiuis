---
title: Plain markdown works too
description: same collection, .md extension, zero jsx
date: 2026-07-20
---

Nothing fancy here — a `.md` file goes through the same pipeline, same
frontmatter validation, same lazy rendering. Use it when a post is just text.

- frontmatter → `entry.data`, typed by the collection schema
- body → compiled once, loaded on demand
