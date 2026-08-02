import type { BmFont } from "~/components/webgl/msdf-text";
import { getCharMap } from "~/components/webgl/msdf-text";

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
  const chars = getCharMap(metrics);
  const fallbackAdvance = metrics.info.size * 0.33 * scale;

  const advanceOf = (ch: string) => (chars.get(ch)?.xadvance ?? metrics.info.size * 0.33) * scale;

  const measure = (word: string): number => {
    if (word.length === 0) return 0;
    let w = 0;
    for (const ch of word) w += advanceOf(ch) + trackingPx;
    return w - trackingPx;
  };

  const spaceWidth = advanceOf(" ") + trackingPx || fallbackAdvance;

  const hardBreak = (word: string): { text: string; width: number }[] => {
    const parts: { text: string; width: number }[] = [];
    let current = "";
    let currentW = 0;
    for (const ch of word) {
      const adv = advanceOf(ch) + trackingPx;
      if (current && currentW + adv > maxWidthPx) {
        parts.push({ text: current, width: currentW - trackingPx });
        current = ch;
        currentW = adv;
      } else {
        current += ch;
        currentW += adv;
      }
    }
    if (current) parts.push({ text: current, width: currentW - trackingPx });
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
            outLines.push(piece.text);
          } else {
            line = piece.text;
            lineWidth = piece.width;
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
