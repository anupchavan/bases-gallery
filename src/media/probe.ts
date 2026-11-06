import { App, TFile } from 'obsidian';
import { HEADER_BYTES, Size, sizeFromHeader } from './dimensions';
import { MediaSource } from './resolve';

/**
 * Finds a media item's displayed size as cheaply as possible:
 * - vault images: the file's header bytes, parsed;
 * - videos: the container header, through a `<video preload="metadata">`;
 * - anything else: the decoded image.
 */
export async function probeSize(app: App, media: MediaSource): Promise<Size | null> {
	if (media.kind === 'video') return withTimeout(videoSize(media.src));
	if (media.file) {
		const size = await withTimeout(headerSize(app, media.file));
		if (size) return size;
	}
	return withTimeout(imageSize(media.src));
}

/** Gives up on slow remote media so the queue keeps moving. */
const PROBE_TIMEOUT_MS = 10_000;

function withTimeout(promise: Promise<Size | null>): Promise<Size | null> {
	return new Promise((resolve) => {
		const timer = window.setTimeout(() => resolve(null), PROBE_TIMEOUT_MS);
		void promise.then((size) => {
			window.clearTimeout(timer);
			resolve(size);
		});
	});
}

/**
 * Reads the size from the file's header bytes. Obsidian has no public
 * partial read, so the whole file is read once; the size is then cached and
 * the file is never read for this again.
 */
async function headerSize(app: App, file: TFile): Promise<Size | null> {
	try {
		const buffer = await app.vault.readBinary(file);
		return sizeFromHeader(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, HEADER_BYTES)));
	} catch {
		return null;
	}
}

function imageSize(src: string): Promise<Size | null> {
	return new Promise((resolve) => {
		const img = createEl('img');
		const done = (size: Size | null): void => {
			img.onload = null;
			img.onerror = null;
			img.removeAttribute('src');
			resolve(size);
		};
		img.onload = () =>
			done(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
		img.onerror = () => done(null);
		img.src = src;
	});
}

function videoSize(src: string): Promise<Size | null> {
	return new Promise((resolve) => {
		const video = createEl('video');
		video.muted = true;
		video.preload = 'metadata';
		const done = (size: Size | null): void => {
			video.onloadedmetadata = null;
			video.onerror = null;
			video.removeAttribute('src');
			video.load();
			resolve(size);
		};
		video.onloadedmetadata = () =>
			done(
				video.videoWidth > 0
					? {
							width: video.videoWidth,
							height: video.videoHeight,
							duration: Number.isFinite(video.duration) ? video.duration : undefined,
						}
					: null,
			);
		video.onerror = () => done(null);
		video.src = src;
	});
}
