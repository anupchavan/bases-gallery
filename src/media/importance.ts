/**
 * How related each note is to the rest of the gallery, and how that turns
 * into tile area.
 *
 * The score follows kepano's "Related" base, which ranks notes by links
 * overlap, then tags overlap, then backlinks. Here the comparison is against
 * every other note in the gallery at once, done with inverted indexes so it
 * costs one pass over the links and tags (no note-by-note comparison):
 * - shared links: for each link a note has, how many other gallery notes
 *   link to the same file;
 * - shared tags: the same for tags, weighted lower;
 * - direct links: gallery notes that link to this one, or that it links to;
 * - backlinks: files anywhere in the vault that link to the note or its media.
 * Each count is damped with log2(1 + n) so one hub can't swamp the rest.
 */

export interface NoteSignals {
	path: string;
	/** Resolved outgoing link targets (vault paths), without duplicates. */
	links: readonly string[];
	/** Tags, lowercased, without duplicates. */
	tags: readonly string[];
	/** Files anywhere that link to the note or its media (not the note itself). */
	backlinks: number;
}

const WEIGHT_LINKS = 1;
const WEIGHT_TAGS = 0.6;
const WEIGHT_DIRECT = 1;
const WEIGHT_BACKLINKS = 1.5;

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

export function relatednessScores(notes: readonly NoteSignals[]): Float64Array {
	const linkFreq = new Map<string, number>();
	const tagFreq = new Map<string, number>();
	const inGallery = new Map<string, number>();
	notes.forEach((note, i) => inGallery.set(note.path, i));
	const direct = new Float64Array(notes.length);

	for (const note of notes) {
		for (const target of note.links) {
			linkFreq.set(target, (linkFreq.get(target) ?? 0) + 1);
			const j = inGallery.get(target);
			if (j !== undefined && target !== note.path) {
				direct[j] = (direct[j] ?? 0) + 1;
			}
		}
		for (const tag of note.tags) tagFreq.set(tag, (tagFreq.get(tag) ?? 0) + 1);
	}

	const scores = new Float64Array(notes.length);
	notes.forEach((note, i) => {
		let shared = 0;
		let outDirect = 0;
		for (const target of note.links) {
			shared += Math.log2((linkFreq.get(target) ?? 1)); // others linking the same file
			if (inGallery.has(target) && target !== note.path) outDirect++;
		}
		let sharedTags = 0;
		for (const tag of note.tags) sharedTags += Math.log2(tagFreq.get(tag) ?? 1);
		scores[i] =
			WEIGHT_LINKS * shared +
			WEIGHT_TAGS * sharedTags +
			WEIGHT_DIRECT * Math.log2(1 + (direct[i] ?? 0) + outDirect) +
			WEIGHT_BACKLINKS * Math.log2(1 + note.backlinks);
	});
	return scores;
}

/**
 * Area multiplier from rank: the most related note gets about 6 times the
 * area of a typical one, the top tenth about 2.5 times, the middle about 1,
 * the least related 0.7. Equal scores share a multiplier, so a vault without
 * links stays even.
 */
export function areaWeights(scores: ArrayLike<number>): Float64Array {
	const n = scores.length;
	const weights = new Float64Array(n).fill(1);
	if (n === 0) return weights;
	const order = Array.from({ length: n }, (_, i) => i).sort(
		(a, b) => (scores[b] ?? 0) - (scores[a] ?? 0),
	);
	let start = 0;
	while (start < n) {
		// Ties get the average rank of their group.
		const value = scores[order[start] ?? 0] ?? 0;
		let end = start;
		while (end < n && (scores[order[end] ?? 0] ?? 0) === value) end++;
		const allTied = start === 0 && end === n;
		const p = n > 1 ? (start + end - 1) / 2 / (n - 1) : 0;
		const weight = allTied ? 1 : weightAt(p);
		for (let k = start; k < end; k++) weights[order[k] ?? 0] = weight;
		start = end;
	}
	return weights;
}

/** Smooth curve over percentile rank p (0 = most related, 1 = least). */
function weightAt(p: number): number {
	const q = 1 - p;
	return 0.7 + 0.6 * q + 4.7 * q ** 12;
}
