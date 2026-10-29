import assert from 'node:assert/strict';
import test from 'node:test';
import { availableMemberName, releaseMemberName } from '@/core/db/member-names';
import type { DbTransaction } from '@/core/db/transaction';

function fakeTx(selects: unknown[][]) {
	const updates: Array<Record<string, unknown>> = [];
	let call = 0;
	const tx = {
		select: () => ({ from: () => ({ where: async () => selects[call++] ?? [] }) }),
		update: () => ({
			set: (values: Record<string, unknown>) => ({
				where: async () => {
					updates.push(values);
				},
			}),
		}),
	} as unknown as DbTransaction;
	return { tx, updates };
}

test('a free name needs no change', async () => {
	const { tx, updates } = fakeTx([[]]);
	assert.equal(await releaseMemberName(tx, 'wg', 'Anna'), true);
	assert.equal(updates.length, 0);
});

test('an active member with the name blocks it', async () => {
	const { tx, updates } = fakeTx([[{ id: 'm1', name: 'anna', deactivatedAt: null }]]);
	assert.equal(await releaseMemberName(tx, 'wg', 'Anna'), false);
	assert.equal(updates.length, 0);
});

test('a moved-out member with the name is renamed aside', async () => {
	const { tx, updates } = fakeTx([
		[{ id: 'm1', name: 'Anna', deactivatedAt: new Date() }],
		[{ name: 'Anna' }, { name: 'Ben' }],
	]);
	assert.equal(await releaseMemberName(tx, 'wg', 'Anna'), true);
	assert.deepEqual(updates, [{ name: 'Anna (2)' }]);
});

test('the moved-out name is numbered when taken and stays within the length limit', async () => {
	const long = 'x'.repeat(80);
	const { tx, updates } = fakeTx([
		[{ id: 'm1', name: long, deactivatedAt: new Date() }],
		[{ name: long }, { name: `${'x'.repeat(80 - ' (2)'.length)} (2)` }],
	]);
	assert.equal(await releaseMemberName(tx, 'wg', long), true);
	const renamed = String(updates[0]?.name);
	assert.ok(renamed.length <= 80);
	assert.match(renamed, / \(3\)$/);
});

test('an unused name is kept, a used one gets a number', async () => {
	assert.equal(await availableMemberName(fakeTx([[{ name: 'Ben' }]]).tx, 'wg', 'Anna'), 'Anna');
	assert.equal(
		await availableMemberName(fakeTx([[{ name: 'anna' }, { name: 'Anna (2)' }]]).tx, 'wg', 'Anna'),
		'Anna (3)',
	);
});
