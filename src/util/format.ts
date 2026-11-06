/**
 * Pure helpers with no Obsidian imports, so the Node test runner can load
 * them directly.
 */

/** Elapsed or total time as m:ss, or h:mm:ss from an hour up. */
export function formatTime(total: number): string {
	const seconds = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = String(seconds % 60).padStart(2, '0');
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Reads a size property value as an area weight: small (s, 1) 0.6, large
 * (l, 3) 3, anything else 1. A plain number is used as the weight itself.
 */
export function parseSizeWeight(text: string): number {
	const value = text.trim().toLowerCase();
	if (value === 'small' || value === 's' || value === '1') return 0.6;
	if (value === 'large' || value === 'l' || value === '3') return 3;
	const number = Number(value);
	if (value !== '' && Number.isFinite(number) && number > 0) return Math.min(number, 8);
	return 1;
}

/**
 * Reads a location the way Obsidian Maps does: "lat, lng" text, or a list
 * of two numbers (which Bases prints as "lat, lng"). Returns null when it
 * isn't a valid location, so no map is shown.
 */
export function parseCoordinates(text: string): [number, number] | null {
	const parts = text
		.replace(/[[\]"']/g, '')
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part !== '');
	if (parts.length < 2) return null;
	const lat = Number(parts[0]);
	const lng = Number(parts[1]);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
	if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
	return [lat, lng];
}
