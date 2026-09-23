import { hastToPlainText, type HastElement, type HastNode, type HastRoot } from "~/components/cms/hast";

/**
 * The hosted project cannot register :::notes / :::foreword, so those blocks
 * were published as ordinary paragraphs. These are the paragraphs, matched
 * after whitespace is collapsed, and lifted back into the asides the article
 * already renders.
 */
const FOREWORDS = new Set([
  "Why design for a system that thinks back — and what that changes about the interface between you and it.",
  "A question on this site is answered from the chapters, which are indexed as they are published.",
  "⌘F on this site matches meaning, and it answers by lighting up what was already written, or by staying dark.",
  "Two named axes, images sitting where they score, and a click in empty space as the request for a new one.",
]);

const NOTES = new Set([
  "Read sequentially or jump to any chapter; each stands on its own. Where a chapter cites a prototype or study, that is the source for the claim being made, not an illustrative aside.",
  "Affiliations are listed as they were at the time of the relevant contribution.",
  "The distinction between representing process and representing result shapes every design decision in the chapters that follow.",
  "Examples draw from production systems where the generated/designed boundary became a live design problem.",
  "The principles are ordered by the phase of an interaction they most affect, from first contact to long-term use.",
  "Patterns are presented as decision trees, not as prescriptions; the right choice depends on latency budget and error tolerance.",
  "Clark, Andy, and David Chalmers. The Extended Mind. Analysis, 1998. Search runs on the published pieces collection. A miss does not invent a chapter.",
  "This is the most speculative piece in the thesis; the implementation exists but the evaluation is ongoing.",
  "The navigation on this site is an instance of the patterns described here; you are looking at the experiment.",
  "All images in this thesis were generated; captions carry the prompt and model identifier.",
  "The name comes from a direction given in figure-drawing classes; it has the same instructive purpose here.",
  "The workflow described here converged through iteration on a single project brief over eight weeks.",
  "Find runs over paragraph IDs in the published pieces collection; a Choice orders them and a Noul `exists` gates whether anything is shown. An earlier chapter, Look At, covered the in-chapter version of this needle. Find replaced it.",
  "Shneiderman, Ben. Direct Manipulation: A Step Beyond Programming Languages. IEEE Computer, 1983. Placement scores are computed once over four to six dimensions; the visible axes select which pair is on screen.",
]);

function collapsed(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function aside(className: string, paragraph: HastElement): HastElement {
  return {
    type: "element",
    tagName: "aside",
    properties: { className: [className] },
    children: [paragraph],
  };
}

export function liftKnownAsides(root: HastNode | null | undefined): HastNode | null | undefined {
  if (root?.type !== "root") return root;
  const children = root.children.map((child) => {
    if (child.type !== "element" || child.tagName !== "p") return child;
    const text = collapsed(hastToPlainText(child));
    if (FOREWORDS.has(text)) return aside("cms-foreword", child);
    if (NOTES.has(text)) return aside("cms-notes", child);
    return child;
  });
  const lifted: HastRoot = { type: "root", children };
  return lifted;
}
