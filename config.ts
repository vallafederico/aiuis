// //////////////////////////////////////// scripts

export const OPTIMISE = {
	/* image optimiser */
	images: {
		enabled: true, // enable image optimization
		paths: ["/apps/web/public"], // paths to watch for changes
		extensions: [".png", ".jpg", ".jpeg"], // extensions to convert
		quality: 80, // quality of the converted images
	},
	/* font optimiser — ttf/otf sources → woff2 for the site */
	fonts: {
		enabled: true,
		paths: ["/apps/web/src/assets/fonts"], // source ttf/otf files
		outDir: "/apps/web/public/fonts", // woff2 output
		extensions: [".ttf", ".otf"],
	},
};

export const MSDF = {
	/* fonts (.ttf/.otf) → msdf glyph atlas + bmfont metrics (troika-style sdf text) */
	fonts: {
		enabled: true,
		paths: ["/apps/web/src/assets/fonts"], // source ttf/otf files (shared with OPTIMISE.fonts)
		outDir: "/apps/web/public/msdf", // atlas .png + metrics .json land here
		fontSize: 256, // glyph size in the atlas, px — Garara's hairline strokes need it
		// "sdf" not "msdf": the vendored msdfgen is old (no error correction) and its
		// edge coloring beads on thin/noisy outlines; sdf only rounds sharp corners
		// slightly at extreme zoom, which these fonts tolerate
		fieldType: "sdf" as "sdf" | "msdf",
		distanceRange: 8, // sdf spread in px — feed as uPxRange to the shader
		textureSize: [4096, 4096] as [number, number], // atlas page size — bumped from 2048 so the expanded charset (below) still fits a single page
		// printable ASCII (32–126) plus punctuation/diacritics pieces content
		// actually uses (em/en dash, curly quotes, ellipsis, accented Latin) —
		// default (undefined) is ASCII-only and drops these as blank glyphs
		charset:
			" !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~" +
			"—–‘’“”…·•àáâãäåèéêëìíîïòóôõöùúûüñçÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÑÇ" as string | undefined,
		/**
		 * Variable-font weight instances to emit as separate atlases.
		 * Each entry pre-instances the source TTF at the given axis values
		 * (via fonttools varLib.instancer) and generates an atlas named `name`.
		 * The python3 in PATH must have fontTools installed.
		 *
		 * Nav uses Garara at wght=0 (the "0" prefix in "002") and wght=10
		 * (the bold "02" + section-letter prefixes + list-item numbers).
		 * The base Garara atlas (wght=0 default) is kept for backwards compat.
		 */
		variantFonts: [
			{ source: "Garara.ttf", name: "Garara-0",  variations: { wght: 0  } },
			{ source: "Garara.ttf", name: "Garara-10", variations: { wght: 10 } },
		] as { source: string; name: string; variations: Record<string, number> }[],
	},
	/* svgs → single-channel sdf textures (rasterized first — any svg works) */
	svgs: {
		enabled: true,
		paths: ["/apps/web/src/assets/msdf/svg"], // source svg files
		outDir: "/apps/web/public/msdf",
		size: 1024, // output texture size, px — sized down on screen, keeps edges crisp
		distanceRange: 64, // sdf spread in px — also caps the max progressive-blur radius
	},
	/* pngs → single-channel sdf textures (bitmaps can't be msdf — no vectors) */
	pngs: {
		enabled: true,
		paths: ["/apps/web/src/assets/msdf/png"], // source png files (alpha = shape)
		outDir: "/apps/web/public/msdf",
		spread: 8, // sdf spread in px
	},
};
