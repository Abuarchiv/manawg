import assert from 'node:assert/strict';
import { test } from 'node:test';

const { renderMessage, serverRootT } = await import('@/core/i18n/server-t');
const { aboAmountError, aboSplitError, buildRecurringSplits, initialManualMap } = await import(
	'./recurring-form-model'
);

test('amount errors tell too many decimals, too large and too small apart', () => {
	const t = serverRootT('de');
	assert.equal(renderMessage(t, aboAmountError(null, '12,345')), 'Maximal zwei Nachkommastellen.');
	assert.equal(
		renderMessage(t, aboAmountError(2_000_000, '2000000')),
		'Der Betrag darf höchstens 1.000.000 € betragen.',
	);
	assert.equal(
		renderMessage(t, aboAmountError(null, 'abc')),
		'Gib einen Betrag über 0 € ein, z. B. 12,50.',
	);
	assert.equal(
		renderMessage(serverRootT('en'), aboAmountError(null, 'abc')),
		'Enter an amount above €0, for example 12.50.',
	);
});

test('split errors render in both locales', () => {
	assert.equal(
		renderMessage(serverRootT('de'), aboSplitError('splits_empty')),
		'Aufteilung leer — gib mindestens einen Betrag ein.',
	);
	assert.equal(
		renderMessage(serverRootT('en'), aboSplitError('invalid_share')),
		'At least one share is not valid. Enter a valid amount or leave the field empty.',
	);
});

test('manual shares are read and written in the locale of the form', () => {
	const members = [{ id: 'a', name: 'A', active: true, color: null }];
	const input = {
		amountCents: 1250,
		splitMode: 'manual' as const,
		activeMembers: members,
		splitCandidates: members,
		manualSplits: { a: '12.50' },
	};
	assert.deepEqual(buildRecurringSplits({ ...input, locale: 'en' }), [
		{ debtorMemberId: 'a', amountCents: 1250 },
	]);
	assert.deepEqual(buildRecurringSplits({ ...input, manualSplits: { a: '12,50' } }), [
		{ debtorMemberId: 'a', amountCents: 1250 },
	]);
	const initial = {
		description: 'x',
		category: 'sonstiges' as const,
		amountCents: 1250,
		paidByMemberId: 'a',
		intervalMonths: 1,
		nextDueAt: '2026-01-01T00:00:00.000Z',
		splits: [{ debtorMemberId: 'a', amountCents: 1250 }],
	};
	assert.deepEqual(initialManualMap(initial), { a: '12,50' });
	assert.deepEqual(initialManualMap(initial, 'en'), { a: '12.50' });
});
