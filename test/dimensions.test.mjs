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
