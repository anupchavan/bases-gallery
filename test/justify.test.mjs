import { test } from 'node:test';
import assert from 'node:assert/strict';
import { justify } from '../src/layout/justify.ts';

const base = { width: 1000, targetHeight: 200, gap: 8, maxCropPerSide: 0.1 };
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

function rowEnds(layout, opts) {
	for (const row of layout.rows) {
		const last = layout.boxes[row.end - 1];
		if (row.end === layout.boxes.length) continue;
		assert.ok(near(last.x + last.width, opts.width), `row ${row.start} ends at ${last.x + last.width}`);
	}
}

function cropWithinCap(layout, ratios, cap) {
	layout.boxes.forEach((b, i) => {
		const shown = b.width / b.height;
		const r = ratios[i];
		const perSide = shown < r ? (1 - shown / r) / 2 : (1 - r / shown) / 2;
		assert.ok(perSide <= cap + 1e-9, `tile ${i} loses ${(perSide * 100).toFixed(1)}% per side`);
	});
}

test('empty input', () => {
	assert.deepEqual(justify([], base), { boxes: [], rows: [], height: 0 });
});

test('rows fill the width and stay near the target height', () => {
	const ratios = [1.5, 0.75, 1.33, 1, 1.78, 0.56, 1.5, 1.5, 2, 0.8, 1.2, 1.33];
	const layout = justify(ratios, base);
	rowEnds(layout, base);
	for (const row of layout.rows.slice(0, -1)) {
		assert.ok(row.height >= 150 - 1e-9 && row.height <= 250 + 1e-9, `row height ${row.height}`);
	}
	cropWithinCap(layout, ratios, base.maxCropPerSide);
});

test('no crop when the cap is 0', () => {
	const ratios = [1.5, 0.75, 1.33, 1, 1.78, 0.56, 1.5, 3, 0.33, 1.2];
	const opts = { ...base, maxCropPerSide: 0 };
	const layout = justify(ratios, opts);
	cropWithinCap(layout, ratios, 0);
});

test('extreme shapes keep their shape', () => {
	const ratios = [1.5, 6, 1.33, 0.33, 0.33, 1.5, 1, 1.78];
	const layout = justify(ratios, base);
	cropWithinCap(layout, ratios, base.maxCropPerSide);
	const pano = layout.boxes[1];
	assert.ok(pano.width / pano.height > 6 * 0.8 - 1e-9, 'panorama stays wide');
});

test('a panorama wider than the row gets a shorter row, uncropped', () => {
	const ratios = [1.5, 10, 1.5];
	const layout = justify(ratios, base);
	const pano = layout.boxes[1];
	cropWithinCap(layout, ratios, base.maxCropPerSide);
	assert.ok(pano.height < 150, `panorama row is shorter (${pano.height})`);
	rowEnds(layout, base);
});

test('last row is left at the target height when it cannot fill', () => {
	const layout = justify([1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1], base);
	const last = layout.rows.at(-1);
	assert.equal(last.height, 200);
	const lastBox = layout.boxes.at(-1);
	assert.ok(lastBox.x + lastBox.width < 1000);
});

test('rows stack with the gap between them', () => {
	const layout = justify(Array(30).fill(1.5), base);
	for (let i = 1; i < layout.rows.length; i++) {
		const prev = layout.rows[i - 1];
		assert.ok(near(layout.rows[i].y, prev.y + prev.height + 8));
	}
});

test('bad ratios fall back to square', () => {
	const layout = justify([NaN, 0, -1, Infinity], base);
	assert.equal(layout.boxes.length, 4);
	for (const b of layout.boxes) assert.ok(Number.isFinite(b.width) && b.width > 0);
});

test('10,000 tiles lay out quickly', () => {
	let seed = 1;
	const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
	const ratios = Array.from({ length: 10000 }, () => 0.3 + rand() * 2.7);
	justify(ratios, base); // warm up
	const t0 = performance.now();
	const layout = justify(ratios, base);
	const ms = performance.now() - t0;
	console.log(`10,000 tiles: ${ms.toFixed(2)} ms, ${layout.rows.length} rows`);
	cropWithinCap(layout, ratios, base.maxCropPerSide);
	assert.ok(ms < 50, `took ${ms} ms`);
});
