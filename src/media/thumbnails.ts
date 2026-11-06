import { App, requestUrl } from 'obsidian';
import { THUMBS, openDatabase, settle } from './db';
import type { Size } from './dimensions';
import { MediaSource } from './resolve';

/** Longest side of a stored thumbnail, in px. A tile uses the smallest that covers it. */
const BUCKETS = [256, 512, 1024, 2048];
const QUALITY = 0.82;
/** Thumbnails made at the same time (decode and encode run off the main thread). */
const CONCURRENCY = 2;
/** Object URLs kept alive; older ones are revoked unless a tile still shows them. */
const MAX_URLS = 400;
/** Total bytes kept in IndexedDB; the oldest thumbnails go first. */
const MAX_BYTES = 300 * 1024 * 1024;
/** Formats left as they are: animation would be lost, vectors are already small. */
const SKIP = /\.(gif|svg)(\?|$)/i;

interface Stored {
	blob: Blob;
	bytes: number;
	at: number;
}

/**
 * Small WebP copies of images, made once per device and kept in IndexedDB,
 * so tiles decode a few hundred kilobytes instead of a full photo. Making one
 * reads the file once; `createImageBitmap` decodes and resizes it off the
 * main thread and an `OffscreenCanvas` encodes it.
 */
export class Thumbnails {
	private readonly urls = new Map<string, string>();
	private readonly pending = new Map<string, Promise<string | null>>();
	private readonly queue: (() => Promise<void>)[] = [];
	private active = 0;
	private pruned = false;
	private disposed = false;

	constructor(
		private readonly app: App,
		/** Keys a mounted tile still shows; their URLs are never revoked. */
		private readonly inUse: () => ReadonlySet<string>,
	) {}

	/** The key a tile shows for `media` at `needPx` (its longest side × pixel ratio). */
	keyFor(media: MediaSource, natural: Size | undefined, needPx: number): string | null {
		const bucket = bucketFor(media, natural, needPx);
		return bucket === null ? null : `${media.src}|${bucket}`;
	}

	/**
	 * A URL for a thumbnail of `media` covering `needPx`, or null when the
	 * original should be shown (small images, GIF, SVG, or decoding failed).
	 */
	get(media: MediaSource, natural: Size | undefined, needPx: number): Promise<string | null> {
		const bucket = bucketFor(media, natural, needPx);
		if (bucket === null) return Promise.resolve(null);
		const key = `${media.src}|${bucket}`;
		const ready = this.urls.get(key);
		if (ready) {
			this.urls.delete(key);
			this.urls.set(key, ready);
			return Promise.resolve(ready);
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
	): Promise<string | null> {
		const db = await openDatabase();
		const request = db?.transaction(THUMBS).objectStore(THUMBS).get(key) as IDBRequest<Stored | undefined> | undefined;
		const stored = request ? await settle(request) : null;
		if (stored?.blob) return this.remember(key, stored.blob);
		const blob = await this.schedule(() => this.make(media, natural, bucket));
		if (!blob) return null;
		if (db) {
			db.transaction(THUMBS, 'readwrite')
				.objectStore(THUMBS)
				.put({ blob, bytes: blob.size, at: Date.now() } satisfies Stored, key);
			this.pruneOnce(db);
		}
		return this.remember(key, blob);
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

	private async make(media: MediaSource, natural: Size | undefined, bucket: number): Promise<Blob | null> {
		if (media.kind === 'video') return posterFrame(media.src, bucket);
		const source = media.file
			? new Blob([await this.app.vault.readBinary(media.file)])
			: new Blob([(await requestUrl({ url: media.src })).arrayBuffer]);
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
			if (!context) return null;
			context.drawImage(bitmap, 0, 0);
			return await canvas.convertToBlob({ type: 'image/webp', quality: QUALITY });
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
function posterFrame(src: string, bucket: number): Promise<Blob | null> {
	return new Promise((resolve) => {
		const video = createEl('video');
		video.muted = true;
		video.preload = 'auto';
		video.playsInline = true;
		// Vault resource URLs count as another origin too; both they and CORS-enabled
		// remote hosts allow reading frames when the request is made with CORS.
		video.crossOrigin = 'anonymous';
		let done = false;
		const finish = (blob: Blob | null): void => {
			if (done) return;
			done = true;
			window.clearTimeout(timer);
			video.removeAttribute('src');
			video.load();
			resolve(blob);
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
