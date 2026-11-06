import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('scores are a single pass: 20,000 notes stay fast', () => {
	const notes = Array.from({ length: 20000 }, (_, i) =>
		note(`n${i}`, [`hub${i % 50}`, `n${(i * 7) % 20000}`], [`#t${i % 30}`], i % 13),
	);
	const t0 = performance.now();
	relatednessScores(notes);
	const ms = performance.now() - t0;
	console.log(`20,000 notes: ${ms.toFixed(1)} ms`);
	assert.ok(ms < 100);
});

test('area weights by rank: top note much bigger, ties equal, no links even', () => {
	const w = areaWeights([10, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
	assert.ok(w[0] > 5, `top ${w[0]}`);
	assert.ok(w[9] > w[1], 'second ranked bigger than the tied rest');
	assert.equal(w[1], w[5]);
	assert.ok(w[1] >= 0.7);
	assert.deepEqual([...areaWeights([2, 2, 2])], [1, 1, 1]);
});
