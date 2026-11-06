/**
 * Mosaic layout.
 *
 * The gallery is a stack of full-width bands. Each band is a row of
 * columns, and each column is any slicing (guillotine) tree of up to
 * MAX_COLUMN_TILES tiles whose root is a stack: tiles side by side, stacked,
 * nested both ways, as in BRIC-style photo collages. In a slicing tree every
 * tile keeps its exact aspect ratio and the band is a perfect rectangle, so
 * there are no holes and nothing is cropped. Split positions and band heights
 * are real numbers: they fall wherever the photos' shapes put them.
 *
 * A band's height is whatever makes it exactly as wide as the gallery. Its
 * cost compares each tile's area with the area it should have (larger for
 * more important notes). Bands are chosen by dynamic programming,
 * Knuth-Plass style (as in the Google Photos web grid), over the ways of
 * splitting the sequence; columns within a band by a beam search.
 */
import type { Box } from './justify';

export interface MosaicItem {
	/** Aspect ratio, width / height. */
	ratio: number;
	/** Relative size: 0 small, 1 medium, 2 large. */
	size: number;
}

export interface MosaicOptions {
	/** Inner width of the container in px. */
	width: number;
	/** Edge of a square medium tile, in px: sets the area tiles aim for. */
	tileSize: number;
	/** Space between tiles, in px (both directions). */
	gap: number;
	/** No tile may be shorter than this, nor smaller in area than its square, in px. */
	minTileSize?: number;
	/** No band (so no tile) may be taller than this, in px: the visible pane's height. */
	maxTileHeight?: number;
}

export interface MosaicLayout {
	boxes: Box[];
	height: number;
}

/** A slicing tree: a leaf offset, or children side by side ('h') or stacked ('v'). */
type Tree = number | { dir: 'h' | 'v'; children: [Tree, Tree] };

/** Most tiles in one column. Slicing trees: 1, 2, 6, 22 shapes (half are stacks). */
const MAX_COLUMN_TILES = 4;
const MAX_BAND_TILES = 12;
/** Target area multiplier per size class. */
const AREA_BY_SIZE = [0.55, 1, 2.6];
/** Band heights allowed, as multiples of the tile size. */
const MIN_BAND = 0.6;
const MAX_BAND = 4;
/** Band height the column beam assumes when ranking partial bands. */
const TYPICAL_BAND = 2;
/** Each band adds a full-width seam. */
const BAND_PENALTY = 0.25;
/** A band of only single tiles is a plain row. */
const PLAIN_ROW_PENALTY = 0.6;
/** Neighbouring columns with the same shape line their seams up. */
const SAME_NEIGHBOUR_PENALTY = 0.15;
const BEAM = 4;
const INFEASIBLE = 1e6;

/** All slicing trees over leaves 0..n-1, in order, without duplicate shapes. */
function slicingTrees(n: number): Tree[] {
	const memo = new Map<string, Tree[]>();
	// Canonical form: a node's first child never has the node's own direction,
	// so H(H(a, b), c) and H(a, H(b, c)) aren't both generated.
	const build = (from: number, to: number, notDir: 'h' | 'v' | null): Tree[] => {
		const key = `${from},${to},${notDir ?? ''}`;
		const cached = memo.get(key);
		if (cached) return cached;
		const out: Tree[] = [];
		if (to - from === 1) {
			out.push(from);
		} else {
			for (const dir of ['h', 'v'] as const) {
				if (dir === notDir) continue;
				for (let split = from + 1; split < to; split++) {
					for (const left of build(from, split, dir)) {
						for (const right of build(split, to, null)) {
							out.push({ dir, children: [left, right] });
						}
					}
				}
			}
		}
		memo.set(key, out);
		return out;
	};
	return build(0, n, null);
}

/** Column shapes: a single tile, or a slicing tree whose root is a stack. */
const COLUMNS: { tree: Tree; count: number }[] = [];
for (let n = 1; n <= MAX_COLUMN_TILES; n++) {
	for (const tree of slicingTrees(n)) {
		if (typeof tree === 'number' || tree.dir === 'v') COLUMNS.push({ tree, count: n });
	}
}

/** Width = a * height - b for a subtree, given its leaves' ratios. */
interface Linear {
	a: number;
	b: number;
}

