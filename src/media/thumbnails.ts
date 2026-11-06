import { App, requestUrl } from 'obsidian';
import { THUMBS, openDatabase, settle } from './db';
import { HEADER_BYTES, type Size, isHdrHeader } from './dimensions';
import { MediaSource } from './resolve';

/** Longest side of a stored thumbnail, in px. A tile uses the smallest that covers it. */
const BUCKETS = [256, 512, 1024, 2048];
const QUALITY = 0.82;
/** Bumped when stored thumbnails change meaning, so older entries are ignored. */
const VERSION = 3;
/** Thumbnails made at the same time (decode and encode run off the main thread). */
const CONCURRENCY = 2;
/** Object URLs kept alive; older ones are revoked unless a tile still shows them. */
const MAX_URLS = 400;
/** Total bytes kept in IndexedDB; the oldest thumbnails go first. */
const MAX_BYTES = 300 * 1024 * 1024;
/** Formats left as they are: animation would be lost, vectors are already small. */
const SKIP = /\.(gif|svg)(\?|$)/i;

interface Stored {
	/** Missing for an HDR image: it is always shown from its original. */
	blob?: Blob;
	bytes: number;
	at: number;
	hdr?: boolean;
}

export interface Thumb {
	/** Thumbnail URL; null means show the original. */
	url: string | null;
	/**
	 * The media is HDR and this display can show HDR. Canvas-made WebP is
	 * SDR, so an HDR photo is shown from its original and an HDR video from
	 * a paused frame of the video itself (url is then an SDR stand-in).
	 */
	hdr: boolean;
}

const NONE: Thumb = { url: null, hdr: false };

/** Whether this window's display can show HDR. */
export function hdrDisplay(win: Window = window): boolean {
	return win.matchMedia('(dynamic-range: high)').matches;
}

/**
 * Small WebP copies of images, made once per device and kept in IndexedDB,
 * so tiles decode a few hundred kilobytes instead of a full photo. Making one
 * reads the file once; `createImageBitmap` decodes and resizes it off the
 * main thread and an `OffscreenCanvas` encodes it.
 */
export class Thumbnails {
	private readonly urls = new Map<string, string>();
	/** HDR flags by media URL, learnt while making thumbnails. */
	private readonly hdr = new Map<string, boolean>();
	private readonly pending = new Map<string, Promise<Thumb>>();
	private readonly queue: (() => Promise<void>)[] = [];
	private active = 0;
	private pruned = false;
	private disposed = false;

	constructor(
		private readonly app: App,
		/** Keys a mounted tile still shows; their URLs are never revoked. */
		private readonly inUse: () => ReadonlySet<string>,
		/** The "HDR in tiles" setting. */
		private readonly allowHdr: () => boolean = () => true,
	) {}

	private showHdr(): boolean {
		return this.allowHdr() && hdrDisplay();
	}

	/** The key a tile shows for `media` at `needPx` (its longest side × pixel ratio). */
	keyFor(media: MediaSource, natural: Size | undefined, needPx: number): string | null {
		const bucket = bucketFor(media, natural, needPx);
		return bucket === null ? null : `${VERSION}|${media.src}|${bucket}`;
	}

	/**
	 * A URL for a thumbnail of `media` covering `needPx`, or null when the
	 * original should be shown (small images, GIF, SVG, or decoding failed).
	 */
	get(media: MediaSource, natural: Size | undefined, needPx: number): Promise<Thumb> {
		const bucket = bucketFor(media, natural, needPx);
		if (bucket === null) return Promise.resolve(NONE);
		const key = `${VERSION}|${media.src}|${bucket}`;
		const hdr = this.hdr.get(media.src) === true && this.showHdr();
		const ready = this.urls.get(key);
		if (ready || (hdr && media.kind === 'image')) {
			if (ready) {
				this.urls.delete(key);
				this.urls.set(key, ready);
			}
			return Promise.resolve({ url: hdr && media.kind === 'image' ? null : (ready ?? null), hdr });
		}
		let job = this.pending.get(key);
		if (!job) {
			job = this.load(key, media, natural, bucket);
			this.pending.set(key, job);
			void job.finally(() => this.pending.delete(key));
		}
		return job;
	}

