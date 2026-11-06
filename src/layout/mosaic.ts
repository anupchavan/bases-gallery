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

	const best = new Float64Array(n + 1).fill(Infinity);
	const choice: (Path | null)[] = new Array<Path | null>(n + 1).fill(null);
	const from = new Int32Array(n + 1);
	best[0] = 0;

	for (let start = 0; start < n; start++) {
		const base = best[start] ?? Infinity;
		if (base === Infinity) continue;

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
			for (const path of byLength[len] ?? []) {
				const total = base + fitRow(path, end === n).cost + path.choiceCost + variety(path);
				if (total < (best[end] ?? Infinity)) {
					best[end] = total;
					choice[end] = path;
					from[end] = start;
				}
			}
		}
	}

	const rows: { start: number; path: Path; end: number }[] = [];
	for (let end = n; end > 0; ) {
		const path = choice[end];
		if (!path) break;
		const start = from[end] ?? 0;
		rows.push({ start, path, end });
		end = start;
	}
	rows.reverse();

	const boxes: Box[] = new Array<Box>(n);
	let y = 0;
	for (const { start, path, end } of rows) {
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

	return { boxes, height: rows.length > 0 ? y - gap : 0 };
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
