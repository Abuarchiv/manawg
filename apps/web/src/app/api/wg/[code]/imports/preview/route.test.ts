import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const ACTIVE = '11111111-1111-4111-8111-111111111111';
const MOVED_OUT = '22222222-2222-4222-8222-222222222222';

const wgMembers = { wgId: 'wgMembers.wgId', deactivatedAt: 'wgMembers.deactivatedAt' };
const db = {
	select: () => ({
		from: () => ({
			where: async (predicate: string) => {
				// The route must only ever see active members.
				return predicate.includes('isNull:wgMembers.deactivatedAt')
					? [{ id: ACTIVE, name: 'Alex' }]
					: [
							{ id: ACTIVE, name: 'Alex' },
							{ id: MOVED_OUT, name: 'Sam' },
						];
			},
		}),
	}),
};

// The real parsers stay in place; only the Splitwise CSV parser returns a fixed result.
const parsers = await import('@/features/expenses/import-parsers');

mock.module('@/core/db', { namedExports: { db, wgMembers } });
mock.module('@/core/guards/require-wg-member', {
	namedExports: {
		requireWgMember: async () => ({ ok: true, wg: { id: 'wg' }, member: { memberId: ACTIVE } }),
	},
});
mock.module('@/core/rate-limit', {
	namedExports: { checkRateLimit: async () => ({ success: true }), importLimiter: {} },
});
mock.module('@/features/expenses/import-body', {
	namedExports: {
		MAX_CSV_BYTES: 1_000_000,
		MAX_IMPORT_ROWS: 1_000,
		MAX_OCR_BYTES: 1_000_000,
		readImportJsonBody: async (req: Request) => ({ ok: true, value: await req.json() }),
	},
});
mock.module('@/features/expenses/server/import-hash', {
	namedExports: { hashPayload: () => 'hash' },
});
mock.module('@/features/expenses/import-parsers', {
	namedExports: {
		...parsers,
		parseSplitwiseCsv: () => [
			{ paidByName: 'Alex', splits: [{ memberName: 'Sam', amountCents: 100 }] },
		],
	},
});
mock.module('@/features/expenses/ocr', {
	namedExports: { parseOcrText: () => ({ expenses: [] }) },
});
mock.module('drizzle-orm', {
	namedExports: {
		and: (...parts: unknown[]) => parts.join('&'),
		eq: (column: string) => `eq:${column}`,
		isNull: (column: string) => `isNull:${column}`,
	},
});

const { POST } = await import('./route');

interface PreviewBody {
	members: unknown;
	memberMapping: Record<string, string | null>;
	conflicts: string[];
}

function previewRoute() {
	return async (memberMapping: Record<string, string>) => {
		const response = await POST(
			new Request('https://example.invalid', {
				method: 'POST',
				body: JSON.stringify({ source: 'splitwise_csv', payload: 'csv', memberMapping }),
			}) as never,
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) } as never,
		);
		return { json: async () => (await response.json()) as PreviewBody };
	};
}

test('preview rejects a mapping to a moved-out member as a conflict', async () => {
	const post = previewRoute();
	const body = await (await post({ Sam: MOVED_OUT })).json();
	assert.deepEqual(body.members, [{ id: ACTIVE, name: 'Alex' }]);
	assert.equal(body.memberMapping.Sam, null);
	assert.equal(body.memberMapping.Alex, ACTIVE);
	assert.deepEqual(body.conflicts, ['Sam']);
});

test('preview rejects unknown member ids and keeps valid ones', async () => {
	const post = previewRoute();
	const body = await (await post({ Sam: 'not-a-member', Alex: ACTIVE })).json();
	assert.deepEqual(body.conflicts, ['Sam']);
	const clean = await (await post({ Sam: ACTIVE })).json();
	assert.deepEqual(clean.conflicts, []);
});
