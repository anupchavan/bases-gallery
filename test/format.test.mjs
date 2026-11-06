import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, parseSizeWeight } from '../src/util/format.ts';

test('formatTime: minutes and seconds under an hour', () => {
	assert.equal(formatTime(0), '0:00');
	assert.equal(formatTime(5.9), '0:05');
	assert.equal(formatTime(65), '1:05');
	assert.equal(formatTime(3599), '59:59');
});

test('formatTime: hours pad the minutes', () => {
	assert.equal(formatTime(3600), '1:00:00');
	assert.equal(formatTime(3725), '1:02:05');
});

test('formatTime: bad input reads as zero', () => {
	assert.equal(formatTime(-3), '0:00');
	assert.equal(formatTime(Number.NaN), '0:00');
	assert.equal(formatTime(Number.POSITIVE_INFINITY), '0:00');
});

test('parseSizeWeight: words, letters and numbers', () => {
	assert.equal(parseSizeWeight('small'), 0.6);
	assert.equal(parseSizeWeight(' S '), 0.6);
	assert.equal(parseSizeWeight('Large'), 3);
	assert.equal(parseSizeWeight('l'), 3);
	assert.equal(parseSizeWeight('2'), 2);
	assert.equal(parseSizeWeight('1.5'), 1.5);
});

test('parseSizeWeight: caps big numbers and ignores junk', () => {
	assert.equal(parseSizeWeight('100'), 8);
	assert.equal(parseSizeWeight('medium'), 1);
	assert.equal(parseSizeWeight(''), 1);
	assert.equal(parseSizeWeight('-2'), 1);
	assert.equal(parseSizeWeight('0'), 1);
});

import { parseCoordinates } from '../src/util/format.ts';

test('parseCoordinates: text and lists, as Obsidian Maps reads them', () => {
	assert.deepEqual(parseCoordinates('48.85837, 2.294481'), [48.85837, 2.294481]);
	assert.deepEqual(parseCoordinates('48.85837,2.294481'), [48.85837, 2.294481]);
	assert.deepEqual(parseCoordinates('["48.85837", "2.294481"]'), [48.85837, 2.294481]);
	assert.deepEqual(parseCoordinates('-33.8688, 151.2093'), [-33.8688, 151.2093]);
});

test('parseCoordinates: rejects anything that is not a place', () => {
	assert.equal(parseCoordinates(''), null);
	assert.equal(parseCoordinates('Paris'), null);
	assert.equal(parseCoordinates('48.8'), null);
	assert.equal(parseCoordinates('91, 0'), null);
	assert.equal(parseCoordinates('0, 181'), null);
	assert.equal(parseCoordinates('north, east'), null);
});
