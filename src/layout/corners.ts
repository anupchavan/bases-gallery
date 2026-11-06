import type { Box } from './justify';

/** Bit flags for a tile's corners that lie on the gallery's outer outline. */
export const TOP_LEFT = 1;
export const TOP_RIGHT = 2;
export const BOTTOM_RIGHT = 4;
export const BOTTOM_LEFT = 8;

/** Height of the bands used to look up tiles near a point, in px. */
const BAND = 96;

/**
 * Finds the corners of each tile that are convex corners of the whole
 * gallery's outline: nothing sits beyond them on either side. The gallery's
 * four corners always qualify, and so do the steps a short last row makes.
 */
export function outerCorners(boxes: readonly Box[], gap: number): Uint8Array {
	const bands = new Map<number, number[]>();
	boxes.forEach((box, i) => {
		if (!box) return;
		const first = Math.floor(box.y / BAND);
		const last = Math.floor((box.y + box.height) / BAND);
		for (let band = first; band <= last; band++) {
			let list = bands.get(band);
			if (!list) bands.set(band, (list = []));
			list.push(i);
		}
	});

	const occupied = (x: number, y: number): boolean => {
		for (const i of bands.get(Math.floor(y / BAND)) ?? []) {
			const b = boxes[i];
			if (b && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return true;
		}
		return false;
	};

	// Probe just past the gap, and 1 px in along the edge.
	const step = gap + 1;
	const flags = new Uint8Array(boxes.length);
	boxes.forEach((b, i) => {
		if (!b) return;
		const left = b.x;
		const right = b.x + b.width;
		const top = b.y;
		const bottom = b.y + b.height;
		let f = 0;
		if (!occupied(left - step, top + 1) && !occupied(left + 1, top - step)) f |= TOP_LEFT;
		if (!occupied(right + step, top + 1) && !occupied(right - 1, top - step)) f |= TOP_RIGHT;
		if (!occupied(right + step, bottom - 1) && !occupied(right - 1, bottom + step)) f |= BOTTOM_RIGHT;
		if (!occupied(left - step, bottom - 1) && !occupied(left + 1, bottom + step)) f |= BOTTOM_LEFT;
		flags[i] = f;
	});
	return flags;
}
