---
_kind: skill
name: brand-voice
audience: [content-agent, human]
attach: global
mode: always
description: "Scientific essay voice for aiu.is: direct claims, concrete scenes and exact numbers, one governing image, philosophy and science citations, no em dashes, chapter length"
lint:
  banned_terms: ["synergy", "cutting-edge", "next-generation", "best-in-class", "game-changer", "seamless", "leverage", "utilize", "—"]
  max_sentence_words: 40
---
# Brand voice

## The short version

Scientific essay. The first sentence is the claim. Argue it, and cite the work it depends on. The reader is technical. A missing source and a padded paragraph both show.

## Tone

Write a short essay in the manner of philosophy or the sciences: claim, reason, source, limit.

A design judgment the author is making can stand as theirs. A claim about perception, attention, memory, trust, language, or what a system is doing needs a source. Reach first for primary work in philosophy and the sciences: philosophy of mind, phenomenology, epistemology, cognitive science, perception, attention. Use HCI or design research when the claim is about an interface. Prefer that work over commentary, vendor posts, and secondary roundups.

Do not perform excitement. Do not perform neutrality. If the evidence is partial, say what it supports and what it does not. If a decision was close, say so.

Do not announce what you are about to say. No "this chapter explores", no "we will discuss". Cut the preamble. Do not close by restating the opening.

## Craft

Technical and warm at once: an argument a builder can check, written with a writer's ear. The moves below are the ones that do that.

**Open on something the reader can see.** A scene, a sound on screen, an exact number. Not an abstraction. "A spinner turns for eleven seconds" before "latency erodes trust". A run of three concrete openers is allowed once, at the start.

> One grey spinner. One "thinking…" that never says about what. One answer that arrives already sure of itself. Each is a small promise the interface cannot keep.

**Correct a belief.** Name what the reader probably assumes, then what is true. "You might think a faster model fixes this. It moves the wait; it does not remove it."

**Give the piece one image and keep it.** Name a single governing figure early (a coat of paint, a cow path, a lens) and return to it when the argument turns. One image per piece. Two start to argue with each other.

**Find the reframing number.** Show where the time, attention, or error actually goes, in real units, with its source. Build it in one full sentence, then land it in a short one.

> Hammer (1990) followed an insurance application through 22 days of process that held 17 minutes of work. Make every step twice as fast and you save eight minutes.

**Let rhythm carry the claim.** A long sentence that accumulates detail (still under 40 words), then a short one that states what it means. Lists of three, not four. Vary paragraph openings.

**Sort before you explain.** When a system has kinds, name the buckets, give each a test and one example, and say which way the hard cases fall. A taxonomy is an argument the reader can apply.

**Show one worked case.** Before and after, as real steps, not adjectives. Count what disappeared.

**State the objection in the reader's words, then answer it.** One per piece, the strongest one.

**Contrast the small with the large.** A single token, a single frame, a single hover, and what it carries. The detail earns the scale.

**Let the abstract act, if the claim survives it.** "The spinner asks for patience it has not earned" is fine when the essay then says why. Do not personify a model to make it sound like it wants things.

**One dry aside per piece, at most.** Wit that clarifies. No sarcasm at the reader, no profanity, no "are you kidding me".

**End on something the reader can do, or on what the claim leaves open.**

Not borrowed from the essays that taught these moves: hype, predictions of doom, sales calls to action, vendor comparisons, and first-person authority claims ("I've spoken to 300 CEOs"). The evidence carries the authority here.

## Punctuation

Do not use the em dash (U+2014). It is rejected on write. Use a period, a comma, a colon, or parentheses.

Do not use an en dash as sentence punctuation. Write a range with "to": 450 to 700 words.

## Terminology

Use "agent" once the context is established. "AI agent" adds nothing after that.

Use "markdown" (lowercase) as a noun and adjective.

Use "worker" (lowercase) for a Cloudflare Worker in running context. "Workers" (capital) for the product.

Prefer concrete nouns: "the D1 migration", not "the data layer change".

## Citations

Name the author and the year in the sentence.

> Clark and Chalmers (1998) argue that a notebook can belong to a cognitive system when it is reliably consulted. A context panel the model actually reads meets that condition. A panel the model ignores does not.

Put the reference list in the `:::notes` block at the end. One work per line, enough to find it: author, title, year, and the journal or publisher when the title is ambiguous. Do not add a Sources heading. The notes block is the list.

> Clark, Andy, and David Chalmers. The Extended Mind. Analysis, 1998.

Quote only when the wording is the point, and keep it short. Paraphrase otherwise, and still cite.

Do not invent a source, a page, a quotation, a sample size, or a finding. If you cannot name the work, drop the claim.

Do not stack citations to look thorough. One right source is enough.

## Length

Chapters (`pieces`) are set large and read in one sitting. 450 to 700 words. Under 450 the piece is still an abstract. Over 700 without a structural reason, split it.

The first paragraph is the excerpt. One or two sentences, able to stand alone. On a piece with a `component`, one sentence: that opening is the only prose beside the prototype.

Credits and other apparatus stay short. They are not essays.

Posts: 300 to 1500 words. Over 1500 without a clear reason, make it two posts.

Paragraphs: 2 to 4 sentences. One sentence is fine when it carries the claim. Sentences stay under 40 words.

## What to avoid

A conclusion that begins "In this chapter" or "In this post, I covered". End on the last claim, or on what that claim leaves open.

Vague difficulty ("this was tricky", "surprisingly complex") without the specific hard part.

Marketing language. The banned list is enforced.
