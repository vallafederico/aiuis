import { runFonts } from "./msdf-fonts";
import { runSvgs } from "./msdf-svgs";
import { runPngs } from "./msdf-pngs";
import { runWebp } from "./msdf-webp";

await runFonts();
await runSvgs();
await runPngs();
await runWebp();
console.log("msdf done");
