import { MSDF } from "../../config";
import { readdir, mkdir, writeFile } from "node:fs/promises";
import { join, extname, basename, resolve } from "node:path";
import generateBMFont from "msdf-bmfont-xml";

const FONT_EXTENSIONS = [".ttf", ".otf"];

type BMFontTexture = { filename: string; texture: Buffer };
type BMFontData = { filename: string; data: string };

const generate = (fontPath: string, options: Record<string, unknown>) =>
	new Promise<{ textures: BMFontTexture[]; font: BMFontData }>(
		(resolvePromise, reject) => {
			generateBMFont(
				fontPath,
				options,
				(error: Error | null, textures: BMFontTexture[], font: BMFontData) => {
					if (error) reject(error);
					else resolvePromise({ textures, font });
				},
			);
		},
	);

export async function runFonts() {
	const {
		enabled,
		paths,
		outDir,
		fontSize,
		fieldType,
		distanceRange,
		textureSize,
		charset,
	} = MSDF.fonts;
	if (!enabled) return;

	const out = resolve(import.meta.dir, `../..${outDir}`);
	await mkdir(out, { recursive: true });

	for (const path of paths) {
		const dir = resolve(import.meta.dir, `../..${path}`);
		const files = await readdir(dir, { recursive: true }).catch(() => []);

		for (const file of files) {
			const ext = extname(file).toLowerCase();
			if (!FONT_EXTENSIONS.includes(ext)) continue;

			const name = basename(file, ext);
			const { textures, font } = await generate(join(dir, file), {
				outputType: "json",
				fieldType,
				fontSize,
				distanceRange,
				textureSize,
				smartSize: true,
				...(charset ? { charset } : {}),
				filename: name,
			});

			for (const texture of textures) {
				const textureName = `${basename(texture.filename, ".png")}.png`;
				await writeFile(join(out, textureName), texture.texture);
				console.log(`MSDF font atlas > ${textureName}`);
			}

			const jsonName = `${basename(font.filename, ".json")}.json`;
			await writeFile(join(out, jsonName), font.data);
			console.log(`MSDF font metrics > ${jsonName}`);
		}
	}
}
