import { test } from 'node:test';
import assert from 'node:assert/strict';
import { incomingLinkCounts, connections, sizesFromConnections } from '../src/media/importance.ts';

test('counts distinct linking files, ignoring self links', () => {
	const counts = incomingLinkCounts({
		'a.md': { 'b.md': 3, 'img.jpg': 1, 'a.md': 1 },
		'c.md': { 'b.md': 1 },
		'b.md': { 'img.jpg': 1 },
	});
	assert.equal(counts.get('b.md'), 2);
	assert.equal(counts.get('img.jpg'), 2);
	assert.equal(counts.get('a.md'), undefined);
});

test("a note's own link to its media doesn't count", () => {
	const counts = new Map([['note.md', 2], ['img.jpg', 3]]);
	assert.equal(connections(counts, 'note.md', 'img.jpg', true), 4);
	assert.equal(connections(counts, 'note.md', null, false), 2);
});

test('sizes by rank: most connected large, least connected small', () => {
	const values = [0, 0, 0, 1, 1, 2, 2, 3, 5, 20];
	const sizes = sizesFromConnections(values);
	assert.equal(sizes[9], 2);
	assert.ok(sizes.slice(0, 3).every((s) => s === 0));
	assert.ok(sizes.filter((s) => s === 2).length <= 2);
});

test('equal connections stay medium', () => {
	assert.deepEqual(sizesFromConnections([0, 0, 0, 0]), [1, 1, 1, 1]);
	assert.deepEqual(sizesFromConnections([4, 4, 4]), [1, 1, 1]);
});
