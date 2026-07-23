import { OPTIMISE } from "../../config";
import { readdir, stat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, extname, basename, resolve } from "node:path";
// @ts-ignore — no types shipped
import { compress } from "wawoff2";

const { enabled, paths, outDir, extensions } = OPTIMISE.fonts;

async function convertFont(fontPath: string, out: string) {
	const name = basename(fontPath, extname(fontPath));
	const woff2Path = join(out, `${name}.woff2`);

	const [source, existing] = await Promise.all([
		stat(fontPath),
		stat(woff2Path).catch(() => null),
	]);
	if (existing && existing.mtimeMs >= source.mtimeMs) return;

	const woff2 = await compress(await readFile(fontPath));
	await writeFile(woff2Path, Buffer.from(woff2));
	console.log(`WOFF2 > ${name}.woff2`);
}

export async function runFonts() {
	if (!enabled) return;

	const out = resolve(import.meta.dir, `../..${outDir}`);
	await mkdir(out, { recursive: true });

	for (const path of paths) {
		const dir = resolve(import.meta.dir, `../..${path}`);
		const files = await readdir(dir, { recursive: true }).catch(() => []);

		for (const file of files) {
			if (!extensions.includes(extname(file).toLowerCase())) continue;
			await convertFont(join(dir, file), out).catch((error) =>
				console.error(`Error converting ${file}:`, error),
			);
		}
	}
}

await runFonts();
