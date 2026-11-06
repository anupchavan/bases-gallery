/** Page geometry for PDFs. No Obsidian imports, so tests can load it. */
import type { Size } from './dimensions';

/**
 * A page's displayed size in PDF points: its box (`[x1, y1, x2, y2]`, as
 * PDF.js gives `page.view`) turned by its `/Rotate` value. Null for an empty
 * or malformed box.
 */
export function pageSize(view: readonly number[], rotate: number): Size | null {
	const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = view;
	let width = Math.abs(x2 - x1);
	let height = Math.abs(y2 - y1);
	if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
	const turn = (((Math.round(rotate / 90) * 90) % 360) + 360) % 360;
	if (turn === 90 || turn === 270) [width, height] = [height, width];
	return { width, height };
}

/** The scale that renders a page of `size` with its longest side at `longest` px. */
export function renderScale(size: Size, longest: number): number {
	return longest / Math.max(size.width, size.height);
}
