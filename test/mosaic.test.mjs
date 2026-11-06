import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mosaic } from '../src/layout/mosaic.ts';

const base = { width: 1000, tileSize: 240, gap: 8, maxCropPerSide: 0.1 };

function perSideCrop(box, ratio) {
	const shown = box.width / box.height;
	return shown < ratio ? (1 - shown / ratio) / 2 : (1 - ratio / shown) / 2;
}

function noOverlap(boxes) {
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i], b = boxes[j];
			const overlap = a.x < b.x + b.width - 0.01 && b.x < a.x + a.width - 0.01 && a.y < b.y + b.height - 0.01 && b.y < a.y + a.height - 0.01;
			assert.ok(!overlap, `tiles ${i} and ${j} overlap`);
		}
}

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const photoRatios = [1.5, 0.67, 1.33, 0.75, 1.78, 0.56, 1, 2.4, 0.8, 1.25];

test('tiles never overlap and stay inside the width', () => {
	const items = Array.from({ length: 200 }, (_, i) => ({ ratio: photoRatios[i % 10], size: i % 7 === 0 ? 2 : i % 5 === 0 ? 0 : 1 }));
	const layout = mosaic(items, base);
	noOverlap(layout.boxes);
	for (const b of layout.boxes) assert.ok(b.x >= 0 && b.x + b.width <= 1000 + 0.01);
});

test('crop stays within the cap for common photo shapes', () => {
	const items = photoRatios.flatMap((ratio) => [0, 1, 2].map((size) => ({ ratio, size })));
	const layout = mosaic(items, base);
	layout.boxes.forEach((b, i) => {
		const c = perSideCrop(b, items[i].ratio);
		assert.ok(c <= 0.1 + 1e-9, `ratio ${items[i].ratio} size ${items[i].size}: ${(c * 100).toFixed(1)}% per side`);
	});
});

test('extreme shapes keep their shape', () => {
	const items = [{ ratio: 6, size: 1 }, { ratio: 0.33, size: 1 }, { ratio: 1.5, size: 1 }];
	const layout = mosaic(items, base);
	layout.boxes.forEach((b, i) => assert.ok(perSideCrop(b, items[i].ratio) <= 0.1 + 1e-9));
});

test('large tiles are bigger than small ones', () => {
	const layout = mosaic([{ ratio: 1, size: 0 }, { ratio: 1, size: 1 }, { ratio: 1, size: 2 }], base);
	const [s, m, l] = layout.boxes.map((b) => b.width * b.height);
	assert.ok(s < m && m < l, `${s} ${m} ${l}`);
});

test('few holes with mixed photos', () => {
	const items = Array.from({ length: 500 }, () => ({ ratio: photoRatios[Math.floor(rand() * 10)], size: rand() < 0.1 ? 2 : rand() < 0.2 ? 0 : 1 }));
	const layout = mosaic(items, base);
	const cells = (layout.height + 8) / ((1000 - 8 * (layout.columns - 1)) / layout.columns + 8) * layout.columns;
	console.log(`holes: ${layout.holes} of ~${Math.round(cells)} cells (${((layout.holes / cells) * 100).toFixed(1)}%), ${layout.columns} columns`);
	assert.ok(layout.holes / cells < 0.08);
});

test('10,000 tiles lay out quickly', () => {
	const items = Array.from({ length: 10000 }, () => ({ ratio: 0.3 + rand() * 2.7, size: rand() < 0.1 ? 2 : 1 }));
	mosaic(items, base);
	const t0 = performance.now();
	const layout = mosaic(items, base);
	const ms = performance.now() - t0;
	console.log(`10,000 tiles: ${ms.toFixed(2)} ms, holes ${layout.holes}`);
	assert.ok(ms < 100);
});
