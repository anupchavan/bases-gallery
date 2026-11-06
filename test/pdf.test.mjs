import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extensionOf, mediaKindOf, remoteKindOf } from '../src/media/kinds.ts';
import { pageSize, renderScale } from '../src/media/pdf-page.ts';

test('recognises PDFs in any case', () => {
	assert.equal(mediaKindOf('pdf'), 'pdf');
	assert.equal(mediaKindOf('PDF'), 'pdf');
	assert.equal(mediaKindOf('jpg'), 'image');
	assert.equal(mediaKindOf('mp4'), 'video');
	assert.equal(mediaKindOf('md'), null);
});

test('reads the extension of the last path segment', () => {
	assert.equal(extensionOf('papers/Attention is all you need.pdf'), 'pdf');
	assert.equal(extensionOf('a.b/report'), '');
	assert.equal(extensionOf('.pdf'), '');
	assert.equal(mediaKindOf(extensionOf('Scans/2024.03.receipt.PDF')), 'pdf');
});

test('leaves remote PDFs out and treats unknown URLs as images', () => {
	assert.equal(remoteKindOf('/files/paper.pdf'), null);
	assert.equal(remoteKindOf('/photo.webp'), 'image');
	assert.equal(remoteKindOf('/clip.webm'), 'video');
	assert.equal(remoteKindOf('/image'), 'image');
});

test('page size from the page box', () => {
	assert.deepEqual(pageSize([0, 0, 612, 792], 0), { width: 612, height: 792 });
	// Boxes need not start at the origin.
	assert.deepEqual(pageSize([10, 20, 605, 862], 0), { width: 595, height: 842 });
});

test('page size swaps sides for quarter turns', () => {
	assert.deepEqual(pageSize([0, 0, 612, 792], 90), { width: 792, height: 612 });
	assert.deepEqual(pageSize([0, 0, 612, 792], 270), { width: 792, height: 612 });
	assert.deepEqual(pageSize([0, 0, 612, 792], -90), { width: 792, height: 612 });
	assert.deepEqual(pageSize([0, 0, 612, 792], 180), { width: 612, height: 792 });
	assert.deepEqual(pageSize([0, 0, 612, 792], 450), { width: 792, height: 612 });
});

test('page size rejects empty or broken boxes', () => {
	assert.equal(pageSize([0, 0, 0, 792], 0), null);
	assert.equal(pageSize([], 0), null);
	assert.equal(pageSize([0, 0, Number.NaN, 792], 0), null);
	assert.equal(pageSize([0, 0, Infinity, 792], 0), null);
});

test('render scale puts the longest side at the bucket', () => {
	assert.equal(renderScale({ width: 612, height: 792 }, 792), 1);
	assert.equal(renderScale({ width: 792, height: 612 }, 396), 0.5);
});
