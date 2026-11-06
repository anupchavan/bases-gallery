/**
 * Justified rows: every tile in a row shares one height, tiles keep (close
 * to) their own aspect ratio, and each row fills the width exactly. Row
 * breaks are chosen by dynamic programming over a bounded window, the way
 * Knuth-Plass breaks lines, so one awkward tile doesn't wreck the rows
 * around it.
 */

export interface JustifyOptions {
	/** Inner width of the container in px. */
	width: number;
	/** Height a row aims for, in px. */
	targetHeight: number;
	/** Space between tiles, in px (both directions). */
	gap: number;
	/**
	 * Largest share of a tile's width or height that may be cropped away on
	 * each side, from 0 (never crop) to 0.25.
	 */
	maxCropPerSide: number;
	/** How far a row's height may move from the target, as a share of it. */
	heightTolerance?: number;
	/** Most tiles one row may hold. */
	maxRowItems?: number;
	/** No row may be taller than this, in px. */
	maxHeight?: number;
	/** Whether these are the gallery's last tiles: only then may the last row be short. */
	final?: boolean;
}

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Row {
	/** Index of the first tile in this row. */
	start: number;
	/** Index after the last tile in this row. */
	end: number;
	y: number;
	height: number;
}

export interface JustifiedLayout {
	boxes: Box[];
	rows: Row[];
	/** Total height of all rows, including gaps between them. */
	height: number;
}

interface RowFit {
	cost: number;
	height: number;
	/** Multiplier applied to every ratio in the row (1 when nothing is cropped). */
	stretch: number;
	/** Row is left at the target height without filling the width. */
	ragged: boolean;
}

const INFEASIBLE = 1e6;

/**
 * Lays out tiles with the given aspect ratios (width / height). Pure and
 * allocation-light: about `maxRowItems` row evaluations per tile.
 */
export function justify(
	ratios: readonly number[],
	options: JustifyOptions,
): JustifiedLayout {
	const n = ratios.length;
	const width = Math.max(1, options.width);
	const target = Math.max(1, options.targetHeight);
	const gap = Math.max(0, options.gap);
	const crop = clamp(options.maxCropPerSide, 0, 0.25);
	const tolerance = options.heightTolerance ?? 0.25;
	const maxItems = Math.max(1, options.maxRowItems ?? 12);
	const final = options.final ?? true;
	// A tile may be shown between r * (1 - 2c) and r / (1 - 2c).
	const minStretch = 1 - 2 * crop;
	const maxStretch = 1 / minStretch;
	const minHeight = target * (1 - tolerance);
	const maxHeight = Math.min(target * (1 + tolerance), options.maxHeight ?? Infinity);

	const scratch: RowFit = { cost: 0, height: 0, stretch: 1, ragged: false };
	const set = (
		cost: number,
		height: number,
		stretch: number,
		ragged: boolean,
	): RowFit => {
		scratch.cost = cost;
		scratch.height = height;
		scratch.stretch = stretch;
		scratch.ragged = ragged;
		return scratch;
	};
	// Returns a shared object: read it before the next call.
	const fit = (sumRatio: number, count: number, last: boolean): RowFit => {
		const available = width - gap * (count - 1);
		const natural = available / sumRatio;

		if (last && natural > target) {
			// The final row doesn't need to fill the width.
			return set(0, target, 1, true);
		}
		if (natural >= minHeight && natural <= maxHeight) {
			return set(deviation(natural, target), natural, 1, false);
		}
		if (count === 1 && natural < minHeight) {
			// One tile wider than the row (a panorama): shrink the row, never crop.
			return set(deviation(natural, target) * 0.25, natural, 1, false);
		}
		const height = natural > maxHeight ? maxHeight : minHeight;
		const stretch = available / (height * sumRatio);
		if (stretch >= minStretch && stretch <= maxStretch) {
			const cost = deviation(height, target) + 2 * (stretch - 1) ** 2;
			return set(cost, height, stretch, false);
		}
		if (natural < minHeight) {
			// Too wide even with the crop cap: shrink the row, never crop more.
			return set(deviation(natural, target) + 0.5, natural, 1, false);
		}
		// Too narrow even with the crop cap (very tall tiles). Never crop past
		// the cap: leave the row at the target height without filling it.
		return set(INFEASIBLE, target, 1, true);
	};

	// best[j] is the cheapest layout of tiles [0, j).
	const best = new Float64Array(n + 1).fill(Infinity);
	const from = new Int32Array(n + 1);
	best[0] = 0;
	for (let j = 1; j <= n; j++) {
		let sum = 0;
		for (let i = j - 1; i >= 0 && j - i <= maxItems; i--) {
			sum += safeRatio(ratios[i]);
			const prev = best[i] ?? Infinity;
			if (prev === Infinity) continue;
			const cost = prev + fit(sum, j - i, j === n && final).cost;
			if (cost < (best[j] ?? Infinity)) {
				best[j] = cost;
				from[j] = i;
			}
		}
	}

	const breaks: number[] = [];
	for (let j = n; j > 0; j = from[j] ?? 0) breaks.push(j);
	breaks.reverse();

	const boxes: Box[] = new Array<Box>(n);
	const rows: Row[] = [];
	let y = 0;
	let start = 0;
	for (const end of breaks) {
		let sum = 0;
		for (let i = start; i < end; i++) sum += safeRatio(ratios[i]);
		const row = fit(sum, end - start, end === n && final);
		let x = 0;
		for (let i = start; i < end; i++) {
			const isLastInRow = i === end - 1;
			let w = row.height * safeRatio(ratios[i]) * row.stretch;
			// Absorb rounding so justified rows end exactly at the edge.
			if (isLastInRow && !row.ragged) w = Math.max(0, width - x);
			boxes[i] = { x, y, width: w, height: row.height };
			x += w + gap;
		}
		rows.push({ start, end, y, height: row.height });
		y += row.height + gap;
		start = end;
	}

	return { boxes, rows, height: rows.length > 0 ? y - gap : 0 };
}

function deviation(height: number, target: number): number {
	const d = (height - target) / target;
	return d * d;
}

function safeRatio(ratio: number | undefined): number {
	return ratio !== undefined && Number.isFinite(ratio) && ratio > 0
		? ratio
		: 1;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
