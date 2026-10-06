// A skipped import row needs no member mapping: the commit route must not reject a preview whose
// only mapping conflict is on a row the user chose to skip.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { mockModuleWithReal } from './support/module-mocks';
import { mockWgRouteInfrastructure } from './support/route-mocks';

const WG_ID = '989ac820-58b7-431f-9c65-28721264f333';
const CALLER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';

const parsedExpense = {
	date: '2026-09-01T00:00:00.000Z',
	description: 'Alte Ausgabe',
	amountCents: 500,
	currency: 'EUR' as const,
	paidByName: 'Ausgetretene Person',
	splits: [{ memberName: 'Ausgetretene Person', amountCents: 500 }],
	warnings: [],
};
let committed: Record<string, unknown> | undefined;

await mockWgRouteInfrastructure({
	requireWgMember: async () => ({
		ok: true,
		wg: { id: WG_ID, name: 'WG', shareCode: 'MTE8PZAT' },
		member: { memberId: CALLER_ID, name: 'Mina' },
	}),
});
await mockModuleWithReal('@/core/guards/admin', { isWgAdmin: async () => false });
await mockModuleWithReal('@/core/guards/route-preamble', {
	readShareCode: async () => ({ ok: true, code: 'MTE8PZAT' }),
});
await mockModuleWithReal('@/core/idempotency-store', {
	claimResponseSlot: async () => true,
	getCachedResponse: async () => null,
	readIdempotencyKey: () => null,
});
await mockModuleWithReal('@/features/expenses/import-body', {
	MAX_CSV_BYTES: 100_000,
	MAX_OCR_BYTES: 100_000,
	readImportJsonBody: async (req: Request) => ({ ok: true, value: await req.json() }),
});
await mockModuleWithReal('@/features/expenses/import-commit', {
	commitImport: async (
		_replay: unknown,
		prepare: () => Promise<{ stop: Response } | { input: Record<string, unknown> }>,
	) => {
		const prepared = await prepare();
		if ('stop' in prepared) return { kind: 'stopped', response: prepared.stop };
		committed = prepared.input;
		return {
			kind: 'committed',
			result: { importId: 'import-1', inserted: 0, skipped: 1, errors: [], warning: null },
		};
	},
});
await mockModuleWithReal('@/features/expenses/import-hash', { hashPayload: () => 'payload-hash' });
await mockModuleWithReal('@/features/expenses/import-parsers', {
	parseSplitwiseCsv: () => [parsedExpense],
	parseSplidCsv: () => [parsedExpense],
});
await mockModuleWithReal('@/features/expenses/ocr', {
	parseOcrText: () => ({ expenses: [parsedExpense] }),
});

const route = await import('../src/app/api/wg/[code]/imports/commit/route');

test('import route ignores mapping conflicts on skipped rows', async () => {
	const response = await route.POST(
		new NextRequest('http://localhost', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				source: 'splitwise_csv',
				payload: 'ignored row',
				memberMapping: {},
				previewPayloadHash: 'payload-hash',
				skipIndexes: [0],
			}),
		}),
		{ params: Promise.resolve({ code: 'MTE8PZAT' }) },
	);

	assert.equal(response.status, 200);
	assert.deepEqual(committed?.expenses, [{ parsed: parsedExpense, skip: true }]);
});
