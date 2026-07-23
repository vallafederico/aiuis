import { runFonts } from "./msdf-fonts";
import { runSvgs } from "./msdf-svgs";
import { runPngs } from "./msdf-pngs";

await runFonts();
await runSvgs();
await runPngs();
console.log("msdf done");
