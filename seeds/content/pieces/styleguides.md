---
title: Styleguides
slug: styleguides
section: foundations
order: 2
---

:::foreword
A styleguide used to describe screens someone drew. When the screen is composed at runtime, it has to govern screens nobody will ever draw.
:::

A styleguide for generated interface cannot be a catalog of screens, because the screens do not exist until a model composes them. It has to be a grammar: a small set of rules that makes good screens easy to produce and bad ones hard.

You might think a thorough enough component library solves this. Hand the model every card, chart and button, and it will assemble them. It will. Whether the assembly is right is the part a library never specified, because a designer used to supply it by looking.

Alexander (1977) described a pattern language as a grammar for building: each pattern names a problem, its resolution, and the larger and smaller patterns it connects to. Nobody draws the town. The language makes a good town more likely than a bad one. A guide for generated interface works the same way. It states relationships, not pixels: a figure is always introduced by its label, a view has at most one primary action, two things compared share an axis.

Sort every rule into one of three buckets. Fixed: the palette, the type families, the spacing scale, the voice. A generator may not touch these, so they live as tokens it reads, never as values it writes. Bounded: layout, density, the number of elements, the length of a caption. These get a range and a reason. Free: the content itself. The hard cases fall toward fixed. If you are unsure whether a generator should choose a colour, it should not.

Describe intent where you used to describe appearance. "Primary" is a token a model can obey, and a hex value is one it can misapply. A rule that says the key colour marks the one thing a reader can act on survives a layout nobody foresaw. A rule that says buttons are blue does not.

The states nobody drew are the ones a generator produces most. A static product has a handful of screens, each with an empty and an error variant sketched. A generated one also passes through partial, streaming, uncertain and failed. The guide has to name each and say how it looks: what a half-arrived chart shows, how an unsure figure differs from a sure one, what fills the space when generation fails. Silence is a state too. When the honest output is nothing, the guide should say what nothing looks like, so the generator does not fill it.

Voice rules are handed to the model as well as to people, and that forces them to be checkable. "Warm but precise" is advice for a writer. A rule against sentences over 40 words, against the em dash, and against any number the data did not return is one a model can follow and a script can verify. This site holds its own prose to such rules, and the content store rejects a draft that breaks them, whoever wrote it.

Generated images and charts need the same treatment as generated words. Ask for the palette in the prompt, then enforce it afterward: map each pixel to the nearest token colour, and set labels in the house type instead of trusting an image model's lettering. A request is a hope. A snap is a rule.

You cannot review a screen you never saw, so review the distribution. Generate a few dozen outputs for each kind of request and read them the way an editor reads proofs. Then turn what you catch into invariants a machine checks on every output: contrast above a floor, one primary action, every number traced to a source, every colour from the set. Lint catches violations. Sampling finds the rules you had not written yet.

The strongest objection is that a grammar this strict produces sameness. At the level it governs, it does, and that is the point. A reader should recognise the system in a screen they have never seen. Variety belongs to the content, where the generator has something to say.

What stays open is taste. Invariants can reject a bad screen. No rule yet written tells a generator which of two passing screens is better, and a designer still has to read samples to make that call.

:::notes
Alexander, Christopher, Sara Ishikawa, and Murray Silverstein. A Pattern Language. Oxford University Press, 1977.
:::
