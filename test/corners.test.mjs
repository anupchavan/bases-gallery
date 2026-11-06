import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outerCorners, TOP_LEFT, TOP_RIGHT, BOTTOM_RIGHT, BOTTOM_LEFT } from '../src/layout/corners.ts';
import { mosaic } from '../src/layout/mosaic.ts';

// Two full rows of two tiles, then a short last row of one tile.
const g = 8;
const boxes = [
	{ x: 0, y: 0, width: 496, height: 200 },
	{ x: 504, y: 0, width: 496, height: 200 },
	{ x: 0, y: 208, width: 496, height: 200 },
	{ x: 504, y: 208, width: 496, height: 200 },
	{ x: 0, y: 416, width: 300, height: 200 },
];

test('marks the gallery corners and the step of a short last row', () => {
	const f = outerCorners(boxes, g);
	assert.equal(f[0], TOP_LEFT);
	assert.equal(f[1], TOP_RIGHT);
	assert.equal(f[2], 0);
	assert.equal(f[3], BOTTOM_RIGHT);
	assert.equal(f[4], BOTTOM_LEFT | BOTTOM_RIGHT);
});

test('a single tile has four outer corners', () => {
	assert.equal(outerCorners([{ x: 0, y: 0, width: 100, height: 100 }], g)[0], 15);
});

test('a real mosaic has exactly one top-left and one top-right outer corner', () => {
	const items = Array.from({ length: 60 }, (_, i) => ({ ratio: [1.5, 0.67, 1.33, 0.75][i % 4], size: 1 }));
	const { boxes: b } = mosaic(items, { width: 1000, rowHeight: 360, gap: g, maxCropPerSide: 0.1 });
	const f = outerCorners(b, g);
	assert.equal([...f].filter((x) => x & TOP_LEFT).length, 1);
	assert.equal([...f].filter((x) => x & TOP_RIGHT).length, 1);
});
