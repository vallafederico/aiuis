---
_kind: skill
name: writing-posts
audience: [content-agent]
attach: "collection:posts"
mode: always
description: "Post-writing workflow for the posts collection — context checks, deduplication, excerpt discipline, tagging, and revision habits"
---
# Writing posts — workflow

Call `get_context` before starting. The schema, taxonomy, and brand-voice skill assemble in one call — do not skip this step and guess at constraints.

Query existing posts before drafting a new one. A title that sounds original may duplicate a post that already covers the topic from a different angle. Read two or three recent posts to calibrate tone.

The excerpt is the first paragraph. Write it to stand alone — readers on index pages see only this paragraph. If it requires context from what follows, rewrite it until it does not.

Tags follow the taxonomy guidance from `get_context`. Do not invent new terms without a genuine gap; propose only when none of the existing terms accurately describes the post and more than one future post would use the new term.

Drafts stay drafts. Do not call `publish` — that step belongs to the human review path. Submit the draft and let the review inbox catch it.

When revising, use `edit_doc` with `str_replace` edits rather than rewriting the full body. Surgical edits produce readable diffs. A full-body replace makes the revision history useless.
