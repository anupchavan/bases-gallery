/**
 * Mosaic layout.
 *
 * Two published ideas combined:
 * - Row breaking is Knuth-Plass style dynamic programming, as in the Google
 *   Photos web grid ("FlexLayout"): every permissible set of rows is
 *   considered and the one with the least total badness wins.
 * - Each row is a sequence of blocks, and a block is a small slicing
 *   (guillotine) tree of tiles, as in BRIC-style photo collages: a single
 *   tile, a stack of two or three, a pair over a single (or the reverse), or
 *   a 2x2. In a slicing tree every tile keeps its exact aspect ratio and the
 *   block is a perfect rectangle, so rows have no holes and no ragged edges.
 *
 * The cost of a row combines how far its height is from the target, how much
 * it had to crop (never past the cap), and preferences from the size
 * property (large tiles stand alone, small tiles go into blocks).
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
	/** Height a row aims for, in px. */
	rowHeight: number;
	/** Space between tiles, in px (both directions). */
	gap: number;
	/** Largest share of a tile's width or height cropped on each side, 0 to 0.25. */
	maxCropPerSide: number;
	/** Only single tiles per block: plain justified rows. */
	singlesOnly?: boolean;
	/** No tile in a block may be shorter or narrower than this, in px. */
	minTileSize?: number;
}

export interface MosaicLayout {
	boxes: Box[];
	height: number;
}

/**
 * A slicing tree. In a horizontal node children share a height and sit side
 * by side; in a vertical node they share a width and stack.
 */
type Tree = number | { dir: 'h' | 'v'; children: Tree[] };

/** Block templates. Leaf numbers are offsets into the block's tiles. */
const TEMPLATES: { tree: Tree; count: number; penalty: number }[] = [
	{ tree: 0, count: 1, penalty: 0 },
	{ tree: { dir: 'v', children: [0, 1] }, count: 2, penalty: 0.02 },
	{ tree: { dir: 'v', children: [0, 1, 2] }, count: 3, penalty: 0.08 },
	{ tree: { dir: 'v', children: [{ dir: 'h', children: [0, 1] }, 2] }, count: 3, penalty: 0.06 },
	{ tree: { dir: 'v', children: [0, { dir: 'h', children: [1, 2] }] }, count: 3, penalty: 0.06 },
	{
		tree: {
			dir: 'v',
			children: [
				{ dir: 'h', children: [0, 1] },
				{ dir: 'h', children: [2, 3] },
			],
		},
		count: 4,
		penalty: 0.1,
	},
];

/** Leaf depth per template, for size preferences. */
const DEPTHS: number[][] = TEMPLATES.map((t) => leafDepths(t.tree, t.count));

const MAX_ROW_ITEMS = 14;
/** How far a row's height may move from the target, as a share of it. */
const HEIGHT_TOLERANCE = 0.3;
/** Partial rows kept per length while searching (a beam). */
const BEAM = 6;
const INFEASIBLE = 1e6;

/** Feature bands: one big tile beside this many sub-rows. */
const FEATURE_ROWS = [2, 3];
const MAX_SUBROW_ITEMS = 4;
/** Width a feature tile takes, as a share of the gallery. */
const FEATURE_MIN_SHARE = 0.3;
const FEATURE_MAX_SHARE = 0.7;
const FEATURE_PENALTY = 0.05;
/** Rhythm: at least this many plain rows between features, and a cost per row past the max. */
const MIN_FEATURE_GAP = 2;
const MAX_FEATURE_GAP = 4;
const LATE_FEATURE_PENALTY = 0.25;
const CADENCE_STATES = 6;

type Band = { kind: 'row'; path: Path } | { kind: 'feature'; lens: number[] };

/**
 * Every block and row has width = a * height - b, with a and b fixed by its
 * tiles and gaps. That makes fitting a row a one-unknown equation.
 */
interface Linear {
	a: number;
	b: number;
}

/** A partial row, as a linked list of blocks (last block first). */
interface Path {
	template: number;
	parent: Path | null;
	blocks: number;
	singles: number;
	a: number;
	b: number;
	choiceCost: number;
}

