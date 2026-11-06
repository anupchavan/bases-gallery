/**
 * Mosaic: full-width rows built from two kinds of block, a single tile or a
 * stack of two tiles on top of each other. Every block in a row shares the
 * row's height, so the mosaic has no holes and no ragged edges (except a
 * short last row). Each tile keeps its own aspect ratio, within the crop cap,
 * so stacked tiles come out smaller and single tiles larger: sizes vary
 * across rows and columns without a fixed grid.
 *
 * Row breaks and which neighbours get stacked are chosen together by dynamic
 * programming over a bounded window.
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
}

export interface MosaicLayout {
	boxes: Box[];
	height: number;
}

/** Bounds on tiles per row; the real cap scales with how many fit across. */
const MIN_ROW_ITEMS = 4;
const MAX_ROW_ITEMS = 12;
/** How far a row's height may move from the target, as a share of it. */
const HEIGHT_TOLERANCE = 0.3;
/** Paths kept per row end while searching block splits. */
const MAX_PATHS = 16;

const INFEASIBLE = 1e6;

/** A partial row: blocks chosen so far for tiles [start, end). */
interface Path {
	/** Bit k set when the block starting at tile start + k is a stack. */
	stacks: number;
	blocks: number;
	/** Row width = height * sumA - sumB + gaps; see rowHeight(). */
	sumA: number;
	sumB: number;
	/** Cost of block choices that doesn't depend on row height. */
	choiceCost: number;
}

export function mosaic(
	items: readonly MosaicItem[],
	options: MosaicOptions,
): MosaicLayout {
	const n = items.length;
	const width = Math.max(1, options.width);
	const target = Math.max(1, options.rowHeight);
	const gap = Math.max(0, options.gap);
	const crop = clamp(options.maxCropPerSide, 0, 0.25);
	const minStretch = 1 - 2 * crop;
	const maxStretch = 1 / minStretch;
	const minHeight = target * (1 - HEIGHT_TOLERANCE);
	const maxHeight = target * (1 + HEIGHT_TOLERANCE);
	// A row rarely holds more blocks than fit at a narrow 0.5 ratio, and a
	// stack holds two tiles.
	const maxRowItems = clamp(
		Math.ceil((width / (target * 0.5)) * 1.5),
		MIN_ROW_ITEMS,
		MAX_ROW_ITEMS,
	);

	const ratio = (i: number): number => safeRatio(items[i]?.ratio);
	const size = (i: number): number => clamp(Math.round(items[i]?.size ?? 1), 0, 2);

	/** Cost of a finished row given its block sums, or INFEASIBLE. */
	const rowCost = (path: Path, last: boolean): number => {
		const free = width - gap * (path.blocks - 1);
		// height * sumA - sumB = free
		const natural = (free + path.sumB) / path.sumA;
		let cost = path.choiceCost;
		if (natural >= minHeight && natural <= maxHeight) {
			return cost + deviation(natural, target);
		}
		if (last && natural > maxHeight) {
			// A short last row: left at the target height. Mildly penalised so
			// earlier rows rebalance to give it company.
			const used = target * path.sumA - path.sumB + gap * (path.blocks - 1);
			const emptyShare = 1 - used / width;
			return cost + 0.6 * emptyShare * emptyShare;
		}
		const height = natural > maxHeight ? maxHeight : minHeight;
		const stretch = free / (height * path.sumA - path.sumB);
		if (stretch >= minStretch && stretch <= maxStretch) {
			cost += deviation(height, target) + 2 * (stretch - 1) ** 2;
			return cost;
		}
		return INFEASIBLE + cost + deviation(natural, target);
	};

	const best = new Float64Array(n + 1).fill(Infinity);
	const choice: (Path | null)[] = new Array<Path | null>(n + 1).fill(null);
	const from = new Int32Array(n + 1);
	best[0] = 0;

	for (let start = 0; start < n; start++) {
		const base = best[start] ?? Infinity;
		if (base === Infinity) continue;

		// Grow rows from `start`, block by block. paths[k] = rows covering k tiles.
		let frontier: Path[] = [
			{ stacks: 0, blocks: 0, sumA: 0, sumB: 0, choiceCost: 0 },
		];
		const byLength: Path[][] = [];
		byLength[0] = frontier;
		for (let len = 0; len < maxRowItems && start + len < n; len++) {
			frontier = byLength[len] ?? [];
			if (frontier.length === 0) continue;
			for (const path of frontier) {
				// A row already wider than the container at its lowest allowed
				// height (after the most cropping allowed) can only get worse.
				const minWidth =
					(path.sumA * minHeight - path.sumB + gap * (path.blocks - 1)) *
					minStretch;
				if (path.blocks > 0 && minWidth > width) continue;
				const i = start + len;
				// Single block.
				extend(byLength, len + 1, {
					stacks: path.stacks,
					blocks: path.blocks + 1,
					sumA: path.sumA + ratio(i),
					sumB: path.sumB,
					choiceCost: path.choiceCost + singleCost(size(i)),
				});
				// Stack of tiles i and i + 1.
				if (len + 2 <= maxRowItems && i + 1 < n) {
					const inv = 1 / ratio(i) + 1 / ratio(i + 1);
					extend(byLength, len + 2, {
						stacks: path.stacks | (1 << path.blocks),
						blocks: path.blocks + 1,
						sumA: path.sumA + 1 / inv,
						sumB: path.sumB + gap / inv,
						choiceCost:
							path.choiceCost +
							stackCost(size(i)) +
							stackCost(size(i + 1)),
					});
				}
			}
		}

		for (let len = 1; len < byLength.length; len++) {
			const end = start + len;
			for (const path of byLength[len] ?? []) {
				const cost = base + rowCost(path, end === n) + variety(path);
				if (cost < (best[end] ?? Infinity)) {
					best[end] = cost;
					choice[end] = path;
					from[end] = start;
				}
			}
		}
	}

	// Walk back to collect rows, then place them top to bottom.
	const rows: { start: number; end: number; path: Path }[] = [];
	for (let end = n; end > 0; ) {
		const path = choice[end];
		const start = from[end] ?? 0;
		if (!path) break;
		rows.push({ start, end, path });
		end = start;
	}
	rows.reverse();

	const boxes: Box[] = new Array<Box>(n);
	let y = 0;
	for (const { start, end, path } of rows) {
		const last = end === n;
		const free = width - gap * (path.blocks - 1);
		const natural = (free + path.sumB) / path.sumA;
		let height = natural;
		let stretch = 1;
		let ragged = false;
		if (natural < minHeight || natural > maxHeight) {
			if (last && natural > maxHeight) {
				height = target;
				ragged = true;
			} else {
				const clamped = natural > maxHeight ? maxHeight : minHeight;
				const s = free / (clamped * path.sumA - path.sumB);
				if (s >= minStretch && s <= maxStretch) {
					height = clamped;
					stretch = s;
				} else if (natural > maxHeight) {
					// Too narrow even with cropping: keep shapes, leave it unfilled.
					height = target;
					ragged = true;
				}
			}
		}

		let x = 0;
		let i = start;
		for (let b = 0; b < path.blocks; b++) {
			const isLastBlock = b === path.blocks - 1;
			const stacked = (path.stacks & (1 << b)) !== 0;
			let blockWidth: number;
			if (stacked) {
				const inv = 1 / ratio(i) + 1 / ratio(i + 1);
				blockWidth = ((height - gap) / inv) * stretch;
			} else {
				blockWidth = height * ratio(i) * stretch;
			}
			if (isLastBlock && !ragged) blockWidth = Math.max(0, width - x);

			if (stacked) {
				// Split the height so both tiles keep their shapes at this width.
				const h1 = ((height - gap) * (1 / ratio(i))) / (1 / ratio(i) + 1 / ratio(i + 1));
				boxes[i] = { x, y, width: blockWidth, height: h1 };
				boxes[i + 1] = {
					x,
					y: y + h1 + gap,
					width: blockWidth,
					height: height - h1 - gap,
				};
				i += 2;
			} else {
				boxes[i] = { x, y, width: blockWidth, height };
				i += 1;
			}
			x += blockWidth + gap;
		}
		y += height + gap;
	}

	return { boxes, height: rows.length > 0 ? y - gap : 0 };
}

