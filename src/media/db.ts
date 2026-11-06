/**
 * The plugin's IndexedDB database: per device, never synced. Holds media
 * sizes and thumbnails, both safe to lose.
 */
const DB_NAME = 'media-manager';
const VERSION = 2;
export const SIZES = 'sizes';
export const THUMBS = 'thumbs';

let opening: Promise<IDBDatabase | null> | null = null;

export function openDatabase(): Promise<IDBDatabase | null> {
	opening ??= new Promise((resolve) => {
		try {
			const request = indexedDB.open(DB_NAME, VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(SIZES)) db.createObjectStore(SIZES);
				if (!db.objectStoreNames.contains(THUMBS)) db.createObjectStore(THUMBS);
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => resolve(null);
			request.onblocked = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
	return opening;
}

/** Wraps a request in a promise; errors resolve to null. */
export function settle<T>(request: IDBRequest<T>): Promise<T | null> {
	return new Promise((resolve) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => resolve(null);
	});
}
