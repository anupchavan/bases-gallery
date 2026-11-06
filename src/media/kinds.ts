/** Media kinds by file extension. No Obsidian imports, so tests can load it. */

export type MediaKind = 'image' | 'video' | 'pdf';

const IMAGE_EXTENSIONS = new Set([
	'png',
	'jpg',
	'jpeg',
	'webp',
	'avif',
	'gif',
	'bmp',
	'svg',
	'heic',
	'heif',
]);
const VIDEO_EXTENSIONS = new Set([
	'mp4',
	'm4v',
	'webm',
	'mov',
	'ogv',
	'mkv',
]);

export function mediaKindOf(extension: string): MediaKind | null {
	const ext = extension.toLowerCase();
	if (IMAGE_EXTENSIONS.has(ext)) return 'image';
	if (VIDEO_EXTENSIONS.has(ext)) return 'video';
	if (ext === 'pdf') return 'pdf';
	return null;
}

/** The extension of a path's last segment, without the dot; '' when there is none. */
export function extensionOf(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1) : '';
}

/**
 * The kind of media a remote URL points to, or null when it can't be shown.
 * A URL without a known extension is assumed to be an image. PDFs are read
 * through the vault, so remote PDFs are left out.
 */
export function remoteKindOf(pathname: string): MediaKind | null {
	const kind = mediaKindOf(extensionOf(pathname)) ?? 'image';
	return kind === 'pdf' ? null : kind;
}