	dispose(): void {
		this.disposed = true;
		this.queue.length = 0;
		for (const url of this.urls.values()) URL.revokeObjectURL(url);
		this.urls.clear();
	}

	private async load(
		key: string,
		media: MediaSource,
		natural: Size | undefined,
		bucket: number,
	): Promise<Thumb> {
		const db = await openDatabase();
		const request = db?.transaction(THUMBS).objectStore(THUMBS).get(key) as IDBRequest<Stored | undefined> | undefined;
		const stored = request ? await settle(request) : null;
		if (stored && (stored.blob || stored.hdr)) {
			this.hdr.set(media.src, stored.hdr === true);
			return this.result(key, media, stored.blob ?? null, stored.hdr === true);
		}
		const made = await this.schedule(() => this.make(media, natural, bucket));
		if (!made || (!made.blob && !made.hdr)) return NONE;
		this.hdr.set(media.src, made.hdr);
		if (db) {
			const entry: Stored = { bytes: made.blob?.size ?? 0, at: Date.now(), hdr: made.hdr };
			if (made.blob) entry.blob = made.blob;
			db.transaction(THUMBS, 'readwrite').objectStore(THUMBS).put(entry, key);
			this.pruneOnce(db);
		}
		return this.result(key, media, made.blob, made.hdr);
	}

	private result(key: string, media: MediaSource, blob: Blob | null, hdr: boolean): Thumb {
		const showHdr = hdr && this.showHdr();
		// An HDR photo on an HDR display: the original, never an SDR copy.
		if (showHdr && media.kind === 'image') return { url: null, hdr: true };
		return { url: blob ? this.remember(key, blob) : null, hdr: showHdr };
	}

	private remember(key: string, blob: Blob): string | null {
		if (this.disposed) return null;
		const url = URL.createObjectURL(blob);
		this.urls.set(key, url);
		if (this.urls.size > MAX_URLS) {
			const keep = this.inUse();
			for (const [oldKey, oldUrl] of this.urls) {
				if (this.urls.size <= MAX_URLS) break;
				if (keep.has(oldKey)) continue;
				URL.revokeObjectURL(oldUrl);
				this.urls.delete(oldKey);
			}
		}
		return url;
	}

	private schedule<T>(task: () => Promise<T>): Promise<T | null> {
		return new Promise((resolve) => {
			this.queue.push(async () => {
				try {
					resolve(this.disposed ? null : await task());
				} catch {
					resolve(null);
				}
			});
			this.pump();
		});
	}

	private pump(): void {
		while (this.active < CONCURRENCY && this.queue.length > 0) {
			const task = this.queue.shift();
			if (!task) break;
			this.active++;
			void task().finally(() => {
				this.active--;
				this.pump();
			});
		}
	}

	private async make(
		media: MediaSource,
		natural: Size | undefined,
		bucket: number,
	): Promise<{ blob: Blob | null; hdr: boolean }> {
		if (media.kind === 'video') return posterFrame(media.src, bucket);
		const buffer = media.file
			? await this.app.vault.readBinary(media.file)
			: (await requestUrl({ url: media.src })).arrayBuffer;
		// The SDR copy is made even for HDR photos, so turning the HDR setting
		// off (or moving to an SDR display) has a thumbnail to show.
		const hdr = isHdrHeader(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, HEADER_BYTES)));
		const source = new Blob([buffer]);
		const landscape = !natural || natural.width >= natural.height;
		const bitmap = await createImageBitmap(
			source,
			landscape
				? { resizeWidth: bucket, resizeQuality: 'high' }
				: { resizeHeight: bucket, resizeQuality: 'high' },
		);
		try {
			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
			const context = canvas.getContext('2d');
			if (!context) return { blob: null, hdr };
			context.drawImage(bitmap, 0, 0);
			return { blob: await canvas.convertToBlob({ type: 'image/webp', quality: QUALITY }), hdr };
		} finally {
			bitmap.close();
		}
	}

	/** Once per session, drops the oldest thumbnails beyond the byte budget. */
	private pruneOnce(db: IDBDatabase): void {
		if (this.pruned) return;
		this.pruned = true;
		const entries: { key: IDBValidKey; bytes: number; at: number }[] = [];
		const request = db.transaction(THUMBS).objectStore(THUMBS).openCursor();
		request.onsuccess = () => {
			const cursor = request.result;
			if (cursor) {
				const value = cursor.value as Partial<Stored>;
				entries.push({ key: cursor.key, bytes: value.bytes ?? 0, at: value.at ?? 0 });
				cursor.continue();
				return;
			}
			let total = entries.reduce((sum, e) => sum + e.bytes, 0);
			if (total <= MAX_BYTES) return;
			entries.sort((a, b) => a.at - b.at);
			const store = db.transaction(THUMBS, 'readwrite').objectStore(THUMBS);
			for (const entry of entries) {
				if (total <= MAX_BYTES) break;
				store.delete(entry.key);
				total -= entry.bytes;
			}
		};
	}
}