function blocksOf(path: Path): number[] {
	const out: number[] = [];
	for (let p: Path | null = path; p && p.blocks > 0; p = p.parent) out.push(p.template);
	return out.reverse();
}

export function mosaic(items: readonly MosaicItem[], options: MosaicOptions): MosaicLayout {
	const n = items.length;
	const width = Math.max(1, options.width);
	const target = Math.max(1, options.rowHeight);
	const gap = Math.max(0, options.gap);
	const crop = clamp(options.maxCropPerSide, 0, 0.25);
	const minStretch = 1 - 2 * crop;
	const maxStretch = 1 / minStretch;
	const minHeight = target * (1 - HEIGHT_TOLERANCE);
	const maxHeight = target * (1 + HEIGHT_TOLERANCE);
	const templates = options.singlesOnly ? 1 : TEMPLATES.length;

	const ratio = (i: number): number => safeRatio(items[i]?.ratio);
	const size = (i: number): number => clamp(Math.round(items[i]?.size ?? 1), 0, 2);

	const minTile = Math.max(0, options.minTileSize ?? 0);
	const scratch: Box[] = new Array<Box>(n);
	// Per position and template: the block's width line and its size cost.
	const blockA: Float64Array[] = [];
	const blockB: Float64Array[] = [];
	const blockCost: Float64Array[] = [];
	for (let t = 0; t < templates; t++) {
		const template = TEMPLATES[t];
		const depths = DEPTHS[t];
		const a = new Float64Array(n);
		const b = new Float64Array(n);
		const c = new Float64Array(n);
		if (template && depths) {
			for (let i = 0; i + template.count <= n; i++) {
				const lin = linear(template.tree, i, ratio, gap);
				a[i] = lin.a;
				b[i] = lin.b;
				let cost = template.penalty;
				// Legibility: try the block at the lowest row height and most cropping it could get.
				if (template.count > 1 && minTile > 0) {
					const blockWidth = (lin.a * minHeight - lin.b) * minStretch;
					place(template.tree, i, { x: 0, y: 0, width: blockWidth, height: minHeight }, ratio, gap, scratch);
					for (let leaf = 0; leaf < template.count; leaf++) {
						const box = scratch[i + leaf];
						if (!box || box.height < minTile || box.width < minTile) cost = INFEASIBLE;
					}
				}
				for (let leaf = 0; leaf < template.count; leaf++) {
					cost += sizeCost(size(i + leaf), depths[leaf] ?? 0);
				}
				c[i] = cost;
			}
		}
		blockA.push(a);
		blockB.push(b);
		blockCost.push(c);
	}

	const fitRow = (
		path: Path,
		last: boolean,
	): { cost: number; height: number; stretch: number; ragged: boolean } => {
		const k = path.blocks;
		const free = width - gap * (k - 1);
		// a * h - b = free
		const natural = (free + path.b) / path.a;
		if (natural >= minHeight && natural <= maxHeight) {
			return { cost: deviation(natural, target), height: natural, stretch: 1, ragged: false };
		}
		if (last && natural > maxHeight) {
			// A short last row stays at the target height. Mildly penalised so
			// earlier rows rebalance to give it company.
			const used = path.a * target - path.b + gap * (k - 1);
			const empty = 1 - used / width;
			return { cost: 0.6 * empty * empty, height: target, stretch: 1, ragged: true };
		}
		const height = natural > maxHeight ? maxHeight : minHeight;
		const stretch = free / (path.a * height - path.b);
		if (stretch >= minStretch && stretch <= maxStretch) {
			return {
				cost: deviation(height, target) + 2 * (stretch - 1) ** 2,
				height,
				stretch,
				ragged: false,
			};
		}
		if (natural < minHeight) {
			// Too wide even with cropping (a panorama): shrink, never crop more.
			return { cost: deviation(natural, target) + 0.5, height: natural, stretch: 1, ragged: false };
		}
		// Too narrow even with cropping: keep shapes, leave the row unfilled.
		return { cost: INFEASIBLE, height: target, stretch: 1, ragged: true };
	};

	// Prefix sums of ratios, for sub-rows of feature bands.
	const prefix = new Float64Array(n + 1);
	for (let i = 0; i < n; i++) prefix[i + 1] = (prefix[i] ?? 0) + ratio(i);
	const ratioSum = (from: number, to: number): number => (prefix[to] ?? 0) - (prefix[from] ?? 0);

	/**
	 * A feature band: tile `start` spans the whole band, next to a column of
	 * `lens.length` justified sub-rows. Solving the slicing tree
	 * H(feature, V(row, row, ...)) for the band height H:
	 *   H = ((W - g) S - Q + (k - 1) g) / (1 + r S)
	 * with S = sum 1/A_j and Q = sum G_j/A_j over sub-rows (A_j: ratio sum,
	 * G_j: gaps in the sub-row) and r the feature's ratio.
	 */
	const fitFeature = (start: number, lens: number[]): number => {
		const k = lens.length;
		let S = 0;
		let Q = 0;
		let i = start + 1;
		for (const len of lens) {
			const A = ratioSum(i, i + len);
			S += 1 / A;
			Q += ((len - 1) * gap) / A;
			i += len;
		}
		const r = ratio(start);
		const H = ((width - gap) * S - Q + (k - 1) * gap) / (1 + r * S);
		const featureWidth = r * H;
		const column = width - gap - featureWidth;
		if (column <= 0) return INFEASIBLE;
		// The feature should read as big: a third to two thirds of the width.
		if (featureWidth < width * FEATURE_MIN_SHARE || featureWidth > width * FEATURE_MAX_SHARE) {
			return INFEASIBLE;
		}
		let cost = 0;
		i = start + 1;
		for (const len of lens) {
			const h = (column - (len - 1) * gap) / ratioSum(i, i + len);
			if (h < minHeight || h > maxHeight) return INFEASIBLE;
			cost += deviation(h, target);
			for (let j = i; j < i + len; j++) if (size(j) === 2) cost += 0.3;
			i += len;
		}
		const featureSize = size(start);
		if (featureSize === 2) cost -= 0.3;
		else if (featureSize === 0) cost += 1;
		return cost;
	};

	// Dynamic programming over (tiles placed, bands since the last feature).
	const states = CADENCE_STATES;
	const best = new Float64Array((n + 1) * states).fill(Infinity);
	const backFrom = new Int32Array((n + 1) * states).fill(-1);
	const backState = new Int8Array((n + 1) * states);
	const backBand: (Band | null)[] = new Array<Band | null>((n + 1) * states).fill(null);
	best[MIN_FEATURE_GAP] = 0;

	for (let start = 0; start < n; start++) {
		let any = false;
		for (let c = 0; c < states; c++) if ((best[start * states + c] ?? Infinity) < Infinity) any = true;
		if (!any) continue;

		const candidates: { end: number; cost: number; band: Band }[] = [];

		// Plain rows of blocks: keep the cheapest row per end.
		const root: Path = {
			template: -1,
			parent: null,
			blocks: 0,
			singles: 0,
			a: 0,
			b: 0,
			choiceCost: 0,
		};
		const byLength: Path[][] = [[root]];
		for (let len = 0; len < MAX_ROW_ITEMS && start + len < n; len++) {
			for (const path of byLength[len] ?? []) {
				const k = path.blocks;
				// Already wider than the container at the lowest height and the
				// most cropping allowed: adding blocks only makes it worse.
				if (k > 0 && (path.a * minHeight - path.b + gap * (k - 1)) * minStretch > width) continue;
				const first = start + len;
				for (let t = 0; t < templates; t++) {
					const count = TEMPLATES[t]?.count ?? 1;
					if (len + count > MAX_ROW_ITEMS || first + count > n) continue;
					keep(byLength, len + count, {
						template: t,
						parent: path,
						blocks: k + 1,
						singles: path.singles + (t === 0 ? 1 : 0),
						a: path.a + (blockA[t]?.[first] ?? 0),
						b: path.b + (blockB[t]?.[first] ?? 0),
						choiceCost: path.choiceCost + (blockCost[t]?.[first] ?? 0),
					});
				}
			}
		}
		for (let len = 1; len < byLength.length; len++) {
			const end = start + len;
			let bestPath: Path | null = null;
			let bestCost = Infinity;
			for (const path of byLength[len] ?? []) {
				const cost = fitRow(path, end === n).cost + path.choiceCost + variety(path);
				if (cost < bestCost) {
					bestCost = cost;
					bestPath = path;
				}
			}
			if (bestPath) candidates.push({ end, cost: bestCost, band: { kind: 'row', path: bestPath } });
		}

		// Feature bands.
		if (!options.singlesOnly) {
			for (const k of FEATURE_ROWS) {
				const lens = new Array<number>(k).fill(1);
				const visit = (row: number, used: number): void => {
					if (row === k) {
						const end = start + 1 + used;
						if (end > n) return;
						const cost = fitFeature(start, lens);
						if (cost < INFEASIBLE) {
							candidates.push({ end, cost: cost + FEATURE_PENALTY, band: { kind: 'feature', lens: [...lens] } });
						}
						return;
					}
					for (let len = 1; len <= MAX_SUBROW_ITEMS; len++) {
						if (start + 1 + used + len > n) break;
						lens[row] = len;
						visit(row + 1, used + len);
					}
				};
				visit(0, 0);
			}
		}

		for (let c = 0; c < states; c++) {
			const base = best[start * states + c] ?? Infinity;
			if (base === Infinity) continue;
			for (const { end, cost, band } of candidates) {
				let next: number;
				let total = base + cost;
				if (band.kind === 'feature') {
					if (c < MIN_FEATURE_GAP && size(start) !== 2) continue;
					next = 0;
				} else {
					next = Math.min(c + 1, states - 1);
					if (c + 1 > MAX_FEATURE_GAP) total += LATE_FEATURE_PENALTY;
				}
				const slot = end * states + next;
				if (total < (best[slot] ?? Infinity)) {
					best[slot] = total;
					backFrom[slot] = start;
					backState[slot] = c;
					backBand[slot] = band;
				}
			}
		}
	}

	let state = 0;
	for (let c = 1; c < states; c++) {
		if ((best[n * states + c] ?? Infinity) < (best[n * states + state] ?? Infinity)) state = c;
	}
	const bands: { start: number; end: number; band: Band }[] = [];
	for (let end = n; end > 0; ) {
		const slot = end * states + state;
		const band = backBand[slot];
		const start = backFrom[slot] ?? -1;
		if (!band || start < 0) break;
		bands.push({ start, end, band });
		state = backState[slot] ?? 0;
		end = start;
	}
	bands.reverse();

	const boxes: Box[] = new Array<Box>(n);
	let y = 0;
	let features = 0;
	for (const { start, end, band } of bands) {
		if (band.kind === 'feature') {
			// Alternate the big tile between the left and right edges.
			const rows: Tree[] = [];
			let offset = 1;
			for (const len of band.lens) {
				rows.push({ dir: 'h', children: Array.from({ length: len }, (_, j) => offset + j) });
				offset += len;
			}
			const column: Tree = { dir: 'v', children: rows };
			const tree: Tree = { dir: 'h', children: features % 2 === 0 ? [0, column] : [column, 0] };
			const lin = linear(tree, start, ratio, gap);
			const height = (width + lin.b) / lin.a;
			place(tree, start, { x: 0, y, width, height }, ratio, gap, boxes);
			features++;
			y += height + gap;
			continue;
		}
		const { path } = band;
		const { height, stretch, ragged } = fitRow(path, end === n);
		let x = 0;
		let i = start;
		const blocks = blocksOf(path);
		blocks.forEach((t, index) => {
			const template = TEMPLATES[t];
			if (!template) return;
			const lin = linear(template.tree, i, ratio, gap);
			let blockWidth = (lin.a * height - lin.b) * stretch;
			if (index === blocks.length - 1 && !ragged) blockWidth = Math.max(0, width - x);
			place(template.tree, i, { x, y, width: blockWidth, height }, ratio, gap, boxes);
			x += blockWidth + gap;
			i += template.count;
		});
		y += height + gap;
	}

	return { boxes, height: bands.length > 0 ? y - gap : 0 };
}

