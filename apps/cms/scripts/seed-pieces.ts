import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const cmsDir = join(__dirname, "..")

// Parse .dev.vars for CMS_DEV_SECRET
function readDevSecret(): string {
  try {
    const devVars = readFileSync(join(cmsDir, ".dev.vars"), "utf-8")
    for (const line of devVars.split("\n")) {
      const match = line.match(/^CMS_DEV_SECRET=(.+)$/)
      if (match) return match[1].trim()
    }
  } catch {}
  return process.env.CMS_DEV_SECRET ?? ""
}

const PIECES = [
  {
    collection: "pieces",
    frontmatter: { title: "Foreword", slug: "foreword", section: "preface", order: 1 },
    body: `:::foreword
Why design for a system that thinks back — and what that changes about the interface between you and it.
:::

This thesis investigates what it means to design interfaces when the system on the other side thinks—or performs enough of the appearance of thinking that the distinction stops mattering to the person using it. That shift changes more than the visual language of a product; it changes the contract between interface and user, the pacing of interaction, and the kind of trust a screen is asking for. Buttons and forms assumed a system that was fast, deterministic, and silent about its own uncertainty. A model-backed interface can be none of those things, and pretending otherwise is where most of the current generation of AI products goes wrong.

The pieces collected here are neither a style guide nor a manifesto—they are working notes from a practice that is still figuring itself out. Each chapter began as a specific design problem encountered in a specific prototype: a chatbot that felt dishonest about what it knew, a navigation system that had to double as model context, an image generator whose interface hid the very iteration it was meant to support. The thesis does not resolve these problems into a single unified theory of AI interface design, because no such theory yet deserves to exist. What it offers instead is a set of vocabularies, principles, and case studies precise enough to be argued with.

The chapters are organized in three movements. Foundations lays the conceptual groundwork—how to represent a thinking process on screen, how a styleguide accounts for content it did not author, what principles hold across cases, and what interaction primitives recur once submission and response stop being instantaneous and certain. UIs then works through specific surfaces—FAQs, articles, navigation, images, chat, image generation—each treated as a small independent study rather than a subordinate example of the foundations. Read the foundations first if you want the argument in order; skip to a UI chapter first if you want to see the argument tested against something concrete.

The method throughout is practice-based: build a working prototype, put it in front of people, and let what breaks tell you what the interface actually needs to say. This produces a different kind of evidence than a survey of best practices would, and a more honest one. Several of the positions taken here are provisional, flagged as such where it matters, and likely to look naive in a few years; that is an acceptable cost of writing about a technology this early in its interface history. What is not provisional is the commitment to designing against the system's actual behavior rather than its marketing description.

None of what follows assumes that AI interfaces are inherently good for users, or that more of the technology is automatically the right design choice. Several chapters argue for restraint—for not streaming when a static answer would be clearer, for not personifying a system that has no persistent self, for not hiding uncertainty behind confident prose. The thesis is optimistic about the medium and skeptical of most of what has shipped in it so far; those two positions are not in tension, and holding both at once is, in a sense, the whole argument.

:::notes
Read sequentially or jump to any chapter; each stands on its own. Where a chapter cites a prototype or study, that is the source for the claim being made, not an illustrative aside.
:::`
  },
  {
    collection: "pieces",
    frontmatter: { title: "Credits", slug: "credits", section: "preface", order: 2 },
    body: `The work here grew out of conversations, critiques, and late-night debugging sessions with people generous enough to look at unfinished things. Their names appear throughout the chapters where their influence was most direct.

:::notes
Affiliations are listed as they were at the time of the relevant contribution.
:::`
  },
  {
    collection: "pieces",
    frontmatter: { title: "Representing Thinking", slug: "representing-thinking", section: "foundations", order: 1 },
    body: `Before an interface can show that a system is thinking, it has to decide what thinking looks like. This chapter examines the visual and temporal vocabularies designers reach for—spinners, streaming text, typing indicators—and asks which of them model the process accurately and which merely signal busyness.

:::notes
The distinction between representing process and representing result shapes every design decision in the chapters that follow.
:::`
  },
  {
    collection: "pieces",
    frontmatter: { title: "Styleguides", slug: "styleguides", section: "foundations", order: 2 },
    body: `A styleguide for an AI-augmented product has to account for outputs it did not author. This chapter proposes a framework for extending design tokens and component libraries to cover generated content—text, images, citations—without surrendering visual coherence.

:::notes
Examples draw from production systems where the generated/designed boundary became a live design problem.
:::`
  },
  {
    collection: "pieces",
    frontmatter: { title: "Principles", slug: "principles", section: "foundations", order: 3 },
    body: `Six principles for designing AI interfaces, derived inductively from the case studies in this thesis: legibility, interruptibility, recoverability, attribution, calibration, and restraint. Each is defined precisely enough to fail—vague principles are not principles.

:::notes
The principles are ordered by the phase of an interaction they most affect, from first contact to long-term use.
:::`
  },
  {
    collection: "pieces",
    frontmatter: { title: "Interactions", slug: "interactions", section: "foundations", order: 4 },
    body: `Interaction patterns for AI interfaces differ from those for deterministic software because the system's response is neither instant nor certain. This chapter catalogs the interaction primitives—prompt submission, streaming, interruption, correction, regeneration—and describes when to use each.

:::notes
Patterns are presented as decision trees, not as prescriptions; the right choice depends on latency budget and error tolerance.
:::`
  },
  {
    collection: "pieces",
    frontmatter: { title: "FAQs", slug: "faqs", section: "uis", order: 1 },
    body: `A FAQ built on a language model is still a FAQ—the same user goal (get an answer quickly, get out) shapes the design even when the answer-generation mechanism changes. This chapter compares static and generated FAQ surfaces across response quality, trust, and time-to-answer.

:::notes
The prototype tested in this chapter ran on a 7B parameter model to keep latency comparable to a network round-trip.
:::`
  },
  {
    collection: "pieces",
    frontmatter: { title: "Infinite Article", slug: "infinite-article", section: "uis", order: 2 },
    body: `The infinite scroll article is a UI experiment in progressive disclosure driven by reader interest rather than editorial pre-planning. As the reader reaches the end of a section, the model extends the piece in the direction the reading trajectory suggests.

:::notes
This is the most speculative piece in the thesis; the implementation exists but the evaluation is ongoing.
:::`
  },
  {
    collection: "pieces",
    frontmatter: { title: "Navigation", slug: "navigation", section: "uis", order: 3 },
    body: `Navigation in an AI-assisted interface is partly about wayfinding and partly about scope management—telling the system what is in play and what is not. This chapter examines how persistent navigation structures, breadcrumbs, and context panels do double duty as both user controls and model context.

:::notes
The navigation on this site is an instance of the patterns described here; you are looking at the experiment.
:::`
  },
  {
    collection: "pieces",
    frontmatter: { title: "Images", slug: "images", section: "uis", order: 4 },
    body: `Generated images raise questions that stock photography did not: provenance, consistency across a session, and the gap between what was asked and what was produced. This chapter proposes an image component that makes that gap legible rather than hiding it behind a polished result.

:::notes
All images in this thesis were generated; captions carry the prompt and model identifier.
:::`
  },
  {
    collection: "pieces",
    frontmatter: { title: "Bot", slug: "bot", section: "uis", order: 5 },
    body: `The chatbot is the most direct AI interface and also the one most prone to anthropomorphism. This chapter examines how small typographic and interaction choices—typing indicators, avatar presence, name choice—shift user expectations and calibration, and proposes a more honest baseline.

:::notes
The analysis draws on transcripts from a semester-long study with design students using a course assistant bot.
:::`
  },
  {
    collection: "pieces",
    frontmatter: { title: "Look At", slug: "look-at", section: "uis", order: 6 },
    body: `Look At is a visual attention interface: it shows the user what the model is attending to in a document or image before producing an output. The chapter documents the design process, the prototype, and what we learned from watching people watch the model watch them.

:::notes
The name comes from a direction given in figure-drawing classes; it has the same instructive purpose here.
:::`
  },
  {
    collection: "pieces",
    frontmatter: { title: "Image Generation", slug: "image-generation", section: "uis", order: 7 },
    body: `Designing the interface for image generation is a different problem from designing the image generator. This chapter focuses on the prompt-to-image loop: how to write prompts, how to read results, how to iterate, and how to know when to stop—and what the UI can do to support each step.

:::notes
The workflow described here converged through iteration on a single project brief over eight weeks.
:::`
  },
]

