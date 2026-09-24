import { isServer } from "solid-js/web";
import gsap from "gsap";

// SplitText lives in ~/lib/split-text: the shell imports this module on every
// page, and only a couple of components split text.

export interface AnimationDefaults {
  duration: number;
  ease: string;
}

export interface PageAnimationConfig {
  in: AnimationDefaults;
  out: AnimationDefaults;
}

const def: AnimationDefaults = {
  duration: 1.2,
  ease: "expo.out",
};

if (!isServer) {
  gsap.defaults(def);
}

export default gsap;
export { def };

// Animation constants
export const A: { page: PageAnimationConfig } = {
  page: {
    in: {
      duration: 1.2,
      ease: "expo.out",
    },
    out: {
      duration: 0.6,
      ease: "expo.out",
    },
  },
};
