import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	expenseSaveError,
	recurringTemplateSaveError,
} from '../src/features/expenses/expense-errors.ts';
import {
	buildSplitsFromForm,
	equalSplitParticipants,
} from '../src/features/expenses/expense-split-input.ts';
import { recurringSplitsMatchAmount } from '../src/features/expenses/recurring-expenses.ts';

// Split input and validation rules [suite "expense integrity regressions"].

const CALLER_ID = '7d898f9e-5ad7-4f5d-abed-8c3e99a76973';
const PAYER_ID = '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55';

test('expense edit keeps departed historical shares in manual splits', () => {
	const departedId = 'f2e2a748-3888-44fc-8c3c-6badfcad5690';
	const members = [
		{ id: CALLER_ID, active: true },
		{ id: departedId, active: false },
	];
	const historicalSplits = [
		{ debtorMemberId: CALLER_ID, amountCents: 500 },
		{ debtorMemberId: departedId, amountCents: 500 },
	];
	const splitMode =
		equalSplitParticipants(1000, historicalSplits, members) === null ? 'manual' : 'equal';

	assert.equal(splitMode, 'manual');
	assert.deepEqual(
		buildSplitsFromForm({
			splitMode,
			members,
			manualSplits: { [CALLER_ID]: '5', [departedId]: '5' },
			amountCents: 1000,
			rotationOffset: 0,
		}),
		{ ok: true, splits: historicalSplits },
	);
	assert.deepEqual(
		equalSplitParticipants(1000, [{ debtorMemberId: CALLER_ID, amountCents: 1000 }], members),
		[CALLER_ID],
	);
});

test('manual expense splits reject invalid entries and keep blank, zero, and valid shares', () => {
	const members = [
		{ id: CALLER_ID, active: true },
		{ id: PAYER_ID, active: true },
	];
	const build = (manualSplits: Record<string, string>) =>
		buildSplitsFromForm({
			splitMode: 'manual',
			members,
			manualSplits,
			amountCents: 1000,
			rotationOffset: 0,
		});

	assert.deepEqual(build({ [CALLER_ID]: '10', [PAYER_ID]: '-5' }), {
		ok: false,
		reason: 'invalid_share',
	});
	assert.deepEqual(build({ [CALLER_ID]: '10', [PAYER_ID]: 'invalid' }), {
		ok: false,
		reason: 'invalid_share',
	});
	assert.deepEqual(build({ [CALLER_ID]: '6', [PAYER_ID]: '4' }), {
		ok: true,
		splits: [
			{ debtorMemberId: CALLER_ID, amountCents: 600 },
			{ debtorMemberId: PAYER_ID, amountCents: 400 },
		],
	});
	assert.deepEqual(build({ [CALLER_ID]: '10', [PAYER_ID]: '' }), {
		ok: true,
		splits: [{ debtorMemberId: CALLER_ID, amountCents: 1000 }],
	});
	assert.deepEqual(build({ [CALLER_ID]: '10', [PAYER_ID]: '0' }), {
		ok: true,
		splits: [
			{ debtorMemberId: CALLER_ID, amountCents: 1000 },
			{ debtorMemberId: PAYER_ID, amountCents: 0 },
		],
	});
});

test('recurring splits require a valid distribution, including zero-cent shares', () => {
	const first = { debtorMemberId: CALLER_ID, amountCents: 1 };
	const second = { debtorMemberId: PAYER_ID, amountCents: 0 };
	assert.equal(recurringSplitsMatchAmount([first, second], 1), true);
	assert.equal(recurringSplitsMatchAmount([first, first], 2), false);
	assert.equal(
		recurringSplitsMatchAmount(
			[
				{ ...first, amountCents: -1 },
				{ ...second, amountCents: 2 },
			],
			1,
		),
		false,
	);
	assert.equal(recurringSplitsMatchAmount([first, second], 2), false);
});

test('payer guard failures explain how to correct an expense and recurring template', () => {
	const expected = { key: 'expenses-form.errors.paidByMustIncludeCaller' };
	assert.deepEqual(expenseSaveError('paid_by_must_include_caller'), expected);
	assert.deepEqual(recurringTemplateSaveError('paid_by_must_include_caller'), expected);
});
