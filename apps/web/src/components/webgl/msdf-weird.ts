import { buildMsdfTextFragment, type BmFont, type MsdfTextLayout } from "./msdf-text";

export type WeirdVariant = "classic";

const WEIRD_VARIANTS: WeirdVariant[] = ["classic"];

export function isWeirdVariant(v: string): v is WeirdVariant {
  return (WEIRD_VARIANTS as string[]).includes(v);
}

/**
 * Builds a fragment shader for the "weird" path (baked glyph constants + loop).
 * `variant` selects which weird aesthetic to apply; defaults to "classic".
 * Pixel-identical to the original buildMsdfTextFragment with weird=true when
 * variant is "classic".
 */
export function buildWeirdFragment(
  font: BmFont,
  text: string,
  layout: MsdfTextLayout,
  variant: WeirdVariant = "classic",
): ReturnType<typeof buildMsdfTextFragment> {
  // "classic" = original weird prologue (raw vUv, no aspect correction)
  const weirdLayout: MsdfTextLayout = { ...layout, weird: variant === "classic" };
  return buildMsdfTextFragment(font, text, weirdLayout);
}
