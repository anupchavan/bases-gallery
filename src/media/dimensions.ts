/**
 * Reads an image's displayed width and height from the first bytes of the
 * file, so the layout knows every shape before any image is decoded. Covers
 * JPEG (with EXIF rotation), PNG, GIF, WebP and AVIF/HEIF. Returns null for
 * anything else; the caller then falls back to loading the media.
 */

export interface Size {
	width: number;
	height: number;
	/** Videos only: length in seconds. */
	duration?: number;
	/** PDFs only: number of pages. */
	pages?: number;
}

/** Bytes read from the start of a file. Headers sit well inside this. */
export const HEADER_BYTES = 128 * 1024;

export function sizeFromHeader(bytes: Uint8Array): Size | null {
	if (bytes.length < 16) return null;
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes);
	if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return png(bytes);
	if (ascii(bytes, 0, 3) === 'GIF') return gif(bytes);
	if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return webp(bytes);
	if (ascii(bytes, 4, 4) === 'ftyp') return isoImage(bytes);
	return null;
}

function png(b: Uint8Array): Size | null {
	if (ascii(b, 12, 4) !== 'IHDR') return null;
	return valid(u32(b, 16), u32(b, 20));
}

function gif(b: Uint8Array): Size | null {
	return valid(u16le(b, 6), u16le(b, 8));
}

function webp(b: Uint8Array): Size | null {
	const chunk = ascii(b, 12, 4);
	if (chunk === 'VP8 ') return valid(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
	if (chunk === 'VP8L') {
		const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
		return valid((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
	}
	if (chunk === 'VP8X') return valid(u24le(b, 24) + 1, u24le(b, 27) + 1);
	return null;
}

function jpeg(b: Uint8Array): Size | null {
	let orientation = 1;
	let offset = 2;
	while (offset + 9 < b.length) {
		if (b[offset] !== 0xff) return null;
		const marker = b[offset + 1] ?? 0;
		if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
			offset += 2;
			continue;
		}
		const length = u16(b, offset + 2);
		if (marker === 0xe1 && ascii(b, offset + 4, 4) === 'Exif') {
			orientation = exifOrientation(b, offset + 10) ?? orientation;
		}
		// SOF0 to SOF15, except DHT (c4), JPG (c8) and DAC (cc).
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			const height = u16(b, offset + 5);
			const width = u16(b, offset + 7);
			return orientation >= 5 && orientation <= 8 ? valid(height, width) : valid(width, height);
		}
		offset += 2 + length;
	}
	return null;
}

/** Reads the EXIF orientation tag from a TIFF header at `start`. */
function exifOrientation(b: Uint8Array, start: number): number | null {
	const little = ascii(b, start, 2) === 'II';
	const r16 = (o: number): number => (little ? u16le(b, o) : u16(b, o));
	const r32 = (o: number): number => (little ? u32le(b, o) : u32(b, o));
	const ifd = start + r32(start + 4);
	const entries = r16(ifd);
	for (let k = 0; k < entries; k++) {
		const entry = ifd + 2 + k * 12;
		if (entry + 12 > b.length) return null;
		if (r16(entry) === 0x0112) return r16(entry + 8);
	}
	return null;
}

/** AVIF and HEIF: the primary item's `ispe` size, swapped by `irot`. */
function isoImage(b: Uint8Array): Size | null {
	const brand = ascii(b, 8, 4);
	if (!['avif', 'avis', 'heic', 'heix', 'mif1', 'msf1', 'hevc', 'hevx'].includes(brand)) return null;
	let size: Size | null = null;
	let rotated = false;
	// ispe and irot sit inside meta > iprp > ipco; scan for their tags.
	for (let o = 12; o + 20 < b.length; o++) {
		if (b[o] !== 0x69) continue; // 'i'
		const tag = ascii(b, o, 4);
		if (tag === 'ispe' && !size) {
			size = valid(u32(b, o + 8), u32(b, o + 12));
		} else if (tag === 'irot') {
			rotated = ((b[o + 4] ?? 0) & 0x3) % 2 === 1;
		}
	}
	if (!size) return null;
	return rotated ? { width: size.height, height: size.width } : size;
}

function valid(width: number, height: number): Size | null {
	return width > 0 && height > 0 ? { width, height } : null;
}

function ascii(b: Uint8Array, start: number, length: number): string {
	let out = '';
	for (let i = start; i < start + length && i < b.length; i++) {
		out += String.fromCharCode(b[i] ?? 0);
	}
	return out;
}

function u16(b: Uint8Array, o: number): number {
	return ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
}

function u16le(b: Uint8Array, o: number): number {
	return (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
}

function u24le(b: Uint8Array, o: number): number {
	return (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16);
}

function u32(b: Uint8Array, o: number): number {
	return (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0;
}

function u32le(b: Uint8Array, o: number): number {
	return ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0;
}

/** Transfer characteristics (ITU-T H.273) that mean HDR: PQ and HLG. */
const HDR_TRANSFERS = new Set([16, 18]);
/** Markers of a gain map (ISO 21496-1, Adobe/Google "hdrgm", Apple HDR). */
const GAIN_MAP_MARKERS = ['hdrgm:', 'urn:iso:std:iso:ts:21496', 'HDRGainMap', 'hdrgainmap'];

/**
 * Whether an image's header says it is HDR: a gain map (JPEG, HEIC, AVIF),
 * or PQ/HLG transfer in an AVIF/HEIF `colr` box or a PNG `cICP` chunk.
 */
export function isHdrHeader(bytes: Uint8Array): boolean {
	if (bytes.length < 16) return false;
	// PNG: cICP chunk = colour primaries, transfer, matrix, full range.
	if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') {
		const at = indexOf(bytes, 'cICP');
		return at >= 0 && HDR_TRANSFERS.has(bytes[at + 5] ?? 0);
	}
	// ISO-BMFF: colr box of type nclx = primaries (u16), transfer (u16), ...
	if (ascii(bytes, 4, 4) === 'ftyp') {
		for (let at = indexOf(bytes, 'colr'); at >= 0; at = indexOf(bytes, 'colr', at + 4)) {
			if (ascii(bytes, at + 4, 4) === 'nclx' && HDR_TRANSFERS.has(u16(bytes, at + 10))) return true;
		}
	}
	return GAIN_MAP_MARKERS.some((marker) => indexOf(bytes, marker) >= 0);
}

function indexOf(bytes: Uint8Array, text: string, from = 0): number {
	const first = text.charCodeAt(0);
	outer: for (let i = from; i <= bytes.length - text.length; i++) {
		if (bytes[i] !== first) continue;
		for (let k = 1; k < text.length; k++) {
			if (bytes[i + k] !== text.charCodeAt(k)) continue outer;
		}
		return i;
	}
	return -1;
}
