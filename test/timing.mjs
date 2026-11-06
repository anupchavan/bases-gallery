/**
 * Timing checks that hold on slow, shared CI machines: instead of a fixed
 * budget in milliseconds, they check how time grows with input size.
 */

/** Fastest of a few runs, in ms: the least disturbed by other work on the machine. */
export function bestOf(run, runs = 5) {
	run(); // warm up
	let best = Infinity;
	for (let i = 0; i < runs; i++) {
		const t0 = performance.now();
		run();
		best = Math.min(best, performance.now() - t0);
	}
	return best;
}

/**
 * Time at size n divided by time at size n / 4. Linear work gives about 4,
 * n log n a little more, quadratic about 16; tests allow up to 10 for noise.
 */
export function growth(make, run, n) {
	const small = make(n / 4);
	const large = make(n);
	return bestOf(() => run(large)) / Math.max(bestOf(() => run(small)), 0.01);
}
