/**
 * How connected a note is: how many other files link to it or to its media.
 * Counted from Obsidian's own resolved-link index, so nothing is parsed here.
 */

/** Counts distinct linking files per destination path. */
export function incomingLinkCounts(
	resolvedLinks: Record<string, Record<string, number>>,
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const source in resolvedLinks) {
		const targets = resolvedLinks[source];
		if (!targets) continue;
		for (const target in targets) {
			if (target === source) continue;
			counts.set(target, (counts.get(target) ?? 0) + 1);
		}
	}
	return counts;
}

/**
 * Connections for one tile: files linking to the note, plus files linking to
 * its media other than the note itself (which links to it by definition).
 */
export function connections(
	counts: ReadonlyMap<string, number>,
	notePath: string,
	mediaPath: string | null,
	noteLinksToMedia: boolean,
): number {
	const toNote = counts.get(notePath) ?? 0;
	if (!mediaPath || mediaPath === notePath) return toNote;
	const toMedia = (counts.get(mediaPath) ?? 0) - (noteLinksToMedia ? 1 : 0);
	return toNote + Math.max(0, toMedia);
}

/** Share of tiles made large, and made small, when connection counts differ. */
const LARGE_SHARE = 0.12;
const SMALL_SHARE = 0.3;

/**
 * Turns connection counts into sizes (0 small, 1 medium, 2 large) by rank.
 * Tiles tied with the middle stay medium, so a vault with few links looks
 * even rather than random. Only tiles with at least one connection can be
 * large, and only tiles below the median can be small.
 */
export function sizesFromConnections(values: readonly number[]): number[] {
	const n = values.length;
	const sizes = new Array<number>(n).fill(1);
	if (n === 0) return sizes;
	const sorted = [...values].sort((a, b) => a - b);
	const median = sorted[n >> 1] ?? 0;
	const largeAt = sorted[Math.min(n - 1, Math.floor(n * (1 - LARGE_SHARE)))] ?? Infinity;
	const smallAt = sorted[Math.floor(n * SMALL_SHARE)] ?? -Infinity;
	for (let i = 0; i < n; i++) {
		const v = values[i] ?? 0;
		if (v > 0 && v >= largeAt && v > median) sizes[i] = 2;
		else if (v <= smallAt && v < median) sizes[i] = 0;
	}
	return sizes;
}
