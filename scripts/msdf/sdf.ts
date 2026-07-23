// large finite stand-in for "no seed" — literal Infinity yields Inf-Inf = NaN
// in the hull intersections and zeroes the whole transform
const FAR = 1e20;

// Felzenszwalb & Huttenlocher squared euclidean distance transform
function edt1d(f: Float64Array, n: number) {
	const d = new Float64Array(n);
	const v = new Int32Array(n);
	const z = new Float64Array(n + 1);
	let k = 0;
	v[0] = 0;
	z[0] = -Infinity;
	z[1] = Infinity;
	for (let q = 1; q < n; q++) {
		let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
		while (s <= z[k]) {
			k--;
			s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
		}
		k++;
		v[k] = q;
		z[k] = s;
		z[k + 1] = Infinity;
	}
	k = 0;
	for (let q = 0; q < n; q++) {
		while (z[k + 1] < q) k++;
		d[q] = (q - v[k]) ** 2 + f[v[k]];
	}
	return d;
}

function edt2d(grid: Float64Array, width: number, height: number) {
	const line = new Float64Array(Math.max(width, height));
	for (let x = 0; x < width; x++) {
		for (let y = 0; y < height; y++) line[y] = grid[y * width + x];
		const d = edt1d(line, height);
		for (let y = 0; y < height; y++) grid[y * width + x] = d[y];
	}
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) line[x] = grid[y * width + x];
		const d = edt1d(line, width);
		for (let x = 0; x < width; x++) grid[y * width + x] = d[x];
	}
}

/**
 * rgba raster → single-channel sdf, alpha ≥ 128 = inside the shape.
 * Encoded like the font atlases: 0.5 at the edge, >0.5 inside.
 */
export function alphaToSdf(
	data: Buffer | Uint8Array,
	width: number,
	height: number,
	spread: number,
) {
	const size = width * height;
	const outer = new Float64Array(size); // distance to the shape
	const inner = new Float64Array(size); // distance to the outside
	for (let i = 0; i < size; i++) {
		const inside = data[i * 4 + 3] >= 128;
		outer[i] = inside ? 0 : FAR;
		inner[i] = inside ? FAR : 0;
	}
	edt2d(outer, width, height);
	edt2d(inner, width, height);

	const sdf = Buffer.alloc(size);
	for (let i = 0; i < size; i++) {
		const sd = Math.sqrt(outer[i]) - Math.sqrt(inner[i]);
		const value = Math.max(0, Math.min(1, 0.5 - sd / (2 * spread)));
		sdf[i] = Math.round(value * 255);
	}
	return sdf;
}
