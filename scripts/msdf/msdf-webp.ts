import { MSDF } from "../../config";
import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

/**
 * Every atlas / sdf png in the out dir → `<name>.sdf.webp`, lossless.
 * Distance fields cannot take lossy compression (edges wobble at the 0.5
 * threshold), but lossless webp is bit-exact and ~3x smaller than the png.
 * `.sdf.webp` keeps clear of the image optimiser's lossy `<name>.webp`.
 */
export async function runWebp() {
	const root = fileURLToPath(new URL("../..", import.meta.url));
	const out = join(root, MSDF.svgs.outDir);
	const files = await readdir(out).catch(() => [] as string[]);
	for (const file of files) {
		if (extname(file).toLowerCase() !== ".png") continue;
		const name = basename(file, ".png");
		await sharp(join(out, file))
			.webp({ lossless: true, effort: 6 })
			.toFile(join(out, `${name}.sdf.webp`))
			.catch((error) => console.error(`Error converting ${file}:`, error));
		console.log(`webp > ${name}.sdf.webp`);
	}
}
