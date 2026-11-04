import assert from 'node:assert/strict';
import { test } from 'node:test';

const { renderMessage, serverRootT } = await import('@/core/i18n/server-t');
const {
	recurringAmountError,
	recurringSplitError,
	recurringDueCheck,
	buildRecurringSplits,
	initialManualMap,
} = await import('./recurring-form-model');
const { todayInputValue } = await import('@/core/utils/local-date');

test('amount errors tell too many decimals, too large and too small apart', () => {
	const t = serverRootT('de');
	assert.equal(
		renderMessage(t, recurringAmountError(null, '12,345')),
		'Maximal zwei Nachkommastellen.',
	);
	assert.equal(
		renderMessage(t, recurringAmountError(2_000_000, '2000000')),
		'Der Betrag darf höchstens 1.000.000 € betragen.',
	);
	assert.equal(
		renderMessage(t, recurringAmountError(null, 'abc')),
		'Gib einen Betrag über 0 € ein, z. B. 12,50.',
	);
	assert.equal(
		renderMessage(serverRootT('en'), recurringAmountError(null, 'abc')),
		'Enter an amount above €0, for example 12.50.',
	);
});

test('split errors render in both locales', () => {
	assert.equal(
		renderMessage(serverRootT('de'), recurringSplitError('splits_empty')),
		'Aufteilung leer — gib mindestens einen Betrag ein.',
	);
	assert.equal(
		renderMessage(serverRootT('en'), recurringSplitError('invalid_share')),
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
		category: 'other' as const,
		amountCents: 1250,
		paidByMemberId: 'a',
		intervalMonths: 1,
		nextDueAt: '2026-01-01T00:00:00.000Z',
		splits: [{ debtorMemberId: 'a', amountCents: 1250 }],
	};
	assert.deepEqual(initialManualMap(initial), { a: '12,50' });
	assert.deepEqual(initialManualMap(initial, 'en'), { a: '12.50' });
});

function inputDateOffset(days: number): string {
	return todayInputValue(new Date(Date.now() + days * 86_400_000));
}

test('a first due date outside the server bounds is out of range and promises no back-bookings', () => {
	const today = todayInputValue();
	assert.deepEqual(recurringDueCheck(inputDateOffset(-400), undefined, today, 1), {
		outOfRange: true,
		missedBookings: 0,
	});
	assert.deepEqual(recurringDueCheck(inputDateOffset(3651), undefined, today, 1), {
		outOfRange: true,
		missedBookings: 0,
	});
});

test('a first due date in the past but within range announces its back-bookings', () => {
	const check = recurringDueCheck(inputDateOffset(-30), undefined, todayInputValue(), 1);
	assert.equal(check.outOfRange, false);
	assert.ok(check.missedBookings > 0);
});

test('an unchanged long-overdue date stays valid in edit mode', () => {
	const initialIso = new Date(Date.now() - 400 * 86_400_000).toISOString();
	const unchanged = todayInputValue(new Date(initialIso));
	assert.deepEqual(recurringDueCheck(unchanged, initialIso, todayInputValue(), 1), {
		outOfRange: false,
		missedBookings: 0,
	});
	assert.equal(
		recurringDueCheck(inputDateOffset(-500), initialIso, todayInputValue(), 1).outOfRange,
		true,
	);
});
