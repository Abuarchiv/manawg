import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { NextResponse } from 'next/server';

interface LimitResult {
	success: boolean;
	remaining: number;
	reset: number;
	limiterUnavailable?: boolean;
}

const state = {
	calls: [] as Array<{ limiter: unknown; key: unknown; mode: unknown }>,
	limitResult: { success: true, remaining: 3, reset: 0 } as LimitResult,
};

mock.module('@/core/http/api-errors', {
	namedExports: {
		tooMany: (message: string, code: string) =>
			Response.json({ error: message, code }, { status: 429 }),
		rateLimitResponse: (result: { success: boolean }) =>
			result.success ? null : Response.json({ error: 'too_many' }, { status: 429 }),
	},
});
mock.module('@/core/rate-limit', {
	namedExports: {
		wgShareCodeMissLimiter: 'miss-limiter',
		checkRateLimit: async (limiter: unknown, key: unknown, mode: unknown) => {
			state.calls.push({ limiter, key, mode });
			return state.limitResult;
		},
	},
});

const { shareCodeMissResponse } = await import('./share-code-miss');

function setLimit(limitResult: LimitResult): void {
	state.calls = [];
	state.limitResult = limitResult;
}

const miss = (body: unknown, status: number) => Response.json(body, { status }) as NextResponse;

test('keeps the original miss answer while the account has budget', async () => {
	setLimit({ success: true, remaining: 3, reset: 0 });
	const original = miss({ error: 'wg_not_found' }, 404);
	assert.equal(await shareCodeMissResponse('user-1', original), original);
	assert.deepEqual(state.calls, [{ limiter: 'miss-limiter', key: 'user-1', mode: 'open' }]);
});

test('answers 429 instead of the existence oracle once the budget is spent', async () => {
	setLimit({ success: false, remaining: 0, reset: Date.now() });
	const response = await shareCodeMissResponse('user-1', miss({ error: 'not_a_member' }, 401));
	assert.equal(response.status, 429);
});

test('an unavailable limiter never blocks the original answer', async () => {
	setLimit({ success: false, remaining: 0, reset: Date.now(), limiterUnavailable: true });
	const original = miss({ error: 'wg_not_found' }, 404);
	assert.equal(await shareCodeMissResponse('user-1', original), original);
});
