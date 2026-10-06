import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

interface LimitResult {
	success: boolean;
	remaining: number;
	reset: number;
	limiterUnavailable?: boolean;
}

const MISS_LIMITER = { name: 'miss-limiter' };
const state = {
	result: { success: true, remaining: 3, reset: 0 } as LimitResult,
	calls: [] as { limiter: unknown; key: string; mode: string }[],
};

mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});
mock.module('@/core/rate-limit', {
	namedExports: {
		wgShareCodeMissLimiter: MISS_LIMITER,
		checkRateLimit: async (limiter: unknown, key: string, mode: string) => {
			state.calls.push({ limiter, key, mode });
			return state.result;
		},
	},
});

const { shareCodeMissResponse } = await import('./share-code-miss');

function given(result: LimitResult): void {
	state.result = result;
	state.calls = [];
}

test('keeps the original miss answer while the account has budget', async () => {
	given({ success: true, remaining: 3, reset: 0 });
	const original = Response.json({ error: 'wg_not_found' }, { status: 404 });
	assert.equal(await shareCodeMissResponse('user-1', original as never), original);
	assert.deepEqual(state.calls, [{ limiter: MISS_LIMITER, key: 'user-1', mode: 'open' }]);
});

test('answers 429 instead of the existence oracle once the budget is spent', async () => {
	given({ success: false, remaining: 0, reset: Date.now() });
	const response = await shareCodeMissResponse(
		'user-1',
		Response.json({ error: 'not_a_member' }, { status: 401 }) as never,
	);
	assert.equal(response.status, 429);
	assert.deepEqual(await response.json(), { error: 'rate_limited', code: 'rate_limited' });
});

test('an unavailable limiter never blocks the original answer', async () => {
	given({ success: false, remaining: 0, reset: Date.now(), limiterUnavailable: true });
	const original = Response.json({ error: 'wg_not_found' }, { status: 404 });
	assert.equal(await shareCodeMissResponse('user-1', original as never), original);
});
