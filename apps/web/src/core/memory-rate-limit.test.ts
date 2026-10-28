import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryLimiter } from './memory-rate-limit';

test('the memory limiter blocks above the limit and opens again in the next window', async () => {
	let now = 1_000;
	const limiter = createMemoryLimiter(2, 60, () => now);

	assert.deepEqual(await limiter.limit('a'), { success: true, remaining: 1, reset: 61_000 });
	assert.equal((await limiter.limit('a')).success, true);
	assert.deepEqual(await limiter.limit('a'), { success: false, remaining: 0, reset: 61_000 });
	assert.equal((await limiter.limit('b')).success, true, 'keys count separately');

	now = 61_000;
	assert.deepEqual(await limiter.limit('a'), { success: true, remaining: 1, reset: 121_000 });
});