/** Width = a * height - b for a subtree whose first tile is `first`. */
function linear(tree: Tree, first: number, ratio: (i: number) => number, gap: number): Linear {
	if (typeof tree === 'number') return { a: ratio(first + tree), b: 0 };
	const parts = tree.children.map((child) => linear(child, first, ratio, gap));
	const between = gap * (parts.length - 1);
	if (tree.dir === 'h') {
		let a = 0;
		let b = -between;
		for (const p of parts) {
			a += p.a;
			b += p.b;
		}
		return { a, b };
	}
	// Vertical: children share a width w, and a child's height is (w + b) / a.
	let inv = 0;
	let offset = between;
	for (const p of parts) {
		inv += 1 / p.a;
		offset += p.b / p.a;
	}
	const a = 1 / inv;
	return { a, b: a * offset };
}

/** Positions a subtree's tiles inside `box`, splitting so each keeps its shape. */
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
	const parts = tree.children.map((child) => linear(child, first, ratio, gap));
	const between = gap * (parts.length - 1);
	if (tree.dir === 'h') {
		const natural = parts.map((p) => Math.max(0, p.a * box.height - p.b));
		const sum = natural.reduce((s, w) => s + w, 0) || 1;
		const scale = (box.width - between) / sum;
		let x = box.x;
		tree.children.forEach((child, k) => {
			const w = (natural[k] ?? 0) * scale;
			place(child, first, { x, y: box.y, width: w, height: box.height }, ratio, gap, out);
			x += w + gap;
		});
		return;
	}
	const natural = parts.map((p) => (box.width + p.b) / p.a);
	const sum = natural.reduce((s, h) => s + h, 0) || 1;
	const scale = (box.height - between) / sum;
	let y = box.y;
	tree.children.forEach((child, k) => {
		const h = (natural[k] ?? 0) * scale;
		place(child, first, { x: box.x, y, width: box.width, height: h }, ratio, gap, out);
		y += h + gap;
	});
}

