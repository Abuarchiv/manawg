// The import commit route answers with the known delivery warning even when persisting it on the
// replay row fails, and a failed commit keeps answering with its real error on same-key retries.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { NextRequest } from 'next/server';
import { assertMatchObject } from './support/match-object';
import { mockModuleWithReal } from './support/module-mocks';

type Warning = 'notification_delivery_failed' | 'notification_delivery_unknown';
const warning: Warning = 'notification_delivery_failed';

/** Replay-row persistence and commit outcome of the route under test. */
let current: {
	persist: () => Promise<boolean>;
	commit: (() => Promise<unknown>) | undefined;
	logs: number;
} = { persist: async () => true, commit: undefined, logs: 0 };

const result = {
	importId: 'import-1',
	inserted: 1,
	skipped: 0,
	errors: [],
	warning,
};

await mockModuleWithReal('@/core/http/api-errors', {
	badRequest: () => new Response(null, { status: 400 }),
	conflict: () => new Response(null, { status: 409 }),
	serverError: () => new Response(null, { status: 500 }),
	tooMany: () => new Response(null, { status: 429 }),
});
await mockModuleWithReal('@/core/guards/admin', { isWgAdmin: async () => false });
await mockModuleWithReal('@/core/guards/require-wg-member', {
	requireWgMember: async () => ({
		ok: true,
		wg: { id: 'wg', name: 'WG', shareCode: 'MTE8PZAT' },
		member: { memberId: 'member', name: 'Member' },
	}),
});
await mockModuleWithReal('@/core/guards/route-preamble', {
	readShareCode: async () => ({ ok: true, code: 'MTE8PZAT' }),
});
// The route writes through withIdempotentWrite; its slot claim wins and nothing is stored yet.
await mockModuleWithReal('@/core/idempotency-store', {
	readIdempotencyKey: () => 'key',
	setReplayWarning: () => current.persist(),
	claimResponseSlot: async () => true,
	getCachedResponse: async () => null,
});
await mockModuleWithReal('@/core/infra/observability', {
	logApiError: () => {
		current.logs += 1;
	},
});
await mockModuleWithReal('@/core/rate-limit', {
	checkRateLimit: async () => ({ success: true }),
	importCommitLimiter: {},
});
await mockModuleWithReal('@/features/expenses/import-body', {
	MAX_CSV_BYTES: 5 * 1024 * 1024,
	MAX_OCR_BYTES: 1024 * 1024,
	readImportJsonBody: async (req: Request) => ({ ok: true, value: await req.json() }),
});
await mockModuleWithReal('@/features/expenses/server/import-commit', {
	commitImport: async (
		_replay: unknown,
		prepare: () => Promise<{ stop: Response } | { input: unknown }>,
	) => {
		const prepared = await prepare();
		if ('stop' in prepared) return { kind: 'stopped', response: prepared.stop };
		return { kind: 'committed', result: current.commit ? await current.commit() : result };
	},
});
await mockModuleWithReal('@/features/expenses/server/import-hash', { hashPayload: () => 'hash' });
await mockModuleWithReal('@/features/expenses/import-parsers', {
	UnsupportedCurrencyError: class extends Error {},
	findMappingConflicts: () => [],
	parseSplidCsv: () => [{ paidByName: 'Member', splits: [] }],
	parseSplitwiseCsv: () => [{ paidByName: 'Member', splits: [] }],
});
await mockModuleWithReal('@/features/expenses/ocr', { parseOcrText: () => ({ expenses: [] }) });

const route = await import('../src/app/api/wg/[code]/imports/commit/route');

function importRoute(persist: () => Promise<boolean>, commit?: () => Promise<unknown>) {
	const harness = { persist, commit, logs: 0 };
	return {
		logs: () => harness.logs,
		post: () => {
			current = harness;
			return route.POST(
				new NextRequest('https://example.invalid', {
					method: 'POST',
					body: JSON.stringify({ source: 'splitwise_csv', payload: 'data', memberMapping: {} }),
				}),
				{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
			);
		},
	};
}

describe('import warning persistence', () => {
	test('immediate response preserves a known warning when persistence fails', async () => {
		const saved = importRoute(async () => true);
		assertMatchObject(await (await saved.post()).json(), { warning });
		assert.equal(saved.logs(), 0);

		const missing = importRoute(async () => false);
		assertMatchObject(await (await missing.post()).json(), { warning });
		assert.equal(missing.logs(), 1);

		const failed = importRoute(async () => {
			throw new Error('db_unavailable');
		});
		assertMatchObject(await (await failed.post()).json(), { warning });
		assert.equal(failed.logs(), 1);
	});

	// Releasing the claim after a failed commit is the primitive's job (tests/idempotent-write).
	test('a failed commit answers with the real error on every same-key retry', async () => {
		const failing = importRoute(
			async () => true,
			async () => {
				throw new Error('member_not_in_wg');
			},
		);
		assert.equal((await failing.post()).status, 400);
		assert.equal((await failing.post()).status, 400);

		const succeeding = importRoute(async () => true);
		assert.equal((await succeeding.post()).status, 200);
	});
});