function linear(tree: Tree, first: number, ratio: (i: number) => number, gap: number): Linear {
	if (typeof tree === 'number') return { a: ratio(first + tree), b: 0 };
	const [l, r] = tree.children;
	const p = linear(l, first, ratio, gap);
	const q = linear(r, first, ratio, gap);
	if (tree.dir === 'h') return { a: p.a + q.a, b: p.b + q.b - gap };
	// Stacked: a shared width w gives child heights (w + b) / a.
	const a = 1 / (1 / p.a + 1 / q.a);
	return { a, b: a * (gap + p.b / p.a + q.b / q.a) };
}

/** Writes each leaf's box into `out`, splitting so every tile keeps its shape. */
function place(
	tree: Tree,
	first: number,
	box: Box,
	ratio: (i: number) => number,
	gap: number,
	out: Box[],
): void {
	if (typeof tree === 'number') {
		out[first + tree] = box;
		return;
	}
	const [l, r] = tree.children;
	const p = linear(l, first, ratio, gap);
	const q = linear(r, first, ratio, gap);
	if (tree.dir === 'h') {
		const wl = p.a * box.height - p.b;
		const wr = q.a * box.height - q.b;
		const scale = (box.width - gap) / (wl + wr || 1);
		const w = wl * scale;
		place(l, first, { x: box.x, y: box.y, width: w, height: box.height }, ratio, gap, out);
		place(r, first, { x: box.x + w + gap, y: box.y, width: box.width - w - gap, height: box.height }, ratio, gap, out);
		return;
	}
	const hl = (box.width + p.b) / p.a;
	const hr = (box.width + q.b) / q.a;
	const scale = (box.height - gap) / (hl + hr || 1);
	const h = hl * scale;
	place(l, first, { x: box.x, y: box.y, width: box.width, height: h }, ratio, gap, out);
	place(r, first, { x: box.x, y: box.y + h + gap, width: box.width, height: box.height - h - gap }, ratio, gap, out);
}

/** A partial band: columns so far, as a linked list (last first). */
interface Path {
	column: number;
	parent: Path | null;
	columns: number;
	singles: number;
	a: number;
	b: number;
	/** Estimated cost at TYPICAL_BAND height, for ranking only. */
	estimate: number;
}

function columnsOf(path: Path): number[] {
	const out: number[] = [];
	for (let p: Path | null = path; p && p.columns > 0; p = p.parent) out.push(p.column);
	return out.reverse();
}

/** Beam of partial bands for one length, with its worst entry tracked. */
interface Beam {
	paths: Path[];
	worst: number;
	worstEstimate: number;
}

/** Whether a path with this estimate would get into the beam. */
function admits(beam: Beam | undefined, estimate: number): boolean {
	return !beam || beam.paths.length < BEAM || estimate < beam.worstEstimate;
}

function keep(beams: Beam[], len: number, path: Path): void {
	let beam = beams[len];
	if (!beam) beams[len] = beam = { paths: [], worst: 0, worstEstimate: -Infinity };
	if (beam.paths.length < BEAM) {
		beam.paths.push(path);
	} else if (path.estimate < beam.worstEstimate) {
		beam.paths[beam.worst] = path;
	} else {
		return;
	}
	if (beam.paths.length < BEAM) {
		if (path.estimate > beam.worstEstimate) {
			beam.worstEstimate = path.estimate;
			beam.worst = beam.paths.length - 1;
		}
		return;
	}
	beam.worst = 0;
	beam.worstEstimate = beam.paths[0]?.estimate ?? 0;
	for (let k = 1; k < beam.paths.length; k++) {
		const e = beam.paths[k]?.estimate ?? 0;
		if (e > beam.worstEstimate) {
			beam.worstEstimate = e;
			beam.worst = k;
		}
	}
}