/** Keeps the cheapest BEAM partial rows per length. */
function keep(byLength: Path[][], len: number, path: Path): void {
	const list = (byLength[len] ??= []);
	if (list.length < BEAM) {
		list.push(path);
		return;
	}
	let worst = 0;
	for (let k = 1; k < list.length; k++) {
		if ((list[k]?.choiceCost ?? 0) > (list[worst]?.choiceCost ?? 0)) worst = k;
	}
	if (path.choiceCost < (list[worst]?.choiceCost ?? Infinity)) list[worst] = path;
}

/** Large tiles want to stand alone; small ones are happy deeper in a block. */
function sizeCost(size: number, depth: number): number {
	if (depth === 0) return size === 0 ? 0.06 : 0;
	if (size === 2) return 0.5 * depth;
	if (size === 0) return 0;
	return 0.02 * depth;
}

/** Nudges rows away from being plain rows or all blocks. */
function variety(path: Path): number {
	const k = path.blocks;
	if (k <= 1) return 0;
	if (path.singles === k || path.singles === 0) return 0.04;
	return 0;
}

function leafDepths(tree: Tree, count: number): number[] {
	const out = new Array<number>(count).fill(0);
	const walk = (node: Tree, depth: number): void => {
		if (typeof node === 'number') out[node] = depth;
		else for (const child of node.children) walk(child, depth + 1);
	};
	walk(tree, 0);
	return out;
}

function deviation(height: number, target: number): number {
	const d = (height - target) / target;
	return d * d;
}

function safeRatio(ratio: number | undefined): number {
	return ratio !== undefined && Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
