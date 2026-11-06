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