/**
 * Keeps at most MAX_PATHS paths per row length (a beam): when full, a new
 * path replaces the most expensive one if it is cheaper.
 */
function extend(byLength: Path[][], len: number, path: Path): void {
	const list = (byLength[len] ??= []);
	if (list.length < MAX_PATHS) {
		list.push(path);
		return;
	}
	let worst = 0;
	for (let k = 1; k < list.length; k++) {
		if ((list[k]?.choiceCost ?? 0) > (list[worst]?.choiceCost ?? 0)) worst = k;
	}
	if (path.choiceCost < (list[worst]?.choiceCost ?? Infinity)) list[worst] = path;
}

/** Large tiles prefer standing alone; small ones prefer stacks. */
function singleCost(size: number): number {
	return size === 0 ? 0.06 : 0;
}

function stackCost(size: number): number {
	if (size === 2) return 0.5;
	if (size === 0) return 0;
	return 0.03;
}

/** Nudges rows away from being plain rows or all stacks. */
function variety(path: Path): number {
	if (path.blocks <= 1) return 0;
	const stacked = popcount(path.stacks);
	if (stacked === 0) return 0.04;
	if (stacked === path.blocks) return 0.04;
	return 0;
}

function deviation(height: number, target: number): number {
	const d = (height - target) / target;
	return d * d;
}

function popcount(n: number): number {
	let v = n >>> 0;
	let count = 0;
	while (v) {
		v &= v - 1;
		count++;
	}
	return count;
}

function safeRatio(ratio: number | undefined): number {
	return ratio !== undefined && Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
