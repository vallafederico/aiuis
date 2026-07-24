/** Read a CSS custom property as an RGB triple (0–1). SSR-safe. */
export function readCssColor(prop: string): [number, number, number] {
  if (typeof document === "undefined") return [0, 0, 1];
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(prop)
    .trim();
  const hex = raw.startsWith("#") ? raw.slice(1) : raw;
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16) / 255;
    const g = parseInt(hex[1] + hex[1], 16) / 255;
    const b = parseInt(hex[2] + hex[2], 16) / 255;
    return [r, g, b];
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return [r, g, b];
  }
  return [0, 0, 1];
}
