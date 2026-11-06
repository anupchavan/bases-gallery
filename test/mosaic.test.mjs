import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mosaic } from '../src/layout/mosaic.ts';

const base = { width: 1000, tileSize: 240, gap: 8, minTileSize: 96 };
const photoRatios = [1.5, 0.67, 1.33, 0.75, 1.78, 0.56, 1, 2.4, 0.8, 1.25];
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const photos = (n, size = () => 1) =>
	Array.from({ length: n }, (_, i) => ({ ratio: photoRatios[Math.floor(rand() * 10)], size: size(i) }));

function check(items, opts) {
	const { boxes, height } = mosaic(items, opts);
	assert.equal(boxes.filter(Boolean).length, items.length, 'every tile placed');
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i], b = boxes[j];
			const overlap = a.x < b.x + b.width - 0.01 && b.x < a.x + a.width - 0.01 && a.y < b.y + b.height - 0.01 && b.y < a.y + a.height - 0.01;
			assert.ok(!overlap, `tiles ${i} and ${j} overlap`);
		}
	// No holes above the last band: sample a grid, allowing for gaps.
	const lastTop = Math.min(...boxes.filter((b) => b.y + b.height >= height - 0.5).map((b) => b.y));
	for (let y = 2; y < lastTop - 2; y += 5)
		for (let x = 2; x < opts.width - 2; x += 5) {
			const hit = boxes.some((b) => x >= b.x - opts.gap && x <= b.x + b.width + opts.gap && y >= b.y - opts.gap && y <= b.y + b.height + opts.gap);
			assert.ok(hit, `hole at ${x},${y}`);
		}
	// Exact shapes: nothing is cropped.
	boxes.forEach((b, i) => {
		const shown = b.width / b.height;
		assert.ok(Math.abs(shown / items[i].ratio - 1) < 1e-6, `tile ${i} is ${shown}, not ${items[i].ratio}`);
	});
	return boxes;
}

test('no holes, no overlaps, every photo at its exact shape', () => {
	check(photos(300), base);
});

test('sizes and seams are real-valued, not a few fixed steps', () => {
	const boxes = check(photos(300), base);
	const heights = new Set(boxes.map((b) => Math.round(b.height)));
	assert.ok(heights.size > 100, `${heights.size} distinct heights`);
	const tops = new Set(boxes.map((b) => Math.round(b.y)));
	assert.ok(tops.size > 60, `${tops.size} distinct top edges`);
});

test('more important photos get bigger', () => {
	const items = photos(200, (i) => (i % 5 === 0 ? 2 : i % 5 === 1 ? 0 : 1));
	const boxes = check(items, base);
	const avg = (s) => {
		const areas = boxes.filter((_, i) => items[i].size === s).map((b) => b.width * b.height);
		return areas.reduce((x, y) => x + y, 0) / areas.length;
	};
	assert.ok(avg(2) > avg(1) * 1.5 && avg(1) > avg(0), `large ${avg(2)} medium ${avg(1)} small ${avg(0)}`);
});

test('no tile is shorter than the floor or smaller than its square', () => {
	const boxes = check(photos(300, () => (rand() < 0.4 ? 0 : 1)), { ...base, minTileSize: 120 });
	for (const b of boxes) {
		assert.ok(b.height >= 120 - 0.5, `height ${b.height}`);
		assert.ok(b.width * b.height >= 120 * 120 - 1, `area ${b.width * b.height}`);
	}
});

test('extreme shapes still fit', () => {
	const items = [1.5, 6, 1.33, 0.33, 0.33, 1.5, 1, 1.78, 0.75, 0.75, 1.5, 1.5].map((ratio) => ({ ratio, size: 1 }));
	check(items, base);
});

test('10,000 tiles lay out in reasonable time', () => {
	const items = photos(10000);
	mosaic(items, base);
	const t0 = performance.now();
	mosaic(items, base);
	const ms = performance.now() - t0;
	console.log(`10,000 tiles: ${ms.toFixed(2)} ms`);
	assert.ok(ms < 800, `took ${ms} ms`);
});