export function mosaic(items: readonly MosaicItem[], options: MosaicOptions): MosaicLayout {
	const n = items.length;
	const width = Math.max(1, options.width);
	const gap = Math.max(0, options.gap);
	const tile = Math.max(16, options.tileSize);
	const minTile = Math.max(0, options.minTileSize ?? 0);
	const minBand = tile * MIN_BAND;
	const maxBand = Math.max(minBand, Math.min(tile * MAX_BAND, options.maxTileHeight ?? Infinity));

	const ratio = (i: number): number => safeRatio(items[i]?.ratio);
	const target = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const size = clamp(Math.round(items[i]?.size ?? 1), 0, 2);
		target[i] = tile * tile * (AREA_BY_SIZE[size] ?? 1);
	}
	const scratch: Box[] = new Array<Box>(n);

	/**
	 * Every leaf's width and height is an affine function of the band height
	 * (slicing trees only add, scale and divide by constants), so each is
	 * stored as two coefficient pairs, found by placing the column at two
	 * heights. Costing a column at any height is then allocation-free.
	 */
	const colA: Float64Array[] = [];
	const colB: Float64Array[] = [];
	const colLeaves: Float64Array[] = [];
	const colEstimate: Float64Array[] = [];
	const h1 = tile * 2;
	const h2 = tile * 3;

	const columnCost = (c: number, first: number, height: number): number => {
		const shape = COLUMNS[c];
		const leaves = colLeaves[c];
		if (!shape || !leaves) return INFEASIBLE;
		const base = first * MAX_COLUMN_TILES * 4;
		let cost = 0;
		for (let k = 0; k < shape.count; k++) {
			const o = base + k * 4;
			const w = (leaves[o] ?? 0) * height + (leaves[o + 1] ?? 0);
			const h = (leaves[o + 2] ?? 0) * height + (leaves[o + 3] ?? 0);
			if (w <= 0 || h <= 0) return INFEASIBLE;
			if (h < minTile || w * h < minTile * minTile) return INFEASIBLE;
			const d = Math.log((w * h) / (target[first + k] ?? 1));
			cost += d * d;
		}
		return cost;
	};

	COLUMNS.forEach((shape, c) => {
		const a = new Float64Array(n);
		const b = new Float64Array(n);
		const leaves = new Float64Array(n * MAX_COLUMN_TILES * 4);
		const e = new Float64Array(n).fill(INFEASIBLE);
		colA.push(a);
		colB.push(b);
		colLeaves.push(leaves);
		colEstimate.push(e);
		for (let i = 0; i + shape.count <= n; i++) {
			const lin = linear(shape.tree, i, ratio, gap);
			a[i] = lin.a;
			b[i] = lin.b;
			place(shape.tree, i, { x: 0, y: 0, width: lin.a * h1 - lin.b, height: h1 }, ratio, gap, scratch);
			const first = scratch.slice(i, i + shape.count);
			place(shape.tree, i, { x: 0, y: 0, width: lin.a * h2 - lin.b, height: h2 }, ratio, gap, scratch);
			for (let k = 0; k < shape.count; k++) {
				const p1 = first[k];
				const p2 = scratch[i + k];
				if (!p1 || !p2) continue;
				const o = i * MAX_COLUMN_TILES * 4 + k * 4;
				const sw = (p2.width - p1.width) / (h2 - h1);
				const sh = (p2.height - p1.height) / (h2 - h1);
				leaves[o] = sw;
				leaves[o + 1] = p1.width - sw * h1;
				leaves[o + 2] = sh;
				leaves[o + 3] = p1.height - sh * h1;
			}
			e[i] = columnCost(c, i, tile * TYPICAL_BAND);
		}
	});

	/** Exact cost of a full band, and its height. */
	const bandFit = (path: Path, start: number, last: boolean): { cost: number; height: number; ragged: boolean } => {
		const k = path.columns;
		const natural = (width - gap * (k - 1) + path.b) / path.a;
		let height = natural;
		let ragged = false;
		if (natural > maxBand || natural < minBand) {
			// A panorama alone in its band may be shorter than usual.
			if (natural < minBand && k === 1 && path.singles === 1 && natural >= minTile) {
				return { cost: BAND_PENALTY + 1, height: natural, ragged: false };
			}
			if (!(last && natural > maxBand)) return { cost: INFEASIBLE, height, ragged };
			// A short last band is a plain row, left-aligned, never a lone stack.
			if (path.singles !== k) return { cost: INFEASIBLE, height, ragged };
			// A short last band stays at a typical height without filling the width.
			height = tile * TYPICAL_BAND;
			ragged = true;
		}
		let cost = BAND_PENALTY;
		let i = start;
		let previous = -1;
		for (const c of columnsOf(path)) {
			const cc = columnCost(c, i, height);
			if (cc >= INFEASIBLE) return { cost: INFEASIBLE, height, ragged };
			cost += cc;
			if (c === previous && (COLUMNS[c]?.count ?? 1) > 1) cost += SAME_NEIGHBOUR_PENALTY;
			previous = c;
			i += COLUMNS[c]?.count ?? 1;
		}
		if (k > 1 && path.singles === k) cost += PLAIN_ROW_PENALTY;
		return { cost, height, ragged };
	};

	const best = new Float64Array(n + 1).fill(Infinity);
	const from = new Int32Array(n + 1).fill(-1);
	const chosen: (Path | null)[] = new Array<Path | null>(n + 1).fill(null);
	best[0] = 0;

	for (let start = 0; start < n; start++) {
		const base = best[start] ?? Infinity;
		if (base === Infinity) continue;
		const root: Path = { column: -1, parent: null, columns: 0, singles: 0, a: 0, b: 0, estimate: 0 };
		const byLength: Beam[] = [{ paths: [root], worst: 0, worstEstimate: 0 }];
		for (let len = 0; len < MAX_BAND_TILES && start + len < n; len++) {
			for (const path of byLength[len]?.paths ?? []) {
				const k = path.columns;
				// Already wider than the gallery at the lowest band height.
				if (k > 0 && path.a * minBand - path.b + gap * (k - 1) > width) continue;
				const first = start + len;
				for (let c = 0; c < COLUMNS.length; c++) {
					const shape = COLUMNS[c];
					if (!shape) continue;
					if (len + shape.count > MAX_BAND_TILES || first + shape.count > n) continue;
					const columnEstimate = colEstimate[c]?.[first] ?? INFEASIBLE;
					if (columnEstimate >= INFEASIBLE) continue;
					const estimate = path.estimate + columnEstimate;
					if (!admits(byLength[len + shape.count], estimate)) continue;
					keep(byLength, len + shape.count, {
						column: c,
						parent: path,
						columns: k + 1,
						singles: path.singles + (shape.count === 1 ? 1 : 0),
						a: path.a + (colA[c]?.[first] ?? 0),
						b: path.b + (colB[c]?.[first] ?? 0),
						estimate,
					});
				}
			}
		}
		for (let len = 1; len < byLength.length; len++) {
			const end = start + len;
			for (const path of byLength[len]?.paths ?? []) {
				const { cost } = bandFit(path, start, end === n);
				if (cost >= INFEASIBLE) continue;
				if (base + cost < (best[end] ?? Infinity)) {
					best[end] = base + cost;
					from[end] = start;
					chosen[end] = path;
				}
			}
		}
		// Nothing fits from here: fall back to a lone tile so the layout completes.
		if ((best[start + 1] ?? Infinity) === Infinity) {
			best[start + 1] = base + INFEASIBLE;
			from[start + 1] = start;
			chosen[start + 1] = {
				column: 0,
				parent: root,
				columns: 1,
				singles: 1,
				a: colA[0]?.[start] ?? 1,
				b: 0,
				estimate: 0,
			};
		}
	}

	const bands: { start: number; path: Path; end: number }[] = [];
	for (let end = n; end > 0; ) {
		const start = from[end] ?? -1;
		const path = chosen[end];
		if (start < 0 || !path) break;
		bands.push({ start, path, end });
		end = start;
	}
	bands.reverse();

	const boxes: Box[] = new Array<Box>(n);
	let y = 0;
	for (const { start, path, end } of bands) {
		const fit = bandFit(path, start, end === n);
		const natural = (width - gap * (path.columns - 1) + path.b) / path.a;
		// The fallback (nothing else fit) keeps the full width so there are no
		// holes, unless that would be taller than the pane allows.
		let height = fit.cost >= INFEASIBLE ? natural : fit.height;
		let ragged = fit.ragged;
		if (height > maxBand) {
			height = maxBand;
			ragged = true;
		}
		const columns = columnsOf(path);
		let x = 0;
		let i = start;
		columns.forEach((c, index) => {
			const shape = COLUMNS[c];
			if (!shape) return;
			let w = (colA[c]?.[i] ?? 1) * height - (colB[c]?.[i] ?? 0);
			if (index === columns.length - 1 && !ragged) w = Math.max(0, width - x);
			place(shape.tree, i, { x, y, width: w, height }, ratio, gap, boxes);
			x += w + gap;
			i += shape.count;
		});
		y += height + gap;
	}
	return { boxes, height: bands.length > 0 ? y - gap : 0 };
}

function safeRatio(ratio: number | undefined): number {
	return ratio !== undefined && Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
