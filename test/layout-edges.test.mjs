import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mosaic } from '../src/layout/mosaic.ts';
import { justify } from '../src/layout/justify.ts';

// The view skips layout while hidden, but the layouts must still be safe
// with the odd sizes a pane can briefly report while it animates.
const within = (boxes, width) => boxes.every((b) => b.x >= -0.01 && b.x + b.width <= width + 0.01 && b.width > 0 && b.height > 0);

test('mosaic: no items gives an empty layout', () => {
	const { boxes, height } = mosaic([], { width: 800, tileSize: 200, gap: 8 });
	assert.equal(boxes.length, 0);
	assert.equal(height, 0);
});

test('mosaic: one item fits the width', () => {
	const { boxes } = mosaic([{ ratio: 1.5, weight: 1 }], { width: 800, tileSize: 200, gap: 8, final: true });
	assert.equal(boxes.length, 1);
	assert.ok(within(boxes, 800));
});

test('mosaic: a very narrow pane still places every item inside it', () => {
	const items = Array.from({ length: 30 }, (_, i) => ({ ratio: [0.5, 1, 1.5, 2.4][i % 4], weight: i % 7 === 0 ? 3 : 1 }));
	for (const width of [1, 40, 120]) {
		const { boxes } = mosaic(items, { width, tileSize: 140, gap: 8, minTileSize: 60, final: true });
		assert.equal(boxes.length, items.length, `width ${width}`);
		assert.ok(boxes.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.width) && Number.isFinite(b.height)), `finite at ${width}`);
	}
});

test('mosaic: extreme ratios stay finite and inside the width', () => {
	const items = [{ ratio: 20, weight: 1 }, { ratio: 0.05, weight: 1 }, { ratio: 1, weight: 1 }, { ratio: 8, weight: 3 }];
	const { boxes } = mosaic(items, { width: 1000, tileSize: 200, gap: 8, maxTileHeight: 900, final: true });
	assert.equal(boxes.length, items.length);
	assert.ok(within(boxes, 1000));
});

test('justify: narrow and empty inputs are safe', () => {
	assert.equal(justify([], { width: 800, targetHeight: 200, gap: 8, maxCropPerSide: 0.1 }).boxes.length, 0);
	const { boxes } = justify([1, 2, 0.5], { width: 30, targetHeight: 200, gap: 8, maxCropPerSide: 0.1, final: true });
	assert.equal(boxes.length, 3);
	assert.ok(boxes.every((b) => Number.isFinite(b.width) && b.width > 0));
});