function bucketFor(media: MediaSource, natural: Size | undefined, needPx: number): number | null {
	if (SKIP.test(media.src)) return null;
	const bucket = BUCKETS.find((b) => b >= needPx) ?? BUCKETS[BUCKETS.length - 1] ?? 2048;
	// A video always needs a poster; never larger than its own frame.
	if (media.kind === 'video') {
		const largest = natural ? Math.max(natural.width, natural.height) : bucket;
		return BUCKETS.find((b) => b >= Math.min(bucket, largest)) ?? bucket;
	}
	// Small originals are already cheap: show them as they are.
	if (natural && Math.max(natural.width, natural.height) <= bucket * 1.25) return null;
	return bucket;
}

/** How long a poster may take before the tile keeps its placeholder. */
const POSTER_TIMEOUT_MS = 8000;

/**
 * Grabs a frame near the start of a video and encodes it as WebP, scaled so
 * its longest side is at most `bucket`. The video is requested with CORS:
 * Obsidian's vault resource URLs allow it, and remote hosts need to send
 * CORS headers, or this returns null and the tile shows a placeholder.
 */
function posterFrame(src: string, bucket: number): Promise<{ blob: Blob | null; hdr: boolean }> {
	return new Promise((resolve) => {
		const video = createEl('video');
		video.muted = true;
		video.preload = 'auto';
		video.playsInline = true;
		// Vault resource URLs count as another origin too; both they and CORS-enabled
		// remote hosts allow reading frames when the request is made with CORS.
		video.crossOrigin = 'anonymous';
		let done = false;
		let hdr = false;
		const finish = (blob: Blob | null): void => {
			if (done) return;
			done = true;
			window.clearTimeout(timer);
			video.removeAttribute('src');
			video.load();
			resolve({ blob, hdr });
		};
		const timer = window.setTimeout(() => finish(null), POSTER_TIMEOUT_MS);
		video.onerror = () => finish(null);
		video.onloadedmetadata = () => {
			// A few frames in: the very first frame is often black.
			video.currentTime = Math.min(0.5, (video.duration || 1) / 3);
		};
		video.onseeked = () => {
			const width = video.videoWidth;
			const height = video.videoHeight;
			if (!width || !height) return finish(null);
			hdr = isHdrFrame(video);
			const scale = Math.min(1, bucket / Math.max(width, height));
			const canvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale));
			const context = canvas.getContext('2d');
			if (!context) return finish(null);
			try {
				context.drawImage(video, 0, 0, canvas.width, canvas.height);
				void canvas
					.convertToBlob({ type: 'image/webp', quality: QUALITY })
					.then(finish, () => finish(null));
			} catch {
				// A cross-origin frame without CORS taints the canvas.
				finish(null);
			}
		};
		video.src = src;
	});
}

/** Transfer functions WebCodecs reports for HDR video. */
const HDR_VIDEO_TRANSFERS = new Set(['pq', 'hlg', 'smpte2084', 'arib-std-b67']);

/** Reads the current frame's colour space through WebCodecs. */
function isHdrFrame(video: HTMLVideoElement): boolean {
	if (typeof VideoFrame === 'undefined') return false;
	try {
		const frame = new VideoFrame(video);
		const transfer = frame.colorSpace.transfer ?? '';
		frame.close();
		return HDR_VIDEO_TRANSFERS.has(transfer);
	} catch {
		return false;
	}
}
