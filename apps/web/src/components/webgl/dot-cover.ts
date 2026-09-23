import { createContext } from "solid-js";

/** Circle in CSS pixels, relative to the dot wrapper's top-left. */
export type DotCover = { x: number; y: number; r: number };

export const DotCoverCtx = createContext<(() => DotCover | null) | undefined>();
