import { isServer } from "solid-js/web";
import { SplitText } from "gsap/dist/SplitText";
import gsap from "~/lib/gsap";

if (!isServer) gsap.registerPlugin(SplitText);

export { SplitText };
