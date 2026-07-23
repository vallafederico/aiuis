import { MSDF } from "../../config";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { join, extname, basename, resolve } from "node:path";
import sharp from "sharp";
import { alphaToSdf } from "./sdf";

/**
 * svg → single-channel sdf texture, via a high-res raster.
 * (msdfgen's svg parser chokes on multi-path files — rasterizing first
 * handles any svg and matches the sdf font atlases.)
 */
async function convertSvg(
	svgPath: string,
	out: string,
	size: number,
	spread: number,
) {
	const name = basename(svgPath, extname(svgPath));

	// render the vector at the target size, padded so the field has room
	const meta = await sharp(svgPath).metadata();
	const density =
		(72 * size) / Math.max(1, meta.width ?? size, meta.height ?? size);
	const { data, info } = await sharp(svgPath, {
		density: Math.min(2400, density),
	})
		.resize(size, size, { fit: "inside" })
		.extend({
			top: spread,
			bottom: spread,
			left: spread,
			right: spread,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const sdf = alphaToSdf(data, info.width, info.height, spread);
	await sharp(sdf, {
		raw: { width: info.width, height: info.height, channels: 1 },
	})
		.png()
		.toFile(join(out, `${name}.png`));
	await writeFile(
		join(out, `${name}.json`),
		JSON.stringify(
			{ type: "sdf", width: info.width, height: info.height, spread },
			null,
			"\t",
		),
	);
	console.log(`SDF svg > ${name}.png`);
}

export async function runSvgs() {
	const { enabled, paths, outDir, size, distanceRange } = MSDF.svgs;
	if (!enabled) return;

	const out = resolve(import.meta.dir, `../..${outDir}`);
	await mkdir(out, { recursive: true });

	for (const path of paths) {
		const dir = resolve(import.meta.dir, `../..${path}`);
		const files = await readdir(dir, { recursive: true }).catch(() => []);

		for (const file of files) {
			if (extname(file).toLowerCase() !== ".svg") continue;
			await convertSvg(join(dir, file), out, size, distanceRange).catch(
				(error) => console.error(`Error converting ${file}:`, error),
			);
		}
	}
}
