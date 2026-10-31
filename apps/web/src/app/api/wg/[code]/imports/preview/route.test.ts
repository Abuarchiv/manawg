import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const ACTIVE = '11111111-1111-4111-8111-111111111111';
const MOVED_OUT = '22222222-2222-4222-8222-222222222222';
let activeMember = { id: ACTIVE, name: 'Alex' };
let splitwiseExpenses = [{ paidByName: 'Alex', splits: [{ memberName: 'Sam', amountCents: 100 }] }];

const wgMembers = { wgId: 'wgMembers.wgId', deactivatedAt: 'wgMembers.deactivatedAt' };
const db = {
	select: () => ({
		from: () => ({
			where: async (predicate: string) => {
				// The route must only ever see active members.
				return predicate.includes('isNull:wgMembers.deactivatedAt')
					? [activeMember]
					: [activeMember, { id: MOVED_OUT, name: 'Sam' }];
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
		parseSplitwiseCsv: () => splitwiseExpenses,
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
	fuzzyNames: string[];
}

function previewRoute() {
	return async (memberMapping: unknown) => {
		const response = await POST(
			Object.assign(
				new Request('https://example.invalid', {
					method: 'POST',
					body: JSON.stringify({ source: 'splitwise_csv', payload: 'csv', memberMapping }),
				}),
				{ cookies: { get: () => undefined } },
			) as never,
			{ params: Promise.resolve({ code: 'MTE8PZAT' }) } as never,
		);
		return {
			status: response.status,
			json: async () => (await response.json()) as PreviewBody,
		};
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

test('preview preserves __proto__ as an own member mapping key', async () => {
	const previousExpenses = splitwiseExpenses;
	splitwiseExpenses = [{ paidByName: '__proto__', splits: [] }];
	try {
		const mapping = Object.fromEntries([['__proto__', ACTIVE]]);
		const response = await previewRoute()(mapping);
		const body = await response.json();
		assert.equal(response.status, 200);
		assert.equal(Object.hasOwn(body.memberMapping, '__proto__'), true);
		assert.equal(Reflect.get(body.memberMapping, '__proto__'), ACTIVE);
		assert.deepEqual(body.conflicts, []);
	} finally {
		splitwiseExpenses = previousExpenses;
	}
});

test('explicit null preserves the existing fuzzy suggestion and warning', async () => {
	const previousMember = activeMember;
	const previousExpenses = splitwiseExpenses;
	activeMember = { id: ACTIVE, name: 'Katarina' };
	splitwiseExpenses = [{ paidByName: 'Katharina', splits: [] }];
	try {
		const body = await (await previewRoute()({ Katharina: null })).json();
		assert.equal(body.memberMapping.Katharina, ACTIVE);
		assert.deepEqual(body.fuzzyNames, ['Katharina']);
	} finally {
		activeMember = previousMember;
		splitwiseExpenses = previousExpenses;
	}
});

test('preview rejects invalid member mapping shapes and values', async () => {
	const post = previewRoute();
	for (const memberMapping of [null, [], 'invalid', { Alex: 123 }]) {
		assert.equal((await post(memberMapping)).status, 400);
	}
});

test('preview keeps an impossible long Splid payer unmapped for manual review', async () => {
	const payer = 'a'.repeat(100_000);
	const response = await POST(
		Object.assign(
			new Request('https://example.invalid', {
				method: 'POST',
				body: JSON.stringify({
					source: 'splid_csv',
					payload: `Date,Description,Amount,Payer\n2026-10-30,Shared groceries,12.00,${payer}`,
				}),
			}),
			{ cookies: { get: () => undefined } },
		) as never,
		{ params: Promise.resolve({ code: 'MTE8PZAT' }) } as never,
	);
	assert.equal(response.status, 200);
	const body = (await response.json()) as PreviewBody;
	assert.equal(body.memberMapping[payer], null);
	assert.deepEqual(body.conflicts, [payer]);
});
