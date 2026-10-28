/**
 * Fixed-window rate limiter held in process memory, for a standalone server (Docker) without
 * Upstash. Counts are per process and reset on restart, so it only fits a single app instance;
 * several instances need the Upstash limiter.
 */

interface Bucket {
	count: number;
	reset: number;
}

/** Above this many tracked keys, expired windows are dropped before a new key is added. */
const PRUNE_THRESHOLD = 10_000;

export function createMemoryLimiter(
	limit: number,
	windowSec: number,
	now: () => number = Date.now,
) {
	const buckets = new Map<string, Bucket>();
	const windowMs = windowSec * 1000;

	function prune(at: number): void {
		for (const [key, bucket] of buckets) {
			if (bucket.reset <= at) buckets.delete(key);
		}
	}

	return {
		async limit(key: string): Promise<{ success: boolean; remaining: number; reset: number }> {
			const at = now();
			let bucket = buckets.get(key);
			if (!bucket || bucket.reset <= at) {
				if (!bucket && buckets.size >= PRUNE_THRESHOLD) prune(at);
				bucket = { count: 0, reset: at + windowMs };
				buckets.set(key, bucket);
			}
			bucket.count += 1;
			return {
				success: bucket.count <= limit,
				remaining: Math.max(0, limit - bucket.count),
				reset: bucket.reset,
			};
		},
	};
}