const secret = readDevSecret()
const cmsUrl = process.env.CMS_URL ?? "http://localhost:8787"

let created = 0
let skipped = 0
let errors = 0

for (const piece of PIECES) {
  const force = true
  const res = await fetch(`${cmsUrl}/dev/seed-content`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dev-Secret": secret,
    },
    body: JSON.stringify({ action: "create_and_publish", doc: piece, force }),
  })

  if (!res.ok) {
    console.error(`[error] ${piece.frontmatter.slug}: HTTP ${res.status} — ${await res.text()}`)
    errors++
    continue
  }

  const data = await res.json() as { status: string; reason?: string; id?: string }

  if (data.status === "skipped") {
    console.log(`[skip]  ${piece.frontmatter.slug}: ${data.reason ?? "already_published"}`)
    skipped++
  } else if (data.status === "created_and_published") {
    console.log(`[ok]    ${piece.frontmatter.slug}: published (${data.id})`)
    created++
  } else if (data.status === "published") {
    console.log(`[ok]    ${piece.frontmatter.slug}: draft published (${data.id})`)
    created++
  } else if (data.status === "force_updated") {
    console.log(`[ok]    ${piece.frontmatter.slug}: force-updated and republished (${data.id})`)
    created++
  } else {
    console.error(`[error] ${piece.frontmatter.slug}: unexpected status "${data.status}"`)
    errors++
  }
}

console.log(`\nDone: ${created} published, ${skipped} skipped, ${errors} errors`)
if (errors > 0) process.exit(1)
