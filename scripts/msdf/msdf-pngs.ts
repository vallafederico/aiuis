import { MSDF } from "../../config";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { join, extname, basename, resolve } from "node:path";
import sharp from "sharp";
import { alphaToSdf } from "./sdf";

async function convertPng(pngPath: string, out: string, spread: number) {
	const name = basename(pngPath, extname(pngPath));
	const { data, info } = await sharp(pngPath)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const { width, height } = info;

	const sdf = alphaToSdf(data, width, height, spread);
	await sharp(sdf, { raw: { width, height, channels: 1 } })
		.png()
		.toFile(join(out, `${name}.png`));
	await writeFile(
		join(out, `${name}.json`),
		JSON.stringify({ type: "sdf", width, height, spread }, null, "\t"),
	);
	console.log(`SDF png > ${name}.png`);
}

export async function runPngs() {
	const { enabled, paths, outDir, spread } = MSDF.pngs;
	if (!enabled) return;

	const out = resolve(import.meta.dir, `../..${outDir}`);
	await mkdir(out, { recursive: true });

	for (const path of paths) {
		const dir = resolve(import.meta.dir, `../..${path}`);
		const files = await readdir(dir, { recursive: true }).catch(() => []);

		for (const file of files) {
			if (extname(file).toLowerCase() !== ".png") continue;
			await convertPng(join(dir, file), out, spread).catch((error) =>
				console.error(`Error converting ${file}:`, error),
			);
		}
	}
}
