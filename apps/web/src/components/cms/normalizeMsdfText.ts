// MSDF atlases only cover the chars baked in at `pnpm msdf` time. When a
// glyph is missing, buildMsdfTextFragment renders a blank gap — this maps
// common punctuation/diacritics to ASCII fallbacks so text stays legible
// even against a stale/ASCII-only atlas (charset covers these in config.ts,
// but this stays as a safety net for whatever the loaded atlas actually has).
const FALLBACK_MAP: Record<string, string> = {
  "\u2014": "--", // —
  "\u2013": "-", // –
  "\u2018": "'", // '
  "\u2019": "'", // '
  "\u201c": '"', // "
  "\u201d": '"', // "
  "\u2026": "...", // …
  "\u00b7": ".", // ·
  "\u2022": "-", // •
  "à": "a", "á": "a", "â": "a", "ã": "a", "ä": "a", "å": "a",
  "è": "e", "é": "e", "ê": "e", "ë": "e",
  "ì": "i", "í": "i", "î": "i", "ï": "i",
  "ò": "o", "ó": "o", "ô": "o", "õ": "o", "ö": "o",
  "ù": "u", "ú": "u", "û": "u", "ü": "u",
  "ñ": "n", "ç": "c",
  "À": "A", "Á": "A", "Â": "A", "Ã": "A", "Ä": "A", "Å": "A",
  "È": "E", "É": "E", "Ê": "E", "Ë": "E",
  "Ì": "I", "Í": "I", "Î": "I", "Ï": "I",
  "Ò": "O", "Ó": "O", "Ô": "O", "Õ": "O", "Ö": "O",
  "Ù": "U", "Ú": "U", "Û": "U", "Ü": "U",
  "Ñ": "N", "Ç": "C",
};

const ASCII_PRINTABLE = /[\x20-\x7e]/;

/**
 * Replaces chars the loaded atlas doesn't have with ASCII-safe fallbacks.
 * `available`, when given (the atlas's own char set), is authoritative —
 * anything in it renders as-is. Without it, falls back to an ASCII-only
 * assumption (pre-regen atlas).
 */
export function normalizeMsdfText(text: string, available?: Set<string>): string {
  let out = "";
  for (const ch of text) {
    if (ch === "\n") {
      out += ch;
      continue;
    }
    const known = available ? available.has(ch) : ASCII_PRINTABLE.test(ch);
    out += known ? ch : (FALLBACK_MAP[ch] ?? ch);
  }
  return out;
}
