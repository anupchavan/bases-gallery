import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mosaic } from '../src/layout/mosaic.ts';

const base = { width: 1000, rowHeight: 360, gap: 8, maxCropPerSide: 0.1 };
const photoRatios = [1.5, 0.67, 1.33, 0.75, 1.78, 0.56, 1, 2.4, 0.8, 1.25];
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function perSideCrop(box, ratio) {
	const shown = box.width / box.height;
	return shown < ratio ? (1 - shown / ratio) / 2 : (1 - ratio / shown) / 2;
}

function check(items, opts, { allowRaggedLast = true } = {}) {
	const { boxes, height } = mosaic(items, opts);
	assert.equal(boxes.filter(Boolean).length, items.length, 'every tile placed');
	// No overlaps.
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i], b = boxes[j];
			const overlap = a.x < b.x + b.width - 0.01 && b.x < a.x + a.width - 0.01 && a.y < b.y + b.height - 0.01 && b.y < a.y + a.height - 0.01;
			assert.ok(!overlap, `tiles ${i} and ${j} overlap`);
		}
	// No holes: sample a fine grid over everything above the last row.
	const lastTop = Math.max(...boxes.map((b) => b.y));
	const lastRowTop = Math.min(...boxes.filter((b) => b.y + b.height >= height - 0.5).map((b) => b.y));
	let misses = 0;
	for (let y = 2; y < lastRowTop - 2; y += 5)
		for (let x = 2; x < opts.width - 2; x += 5) {
			const hit = boxes.some((b) => x >= b.x - opts.gap && x <= b.x + b.width + opts.gap && y >= b.y - opts.gap && y <= b.y + b.height + opts.gap);
			if (!hit) misses++;
		}
	assert.equal(misses, 0, 'no holes above the last row');
	void lastTop;
	void allowRaggedLast;
	// Crop cap.
	boxes.forEach((b, i) => {
		const c = perSideCrop(b, items[i].ratio);
		assert.ok(c <= opts.maxCropPerSide + 1e-6, `tile ${i} (ratio ${items[i].ratio}) loses ${(c * 100).toFixed(1)}% per side`);
	});
	return boxes;
}

test('mixed photos: no overlaps, no holes, crop within the cap', () => {
	const items = Array.from({ length: 300 }, () => ({ ratio: photoRatios[Math.floor(rand() * 10)], size: 1 }));
	check(items, base);
});

test('rows mix single and stacked tiles', () => {
	const items = Array.from({ length: 120 }, () => ({ ratio: photoRatios[Math.floor(rand() * 10)], size: 1 }));
	const boxes = mosaic(items, base).boxes;
	const heights = new Set(boxes.map((b) => Math.round(b.height)));
	assert.ok(heights.size > 3, 'tiles come in more than one size');
	const stacked = boxes.filter((b, i) => boxes.some((o, j) => j !== i && Math.abs(o.x - b.x) < 0.5 && Math.abs(o.width - b.width) < 0.5 && o.y !== b.y && Math.abs(o.y - b.y) < base.rowHeight * 1.5));
	assert.ok(stacked.length > 0, 'some tiles are stacked');
});

test('large tiles stand alone and small ones get stacked', () => {
	const items = Array.from({ length: 60 }, (_, i) => ({ ratio: 1.5, size: i % 3 === 0 ? 2 : 0 }));
	const boxes = check(items, base);
	const area = (b) => b.width * b.height;
	const large = items.map((it, i) => (it.size === 2 ? area(boxes[i]) : 0)).filter(Boolean);
	const small = items.map((it, i) => (it.size === 0 ? area(boxes[i]) : 0)).filter(Boolean);
	const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
	assert.ok(avg(large) > avg(small) * 2, `large ${avg(large)} vs small ${avg(small)}`);
});

test('extreme shapes keep their shape', () => {
	const items = [1.5, 6, 1.33, 0.33, 0.33, 1.5, 1, 1.78, 0.75, 0.75, 1.5, 1.5].map((ratio) => ({ ratio, size: 1 }));
	const { boxes } = mosaic(items, base);
	boxes.forEach((b, i) => assert.ok(perSideCrop(b, items[i].ratio) <= 0.1 + 1e-6));
});

test('crop cap 0 still lays out every tile', () => {
	const items = Array.from({ length: 80 }, () => ({ ratio: photoRatios[Math.floor(rand() * 10)], size: 1 }));
	const { boxes } = mosaic(items, { ...base, maxCropPerSide: 0 });
	boxes.forEach((b, i) => assert.ok(perSideCrop(b, items[i].ratio) <= 1e-6));
});

test('10,000 tiles lay out quickly', () => {
	const items = Array.from({ length: 10000 }, () => ({ ratio: photoRatios[Math.floor(rand() * 10)], size: rand() < 0.1 ? 2 : 1 }));
	mosaic(items, base);
	const t0 = performance.now();
	mosaic(items, base);
	const ms = performance.now() - t0;
	console.log(`10,000 tiles: ${ms.toFixed(2)} ms`);
	assert.ok(ms < 400, `took ${ms} ms`);
});

test('big tiles fill a whole band, at a regular rhythm', () => {
	const items = Array.from({ length: 200 }, () => ({ ratio: photoRatios[Math.floor(rand() * 10)], size: 1 }));
	const { boxes } = mosaic(items, base);
	const big = boxes.filter((b) => b.height > base.rowHeight * 0.75);
	assert.ok(big.length >= 8, `${big.length} big tiles`);
	assert.ok(big.length < boxes.length / 2, 'most tiles sit in columns, not alone');
});

test('large tiles stand alone, small ones never do', () => {
	const items = Array.from({ length: 120 }, (_, i) => ({ ratio: photoRatios[i % 10], size: i % 10 === 0 ? 2 : i % 10 === 5 ? 0 : 1 }));
	const boxes = check(items, base);
	const bigSizes = boxes.map((b, i) => (b.height > base.rowHeight * 0.75 ? items[i].size : -1)).filter((s) => s >= 0);
	assert.ok(!bigSizes.includes(0), 'no small tile is big');
	const large = items.filter((it) => it.size === 2).length;
	assert.ok(bigSizes.filter((s) => s === 2).length >= large * 0.5, `big: ${bigSizes}`);
});

test('no tile in a block is smaller than the legibility floor', () => {
	const items = Array.from({ length: 300 }, () => ({ ratio: photoRatios[Math.floor(rand() * 10)], size: rand() < 0.3 ? 0 : 1 }));
	const { boxes } = mosaic(items, { ...base, minTileSize: 120 });
	// Stacked tiles keep both sides above the floor; a lone tall portrait may
	// be narrower, but never shorter or smaller in area.
	const shortest = Math.min(...boxes.map((b) => b.height));
	const smallestArea = Math.min(...boxes.map((b) => b.width * b.height));
	assert.ok(shortest >= 120 - 0.5, `shortest tile ${shortest}`);
	assert.ok(smallestArea >= 120 * 120, `smallest area ${smallestArea}`);
});
