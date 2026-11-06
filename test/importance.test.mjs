import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growth } from './timing.mjs';
import { incomingLinkCounts, relatednessScores, areaWeights } from '../src/media/importance.ts';

test('counts distinct linking files, ignoring self links', () => {
	const counts = incomingLinkCounts({ 'a.md': { 'b.md': 3, 'a.md': 1 }, 'c.md': { 'b.md': 1 } });
	assert.equal(counts.get('b.md'), 2);
	assert.equal(counts.get('a.md'), undefined);
});

const note = (path, links = [], tags = [], backlinks = 0) => ({ path, links, tags, backlinks });

test('shared links, shared tags, direct links and backlinks all raise the score', () => {
	const base = relatednessScores([note('a'), note('b'), note('c')]);
	assert.deepEqual([...base], [0, 0, 0]);
	const s = relatednessScores([
		note('a', ['x', 'y'], ['#trip']),
		note('b', ['x', 'y'], ['#trip']),
		note('c', ['z'], [], 0),
		note('d', ['a'], [], 5),
	]);
	assert.ok(s[0] > s[2], 'sharing links and tags beats nothing');
	assert.ok(s[3] > s[2], 'backlinks count');
	assert.ok(s[0] > relatednessScores([note('a', ['x', 'y'], ['#trip']), note('b', ['x', 'y'])])[0], 'tags add');
});

test('scores are a single pass: time grows linearly up to 20,000 notes', () => {
	const make = (n) =>
		Array.from({ length: n }, (_, i) => note(`n${i}`, [`hub${i % 50}`, `n${(i * 7) % n}`], [`#t${i % 30}`], i % 13));
	const ratio = growth(make, (notes) => relatednessScores(notes), 20000);
	console.log(`5,000 to 20,000 notes: ${ratio.toFixed(1)}x the time`);
	assert.ok(ratio < 10, `grew ${ratio.toFixed(1)}x for 4x the notes`);
});

test('area weights by rank: top note much bigger, ties equal, no links even', () => {
	const w = areaWeights([10, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
	assert.ok(w[0] > 5, `top ${w[0]}`);
	assert.ok(w[9] > w[1], 'second ranked bigger than the tied rest');
	assert.equal(w[1], w[5]);
	assert.ok(w[1] >= 0.7);
	assert.deepEqual([...areaWeights([2, 2, 2])], [1, 1, 1]);
});
