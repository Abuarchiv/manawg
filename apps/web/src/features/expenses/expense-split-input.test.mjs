import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = fileURLToPath(new URL('../../..', import.meta.url));
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith('@/')) {
			const path = resolve(appRoot, 'src', `${specifier.slice(2)}.ts`);
			return nextResolve(pathToFileURL(path).href, context);
		}
		return nextResolve(specifier, context);
	},
});

const { buildSplitsFromForm, isEqualExpenseSplit } = await import('./expense-split-input.ts');

const members = [
	{ id: 'a', active: true },
	{ id: 'b', active: true },
	{ id: 'c', active: true },
];

test('an equal split saved with a rotation offset reopens as equal', () => {
	// 10,01 € over three people: one of them carries the extra cent. The
	// rotation seed moves that cent away from the first member.
	for (const rotationOffset of [0, 1, 2, 5]) {
		const result = buildSplitsFromForm({
			splitMode: 'equal',
			members,
			manualSplits: {},
			amountCents: 1001,
			rotationOffset,
		});
		assert.equal(result.ok, true);
		assert.equal(isEqualExpenseSplit(1001, result.splits, members), true, `offset ${rotationOffset}`);
	}
});

test('an uneven manual split is not mistaken for an equal one', () => {
	const splits = [
		{ debtorMemberId: 'a', amountCents: 333 },
		{ debtorMemberId: 'b', amountCents: 333 },
		{ debtorMemberId: 'c', amountCents: 335 },
	];
	assert.equal(isEqualExpenseSplit(1001, splits, members), false);
});

test('a split missing an active member is not equal', () => {
	const splits = [
		{ debtorMemberId: 'a', amountCents: 334 },
		{ debtorMemberId: 'a', amountCents: 334 },
		{ debtorMemberId: 'b', amountCents: 333 },
	];
	assert.equal(isEqualExpenseSplit(1001, splits, members), false);
});
