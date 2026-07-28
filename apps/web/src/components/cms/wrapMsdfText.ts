import type { BmFont } from "~/components/webgl/msdf-text";

/**
 * Word-wraps `text` into `\n`-joined lines that fit `maxWidthPx`, measuring
 * glyph advances from bmfont metrics scaled to `fontSizePx`. Explicit `\n`
 * in the source is preserved as a hard line break. A single word wider than
 * `maxWidthPx` is hard-broken mid-word rather than overflowing.
 */
export function wrapMsdfText(
  metrics: BmFont,
  text: string,
  maxWidthPx: number,
  fontSizePx: number,
  trackingEm = -0.06,
): string {
  if (!Number.isFinite(maxWidthPx) || maxWidthPx <= 0) return text;

  const scale = fontSizePx / metrics.info.size;
  const trackingPx = trackingEm * fontSizePx;
  const chars = new Map(metrics.chars.map((c) => [c.char, c]));
  const fallbackAdvance = metrics.info.size * 0.33 * scale;

  const advanceOf = (ch: string) => (chars.get(ch)?.xadvance ?? metrics.info.size * 0.33) * scale;

  const measure = (word: string): number => {
    if (word.length === 0) return 0;
    let w = 0;
    for (const ch of word) w += advanceOf(ch) + trackingPx;
    return w - trackingPx;
  };

  const spaceWidth = advanceOf(" ") + trackingPx || fallbackAdvance;

  const hardBreak = (word: string): string[] => {
    const parts: string[] = [];
    let current = "";
    let currentW = 0;
    for (const ch of word) {
      const adv = advanceOf(ch) + trackingPx;
      if (current && currentW + adv > maxWidthPx) {
        parts.push(current);
        current = ch;
        currentW = adv;
      } else {
        current += ch;
        currentW += adv;
      }
    }
    if (current) parts.push(current);
    return parts;
  };

  const outLines: string[] = [];
  for (const sourceLine of text.split("\n")) {
    let line = "";
    let lineWidth = 0;

    for (const word of sourceLine.split(" ")) {
      const wordWidth = measure(word);

      if (wordWidth > maxWidthPx) {
        if (line) {
          outLines.push(line);
          line = "";
          lineWidth = 0;
        }
        const pieces = hardBreak(word);
        pieces.forEach((piece, i) => {
          if (i < pieces.length - 1) {
            outLines.push(piece);
          } else {
            line = piece;
            lineWidth = measure(piece);
          }
        });
        continue;
      }

      const withSpace = line ? lineWidth + spaceWidth + wordWidth : wordWidth;
      if (line && withSpace > maxWidthPx) {
        outLines.push(line);
        line = word;
        lineWidth = wordWidth;
      } else {
        line = line ? `${line} ${word}` : word;
        lineWidth = withSpace;
      }
    }
    outLines.push(line);
  }

  return outLines.join("\n");
}
