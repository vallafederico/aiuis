import { MSDF } from "../../config";
import { readdir, mkdir, writeFile, unlink } from "node:fs/promises";
import { join, extname, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
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

/**
 * Pre-instance a variable font at specific axis values using fonttools.
 * Returns a temp file path — caller must delete it when done.
 * Requires python3 with fontTools installed in PATH.
 */
async function instanceVariableFont(
	fontPath: string,
	name: string,
	variations: Record<string, number>,
): Promise<string> {
	const tmpPath = join(tmpdir(), `msdf-instance-${name}-${Date.now()}.ttf`);
	// Build a one-liner that imports and runs the instancer programmatically
	const axesJson = JSON.stringify(variations);
	const script = [
		"import json, sys",
		"from fontTools.ttLib import TTFont",
		"from fontTools.varLib.instancer import instantiateVariableFont",
		`font = TTFont(${JSON.stringify(fontPath)})`,
		`axes = json.loads(${JSON.stringify(axesJson)})`,
		"font = instantiateVariableFont(font, axes, inplace=True)",
		`font.save(${JSON.stringify(tmpPath)})`,
	].join(";");

	// Try python3 first, fall back to the versioned binary that has fontTools
	const candidates = [
		"python3",
		"/Library/Frameworks/Python.framework/Versions/3.10/bin/python3.10",
	];

	let success = false;
	let lastErr = "";
	for (const py of candidates) {
		const proc = Bun.spawn([py, "-c", script], {
			stderr: "pipe",
		});
		const code = await proc.exited;
		if (code === 0) {
			success = true;
			break;
		}
		const errText = await new Response(proc.stderr).text();
		// Only fall through if the error is "no module" — other errors are real
		if (errText.includes("No module named") || errText.includes("ModuleNotFoundError")) {
			lastErr = errText;
			continue;
		}
		throw new Error(`fontTools instancer failed (${py}):\n${errText}`);
	}

	if (!success) {
		throw new Error(
			`Could not find python3 with fontTools installed.\n` +
			`Tried: ${candidates.join(", ")}\n` +
			`Last error: ${lastErr}\n` +
			`Install with: pip3 install fonttools`,
		);
	}

	return tmpPath;
}

async function generateFont(
	fontPath: string,
	outputName: string,
	options: { fontSize: number; fieldType: string; distanceRange: number; textureSize: [number, number]; charset?: string },
	out: string,
) {
	const { fontSize, fieldType, distanceRange, textureSize, charset } = options;
	const { textures, font } = await generate(fontPath, {
		outputType: "json",
		fieldType,
		fontSize,
		distanceRange,
		textureSize,
		smartSize: true,
		...(charset ? { charset } : {}),
		filename: outputName,
	});

	for (const texture of textures) {
		const textureName = `${basename(texture.filename, ".png")}.png`;
		await writeFile(join(out, textureName), texture.texture);
		console.log(`MSDF font atlas > ${textureName}`);
	}

	// Always use outputName for the JSON so variant fonts (generated from a
	// temp-path TTF) don't inherit the temp file's basename.
	const jsonName = `${outputName}.json`;
	await writeFile(join(out, jsonName), font.data);
	console.log(`MSDF font metrics > ${jsonName}`);
}

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
		variantFonts,
	} = MSDF.fonts;
	if (!enabled) return;

	const out = resolve(import.meta.dir, `../..${outDir}`);
	await mkdir(out, { recursive: true });

	const fontOptions = { fontSize, fieldType, distanceRange, textureSize, charset };

	// 1. Generate atlases for every .ttf/.otf found in the font paths (base fonts)
	for (const path of paths) {
		const dir = resolve(import.meta.dir, `../..${path}`);
		const files = await readdir(dir, { recursive: true }).catch(() => []);

		for (const file of files) {
			const ext = extname(file).toLowerCase();
			if (!FONT_EXTENSIONS.includes(ext)) continue;

			const name = basename(file, ext);
			await generateFont(join(dir, file), name, fontOptions, out);
		}
	}

	// 2. Generate variable-font weight instances
	if (variantFonts && variantFonts.length > 0) {
		// Resolve source paths: look for each source file in the font paths
		const sourceDirs = paths.map((p) => resolve(import.meta.dir, `../..${p}`));

		for (const { source, name, variations } of variantFonts) {
			let sourcePath: string | undefined;
			for (const dir of sourceDirs) {
				const candidate = join(dir, source);
				const exists = await Bun.file(candidate).exists();
				if (exists) {
					sourcePath = candidate;
					break;
				}
			}
			if (!sourcePath) {
				console.warn(`MSDF variant font: source "${source}" not found in font paths — skipping ${name}`);
				continue;
			}

			console.log(`MSDF variant font: instancing ${source} at ${JSON.stringify(variations)} → ${name}`);
			const tmpPath = await instanceVariableFont(sourcePath, name, variations);
			try {
				await generateFont(tmpPath, name, fontOptions, out);
			} finally {
				await unlink(tmpPath).catch(() => {});
			}
		}
	}
}
