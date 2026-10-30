import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQueueEditDraft, buildQueueEditHref, isEmptyModuleDraft } from './drafts';

const action = (type: string, payload: Record<string, unknown>) =>
	({ id: `queued-${type}`, type, payload }) as never;

test('a queued absence opens in the Putzplan chore draft that the page reads', () => {
	const draft = buildQueueEditDraft(
		action('absence.create', {
			memberId: 'm1',
			startDate: '2026-10-01',
			endDate: '2026-10-03',
			reason: 'Urlaub',
		}),
	);
	assert.equal(draft?.module, 'chore');
	assert.equal(draft?.draft.queueEditId, 'queued-absence.create');
	assert.equal(draft?.draft.absenceStartDate, '2026-10-01');
	assert.equal(
		buildQueueEditHref('MTE8PZAT', 'chore', { openAbsencesPanel: true }),
		'/wg/MTE8PZAT/chores?panel=absences',
	);
});

test('queued updates offer no edit draft because no form can apply them', () => {
	assert.equal(buildQueueEditDraft(action('shopping.update', { name: 'Milch' })), null);
	assert.equal(
		buildQueueEditDraft(action('expense.update', { description: 'Einkauf', amountCents: 100 })),
		null,
	);
});

test('create drafts still route to their owning page', () => {
	assert.equal(
		buildQueueEditDraft(action('shopping.create', { name: 'Milch' }))?.module,
		'shopping',
	);
	assert.equal(
		buildQueueEditDraft(action('expense.create', { description: 'x', amountCents: 100 }))?.module,
		'expense',
	);
	assert.equal(buildQueueEditHref('MTE8PZAT', 'shopping'), '/wg/MTE8PZAT/shopping');
});

test('a queued recurring booking keeps its template link and expected due date', () => {
	const draft = buildQueueEditDraft(
		action('expense.create', {
			description: 'Miete',
			amountCents: 50000,
			paidByMemberId: 'm1',
			recurringExpenseId: 'rec-1',
			expectedRecurringNextDueAt: '2026-10-01T00:00:00.000Z',
		}),
	);
	assert.equal(draft?.module, 'expense');
	assert.equal(draft?.draft.recurringSourceId, 'rec-1');
	assert.equal(draft?.draft.recurringNextDueAt, '2026-10-01T00:00:00.000Z');
});

test('a plain queued expense carries no template link', () => {
	const draft = buildQueueEditDraft(
		action('expense.create', { description: 'Einkauf', amountCents: 100 }),
	);
	assert.equal(draft?.draft.recurringSourceId, undefined);
	assert.equal(draft?.draft.recurringNextDueAt, undefined);
});

test('a queued expense formats its amount and splits in the reader locale', () => {
	const queued = action('expense.create', {
		description: 'Einkauf',
		amountCents: 1250,
		splits: [{ debtorMemberId: 'm1', amountCents: 1250 }],
	});
	const german = buildQueueEditDraft(queued);
	assert.equal(german?.draft.amountStr, '12,50');
	assert.deepEqual(german?.draft.manualSplits, { m1: '12,50' });
	const english = buildQueueEditDraft(queued, 'en');
	assert.equal(english?.draft.amountStr, '12.50');
	assert.deepEqual(english?.draft.manualSplits, { m1: '12.50' });
});

test('an expense draft that only kept an older date counts as empty', () => {
	const untouched = {
		description: '',
		category: 'other',
		amountStr: '',
		occurredOn: '2000-01-01',
		participantIds: null,
	};
	assert.equal(isEmptyModuleDraft('expense', untouched, 'me'), true);
	assert.equal(isEmptyModuleDraft('expense', { ...untouched, amountStr: '12' }, 'me'), false);
});
