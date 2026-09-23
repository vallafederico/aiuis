---
title: Find
slug: find
section: uis
order: 5
component: find
tags:
  - jev
  - needle
  - exists
---

:::foreword
⌘F on this site matches meaning, and it answers by lighting up what was already written, or by staying dark.
:::

Find is the site-wide needle: ask for a passage in your own words, and the paragraphs that carry it light up, or nothing does.

The browser's find-in-page is one of the last honest search interfaces. It matches the exact string, shows every hit in place, and reports zero when there is none. Its one failure is literalness: change a word and the passage you remember stops existing. Find keeps that contract and loosens only the matching. The query is read for meaning, the answer is still a location in the text, and a miss is still a miss.

The mechanics are a closed set and two judgments. Every published paragraph has an ID. A Choice ranks those IDs against the query, and a Noul answers whether a covering passage exists at all. When it does, the source paragraph is highlighted, and the intensity of the highlight is the probability the judgment assigned. Nothing is written. The result is a place on the site, and the attribution is the highlight itself.

The exists gate is what makes silence possible. A ranking over a closed set always returns an order, so left alone it will always nominate a first hit, however poor. That is the failure mode of most semantic search: a confident answer where the honest answer is no. Here a weak `exists` keeps the page dark. A miss is silence, not a bogus first result.

This is the same primitive as the catalog search on the navigation: rank a closed set, and do not act when the judgment is weak. The two are one mechanism with two grains. The nav asks which piece; Find asks which passage. Neither invents a hit, and neither needs a results page, because the index and the article are already on screen. The order, or the highlight, is the result.

An earlier chapter, Look At, ran this needle inside a single chapter: one piece of text, one query, a focus field whose intensity is a number. Find absorbs it. Site-wide is the same primitive over a larger set, and the smaller version had no argument the larger one lacks. The one deferred part survives the merge: when the target is an image rather than a paragraph, a vision pass will score regions the way the Choice scores text. Generation stays out of the loop. If the reader asks for a sentence about a hit, a language model may write one, and it still cites the span the judgment picked. The needle finds; it does not speak first.

:::notes
Find runs over paragraph IDs in the published pieces collection; a Choice orders them and a Noul `exists` gates whether anything is shown.
An earlier chapter, Look At, covered the in-chapter version of this needle. Find replaced it.
:::
