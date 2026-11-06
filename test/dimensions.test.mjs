import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sizeFromHeader } from '../src/media/dimensions.ts';

const read = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

for (const name of ['a.png', 'a.jpg', 'a.gif', 'a.heic', 'a.avif', 'lossy.webp', 'lossless.webp']) {
	test(`reads ${name}`, () => {
		assert.deepEqual(sizeFromHeader(read(name)), { width: 240, height: 160 });
	});
}

test('applies EXIF rotation', () => {
	assert.deepEqual(sizeFromHeader(read('rot.jpg')), { width: 160, height: 240 });
});

test('returns null for unknown data', () => {
	assert.equal(sizeFromHeader(new Uint8Array(64)), null);
});

import { isHdrHeader } from '../src/media/dimensions.ts';

test('HDR: PQ AVIF yes, ordinary images no', () => {
	assert.equal(isHdrHeader(read('hdr-pq.avif')), true);
	for (const name of ['a.png', 'a.jpg', 'a.avif', 'a.heic', 'lossy.webp']) assert.equal(isHdrHeader(read(name)), false, name);
});

test('HDR: gain map marker and PNG cICP', () => {
	const xmp = new TextEncoder().encode('\xff\xd8 <x:xmpmeta hdrgm:Version="1.0"> ');
	assert.equal(isHdrHeader(xmp), true);
	const png = new Uint8Array(64);
	png.set([0x89, 0x50, 0x4e, 0x47]);
	png.set(new TextEncoder().encode('cICP'), 20);
	png.set([9, 16, 0, 1], 24);
	assert.equal(isHdrHeader(png), true);
});
