/**
 * How-to lines for each art-directed UI, shown as a small card in the corner of
 * `/uis/:slug`. One short sentence per line. A UI with no entry shows no card.
 * The card sits bottom-right by default; a UI whose own controls live there lists
 * its slug in `hintsLeft` to move the card to the bottom-left corner.
 * Keep this module free of ~/uis/registry: the nav chrome reads it.
 */
export const uiHints: Record<string, string[]> = {
  "generative-moodboard": [
    "Scroll to zoom, drag to move.",
    "Click anywhere to select pairs.",
    "Click on the new card to generate.",
  ],
  faqs: ["Click a question to open its answer.", "Type in the last row to ask another."],
  filters: [
    "Type what you want and press Enter.",
    "Matching chapters are pulled in.",
    "Push the rest around with the pointer.",
    "Escape clears.",
  ],
  "infinite-article": [
    "Scroll to the end and the next section is written.",
    "Select a passage to get a note on it.",
  ],
  "sketch-generation": [
    "Draw, then hold still and the image renders.",
    "Draw again to revise it.",
    "Pick a brief to change the style, clear to start over.",
  ],
  "type-an-analytic": [
    "Type an analytic, or pick an example.",
    "Type again to change it.",
    "Use the range buttons to change the period, new to start over.",
  ],
};

/** UIs whose how-to card goes bottom-left because the UI uses the bottom-right. */
export const hintsLeft = new Set(["sketch-generation", "faqs", "infinite-article", "filters", "type-an-analytic"]);

/**
 * UIs whose content is plain DOM (checked per file under uis/directed). The page's
 * WebGL canvas sits below the DOM, so their how-to card must be DOM too or the
 * content draws over it. WebGL UIs (generative-moodboard, filters, sketch-generation) keep the GL card.
 * infinite-article only uses GlFill hairlines for plate edges; its text and layout are DOM.
 */
export const hintsDom = new Set(["faqs", "type-an-analytic", "infinite-article"]);
