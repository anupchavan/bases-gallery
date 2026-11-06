/**
 * Mosaic: a grid of small square cells where each tile spans as many
 * columns and rows as fits its shape and size, packed densely like CSS
 * `grid-auto-flow: dense`. Fine cells mean a span can match almost any
 * aspect ratio, so the crop cap rarely has to give.
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
	/** Edge of a square medium tile, in px. */
	tileSize: number;
	/** Space between tiles, in px (both directions). */
	gap: number;
	/** Largest share of a tile's width or height cropped on each side, 0 to 0.25. */
	maxCropPerSide: number;
}

export interface MosaicLayout {
	boxes: Box[];
	height: number;
	columns: number;
	/** Grid cells left empty above the last occupied row. */
	holes: number;
}

/** Cells per tile edge for a square medium tile. */
const CELLS_PER_TILE = 2;
const MAX_COLUMNS = 32;
const MAX_SPAN = 6;
/** Tile area in cells for each size class. */
const AREA_BY_SIZE = [2, 4, 9];
/**
 * How far above the lowest used row a tile may go to fill a gap. Older gaps
 * are left alone, which keeps placement fast and keeps tiles close to their
 * sort order.
 */
const LOOKBACK_ROWS = 12;
/** Alternative spans tried per tile when looking for the earliest gap. */
const CANDIDATES = 8;

interface Span {
	cols: number;
	rows: number;
	cost: number;
}

export function mosaic(
	items: readonly MosaicItem[],
	options: MosaicOptions,
): MosaicLayout {
	const gap = Math.max(0, options.gap);
	const width = Math.max(1, options.width);
	const cellTarget = Math.max(16, (options.tileSize - gap) / CELLS_PER_TILE);
	const columns = clamp(
		Math.round((width + gap) / (cellTarget + gap)),
		CELLS_PER_TILE,
		MAX_COLUMNS,
	);
	const cell = (width - gap * (columns - 1)) / columns;
	const crop = clamp(options.maxCropPerSide, 0, 0.25);
	const full = columns === 32 ? 0xffffffff : (1 << columns) - 1;

	// One bitmask per grid row: bit c is set when column c is taken.
	const taken: number[] = [];
	const rowMask = (r: number): number => taken[r] ?? 0;
	let firstOpen = 0;

	const memo = new Map<string, Span[]>();
	const boxes: Box[] = new Array<Box>(items.length);
	let usedRows = 0;

	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		const ratio = safeRatio(item?.ratio);
		const area = AREA_BY_SIZE[clamp(Math.round(item?.size ?? 1), 0, 2)] ?? 4;
		// Shapes repeat a lot (camera ratios), so spans are memoised per call.
		const memoKey = `${Math.round(ratio * 1000)}:${area}`;
		let spans = memo.get(memoKey);
		if (!spans) {
			spans = spansFor(ratio, area, columns, cell, gap, crop);
			memo.set(memoKey, spans);
		}

		// Of the best few spans, take the one that fits earliest (fills gaps),
		// breaking ties by cost.
		let best: { row: number; col: number; span: Span } | null = null;
		for (const span of spans) {
			const from = Math.max(firstOpen, usedRows - LOOKBACK_ROWS);
			const spot = findSpot(span, columns, from, rowMask, best?.row);
			if (!spot) continue;
			if (!best || spot.row < best.row) best = { ...spot, span };
		}
		if (!best) continue;

		const { row, col, span } = best;
		const bits = (spanBits(span.cols) << col) >>> 0;
		for (let r = row; r < row + span.rows; r++) {
			taken[r] = (rowMask(r) | bits) >>> 0;
		}
		while (rowMask(firstOpen) === full) firstOpen++;
		usedRows = Math.max(usedRows, row + span.rows);

		boxes[i] = {
			x: col * (cell + gap),
			y: row * (cell + gap),
			width: span.cols * cell + (span.cols - 1) * gap,
			height: span.rows * cell + (span.rows - 1) * gap,
		};
	}

	let holes = 0;
	for (let r = 0; r < usedRows - 1; r++) holes += columns - popcount(rowMask(r));

	return {
		boxes,
		height: usedRows > 0 ? usedRows * (cell + gap) - gap : 0,
		columns,
		holes,
	};
}

/** The cheapest spans for a tile, best first. Spans past the crop cap are used only if nothing else exists. */
function spansFor(
	ratio: number,
	area: number,
	columns: number,
	cell: number,
	gap: number,
	crop: number,
): Span[] {
	const minShown = ratio * (1 - 2 * crop);
	const maxShown = ratio / (1 - 2 * crop);
	const within: Span[] = [];
	const outside: Span[] = [];
	const maxCols = Math.min(MAX_SPAN, columns);
	for (let cols = 1; cols <= maxCols; cols++) {
		for (let rows = 1; rows <= MAX_SPAN; rows++) {
			const shown = (cols * cell + (cols - 1) * gap) / (rows * cell + (rows - 1) * gap);
			const shapeError = Math.log(shown / ratio);
			const areaError = Math.log((cols * rows) / area);
			const cost = 4 * shapeError * shapeError + areaError * areaError;
			const span = { cols, rows, cost };
			if (shown >= minShown - 1e-9 && shown <= maxShown + 1e-9) within.push(span);
			else outside.push(span);
		}
	}
	const pool = within.length > 0 ? within : outside;
	pool.sort((a, b) => a.cost - b.cost);
	return pool.slice(0, CANDIDATES);
}

function findSpot(
	span: Span,
	columns: number,
	fromRow: number,
	rowMask: (r: number) => number,
	beforeRow: number | undefined,
): { row: number; col: number } | null {
	if (span.cols > columns) return null;
	const bits = spanBits(span.cols);
	for (let row = fromRow; beforeRow === undefined || row < beforeRow; row++) {
		for (let col = 0; col + span.cols <= columns; col++) {
			const mask = (bits << col) >>> 0;
			let free = true;
			for (let r = row; r < row + span.rows; r++) {
				if ((rowMask(r) & mask) !== 0) {
					free = false;
					break;
				}
			}
			if (free) return { row, col };
		}
	}
	return null;
}

function spanBits(cols: number): number {
	return cols >= 32 ? 0xffffffff : (1 << cols) - 1;
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
