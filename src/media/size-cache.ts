/**
 * Per-device cache of media sizes in IndexedDB. Keys are media URLs; vault
 * resource paths carry the file's mtime, so an edited file gets a new key.
 * Nothing here syncs between devices.
 */
import type { Size } from './dimensions';

import { SIZES as STORE, openDatabase as open } from './db';

/** Reads every cached size at once; the store holds a few dozen bytes per item. */
export async function loadSizes(): Promise<Map<string, Size>> {
	const out = new Map<string, Size>();
	const db = await open();
	if (!db) return out;
	return new Promise((resolve) => {
		const request = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
		request.onsuccess = () => {
			const cursor = request.result;
			if (!cursor) {
				resolve(out);
				return;
			}
			const value = cursor.value as Partial<Size> | undefined;
			if (typeof cursor.key === 'string' && value?.width && value.height) {
				const size: Size = { width: value.width, height: value.height };
				if (typeof value.duration === 'number') size.duration = value.duration;
				if (typeof value.pages === 'number') size.pages = value.pages;
				out.set(cursor.key, size);
			}
			cursor.continue();
		};
		request.onerror = () => resolve(out);
	});
}

/** Writes sizes in one transaction. Failures are ignored: the cache is optional. */
export async function saveSizes(entries: [string, Size][]): Promise<void> {
	if (entries.length === 0) return;
	const db = await open();
	if (!db) return;
	const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
	for (const [key, size] of entries) store.put(size, key);
}
