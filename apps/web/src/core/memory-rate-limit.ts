/**
 * Fixed-window rate limiter held in process memory, for a standalone server (Docker) without
 * Upstash. Counts are per process and reset on restart, so it only fits a single app instance;
 * several instances need the Upstash limiter.
 */

interface Window {
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
	const windows = new Map<string, Window>();
	const windowMs = windowSec * 1000;

	function prune(at: number): void {
		for (const [key, window] of windows) {
			if (window.reset <= at) windows.delete(key);
		}
	}

	return {
		async limit(key: string): Promise<{ success: boolean; remaining: number; reset: number }> {
			const at = now();
			let window = windows.get(key);
			if (!window || window.reset <= at) {
				if (!window && windows.size >= PRUNE_THRESHOLD) prune(at);
				window = { count: 0, reset: at + windowMs };
				windows.set(key, window);
			}
			window.count += 1;
			return {
				success: window.count <= limit,
				remaining: Math.max(0, limit - window.count),
				reset: window.reset,
			};
		},
	};
}
