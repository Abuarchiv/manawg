import { CENTS_PER_EURO } from '@/core/utils/money';
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Expense, RecurringExpense } from './expense-types';
import { useExpenseForm } from './useExpenseForm';

type FormOptions = Parameters<typeof useExpenseForm>[0];

const SHARE_CODE = 'test-wg';
const DRAFT_KEY = `manawg:draft:${SHARE_CODE}:expense`;

const ANNA = { id: 'member-anna' };
const BEN = { id: 'member-ben' };
const CARLA = { id: 'member-carla' };
/**
 * Module-level so the reference stays stable across re-renders — the payer
 * fallback effect depends on `members` and would loop on a fresh array.
 */
const MEMBERS = [ANNA, BEN, CARLA];
const NO_TEMPLATES: RecurringExpense[] = [];

/** 10,00 € across three members: 334/333/333 under Hamilton rounding. */
const TEN_EUROS_IN_CENTS = 10 * CENTS_PER_EURO;
const EQUAL_SHARES = [334, 333, 333];

const BASE_OPTIONS: FormOptions = {
	shareCode: SHARE_CODE,
	members: MEMBERS,
	identityMemberId: ANNA.id,
	prefillDescription: null,
	prefillAmount: null,
	recurringId: null,
	recurringExpenses: NO_TEMPLATES,
};

function renderForm(overrides: Partial<FormOptions> = {}) {
	return renderHook((options: FormOptions) => useExpenseForm(options), {
		initialProps: { ...BASE_OPTIONS, ...overrides },
	});
}

function buildExpense(overrides: Partial<Expense> = {}): Expense {
	return {
		id: 'expense-1',
		paidByMemberId: BEN.id,
		amountCents: TEN_EUROS_IN_CENTS,
		currency: 'EUR',
		description: 'Einkauf',
		imageUrl: null,
		occurredAt: '2026-07-01T10:00:00.000Z',
		createdAt: '2026-07-01T10:00:00.000Z',
		updatedAt: '2026-07-01T10:00:00.000Z',
		splits: [],
		...overrides,
	};
}

/** Builds the stored splits for an expense, in member order. */
function buildSplits(shares: readonly number[]) {
	return MEMBERS.map((member, idx) => ({
		id: `split-${member.id}`,
		debtorMemberId: member.id,
		amountCents: shares[idx] ?? 0,
		settledAt: null,
	}));
}

function storeDraft(draft: Record<string, unknown>): void {
	window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function readStoredDraft(): Record<string, unknown> {
	return JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? '{}');
}

describe('useExpenseForm', () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('draft persistence', () => {
		it('restores a stored draft and opens the form for it', () => {
			storeDraft({ description: 'Pfand', amountStr: '3,50', paidByMemberId: BEN.id });

			const { result } = renderForm();

			expect(result.current.description).toBe('Pfand');
			expect(result.current.amountStr).toBe('3,50');
			expect(result.current.paidByMemberId).toBe(BEN.id);
			expect(result.current.showForm).toBe(true);
		});

		/**
		 * A draft is rewritten on every keystroke, so one holding nothing but
		 * defaults is the normal state after the user closed an untouched form.
		 * Reopening the form for it would fight the user on every visit.
		 */
		it('leaves the form closed for a draft that holds no user input', () => {
			storeDraft({ description: '', amountStr: '', imageUrl: null, splitMode: 'equal' });

			const { result } = renderForm();

			expect(result.current.showForm).toBe(false);
		});

		it('writes form changes back to the draft', () => {
			const { result } = renderForm();

			act(() => result.current.setDescription('Klopapier'));

			expect(readStoredDraft().description).toBe('Klopapier');
		});

		/**
		 * The write-back effect must not run before the restore effect has filled
		 * the state, or the empty initial values get written over the stored draft.
		 * That window is what `draftHydrated` guards.
		 *
		 * Asserting on the final storage contents is not enough: the restore
		 * triggers a re-render that writes the correct draft again, so the damage
		 * is invisible by the end of the mount. Only the sequence of writes shows
		 * it — hence the spy. A user closing the tab inside that window, or a
		 * second tab reading the key, would see the empty draft.
		 */
		it('never writes an empty draft over the stored one while hydrating', () => {
			storeDraft({ description: 'Pfand', amountStr: '3,50' });
			const setItem = vi.spyOn(Storage.prototype, 'setItem');

			renderForm();

			const writtenDescriptions = setItem.mock.calls
				.filter(([key]) => key === DRAFT_KEY)
				.map(([, value]) => JSON.parse(value).description);
			expect(writtenDescriptions).not.toContain('');
			expect(readStoredDraft().description).toBe('Pfand');
			expect(readStoredDraft().amountStr).toBe('3,50');
		});

		it('ignores the stored draft when the URL carries a prefill', () => {
			storeDraft({ description: 'Pfand', amountStr: '3,50' });

			const { result } = renderForm({ prefillDescription: 'Pizza', prefillAmount: '12,00' });

			expect(result.current.description).toBe('Pizza');
			expect(result.current.amountStr).toBe('12,00');
		});

		/**
		 * A draft can name someone who has since left the WG, or was written under
		 * a different identity on a shared device. An unknown id would leave the
		 * payer select with no matching option.
		 */
		it('falls back to the current member when the draft names an unknown payer', () => {
			storeDraft({ description: 'Pfand', paidByMemberId: 'member-who-left' });

			const { result } = renderForm();

			expect(result.current.paidByMemberId).toBe(ANNA.id);
		});
	});

	describe('startEdit split-mode detection', () => {
		it('treats an expense without stored splits as an equal split', () => {
			const { result } = renderForm();

			act(() => result.current.startEdit(buildExpense({ splits: [] })));

			expect(result.current.splitMode).toBe('equal');
			expect(result.current.manualSplits).toEqual({});
		});

		/**
		 * Reopening an equally split expense must not silently turn it into a
		 * manual one, or saving would freeze today's rounding into fixed shares.
		 */
		it('recognizes Hamilton-rounded shares as an equal split', () => {
			const { result } = renderForm();
			const expense = buildExpense({ splits: buildSplits(EQUAL_SHARES) });

			act(() => result.current.startEdit(expense));

			expect(result.current.splitMode).toBe('equal');
			expect(result.current.manualSplits).toEqual({});
		});

		/**
		 * The old heuristic accepted any share of `base` or `base + 1`, so this
		 * shape — leftover cent on the wrong member, and the shares do not even
		 * sum to the total — passed as equal and lost the real amounts on save.
		 */
		it('does not mistake wrongly rounded shares for an equal split', () => {
			const { result } = renderForm();
			const expense = buildExpense({ splits: buildSplits([333, 334, 333]) });

			act(() => result.current.startEdit(expense));

			expect(result.current.splitMode).toBe('manual');
		});

		/**
		 * An expense that leaves someone out is by definition not an equal split.
		 * The shares are deliberately the base amount of 1000/3: under the old
		 * "every share is base or base + 1" heuristic they looked equal, so the
		 * third member got silently added back on save.
		 */
		it('treats an expense that skips a member as a manual split', () => {
			const { result } = renderForm();
			const splits = buildSplits([333, 333]).slice(0, 2);

			act(() => result.current.startEdit(buildExpense({ splits })));

			expect(result.current.splitMode).toBe('manual');
			expect(result.current.manualSplits).toEqual({ [ANNA.id]: '3,33', [BEN.id]: '3,33' });
		});

		it('carries the edited expense over into the open form', () => {
			const { result } = renderForm();
			const expense = buildExpense({ description: 'Netflix', paidByMemberId: CARLA.id });

			act(() => result.current.startEdit(expense));

			expect(result.current.editingExpense).toBe(expense);
			expect(result.current.description).toBe('Netflix');
			expect(result.current.amountStr).toBe('10,00');
			expect(result.current.paidByMemberId).toBe(CARLA.id);
			expect(result.current.showForm).toBe(true);
		});
	});

	describe('startRecurringEdit', () => {
		const template: RecurringExpense = {
			id: 'recurring-rent',
			description: 'Miete',
			amountCents: 900 * CENTS_PER_EURO,
			paidByMemberId: BEN.id,
			intervalMonths: 3,
			nextDueAt: '2026-08-01T00:00:00.000Z',
			lastCreatedAt: null,
			splits: MEMBERS.map((member) => ({
				debtorMemberId: member.id,
				amountCents: 300 * CENTS_PER_EURO,
			})),
		};

		/**
		 * A template stores explicit per-member shares. Even when they happen to be
		 * equal — as here — editing must stay manual, otherwise saving would
		 * recompute the shares and silently drop the stored ones.
		 */
		it('edits a template in manual mode even when its shares are equal', () => {
			const { result } = renderForm();

			act(() => result.current.startRecurringEdit(template));

			expect(result.current.splitMode).toBe('manual');
			expect(result.current.manualSplits).toEqual({
				[ANNA.id]: '300,00',
				[BEN.id]: '300,00',
				[CARLA.id]: '300,00',
			});
			expect(result.current.recurringIntervalMonths).toBe(template.intervalMonths);
			expect(result.current.editingRecurringExpense).toBe(template);
			expect(result.current.editingExpense).toBeNull();
			expect(result.current.showForm).toBe(true);
		});
	});

	describe('recurring URL prefill', () => {
		const template: RecurringExpense = {
			id: 'recurring-power',
			description: 'Strom',
			amountCents: 60 * CENTS_PER_EURO,
			paidByMemberId: CARLA.id,
			intervalMonths: 1,
			nextDueAt: '2026-08-01T00:00:00.000Z',
			lastCreatedAt: null,
			splits: MEMBERS.map((member) => ({
				debtorMemberId: member.id,
				amountCents: 20 * CENTS_PER_EURO,
			})),
		};

		/**
		 * `?recurring=<id>` books a NEW expense from a due template, so the form
		 * must not enter template-edit mode — saving it would rewrite the template
		 * instead of creating the expense.
		 */
		it('prefills from the template without entering template-edit mode', () => {
			const { result } = renderForm({
				recurringId: template.id,
				recurringExpenses: [template],
			});

			expect(result.current.description).toBe('Strom');
			expect(result.current.amountStr).toBe('60,00');
			expect(result.current.paidByMemberId).toBe(CARLA.id);
			expect(result.current.splitMode).toBe('manual');
			expect(result.current.editingRecurringExpense).toBeNull();
			expect(result.current.showForm).toBe(true);
		});

		/**
		 * The template list is fetched, so the id from the URL is usually there
		 * before the template it names. The effect has to retry rather than give up
		 * on the first miss.
		 */
		it('applies the prefill once the template finishes loading', () => {
			const { result, rerender } = renderForm({
				recurringId: template.id,
				recurringExpenses: NO_TEMPLATES,
			});

			expect(result.current.description).toBe('');

			rerender({ ...BASE_OPTIONS, recurringId: template.id, recurringExpenses: [template] });

			expect(result.current.description).toBe('Strom');
		});

		/**
		 * Applying it more than once would stomp over whatever the user has typed
		 * since — and the template list re-renders on every poll.
		 */
		it('does not reapply the prefill after the user edits the form', () => {
			const templates = [template];
			const { result, rerender } = renderForm({
				recurringId: template.id,
				recurringExpenses: templates,
			});

			act(() => result.current.setDescription('Strom Januar'));
			rerender({ ...BASE_OPTIONS, recurringId: template.id, recurringExpenses: [...templates] });

			expect(result.current.description).toBe('Strom Januar');
		});
	});

	describe('resetForm', () => {
		it('clears the fields and returns the payer to the current member', () => {
			const { result } = renderForm();
			act(() =>
				result.current.startEdit(
					buildExpense({ paidByMemberId: CARLA.id, splits: buildSplits([500, 500, 0]) }),
				),
			);

			act(() => result.current.resetForm());

			expect(result.current.description).toBe('');
			expect(result.current.amountStr).toBe('');
			expect(result.current.imageUrl).toBeNull();
			expect(result.current.paidByMemberId).toBe(ANNA.id);
			expect(result.current.splitMode).toBe('equal');
			expect(result.current.manualSplits).toEqual({});
			expect(result.current.editingExpense).toBeNull();
			expect(result.current.formError).toBeNull();
		});

		/**
		 * Closing the form is the page's call — some flows keep it open for the
		 * next expense, others close it after saving.
		 */
		it('leaves the form open', () => {
			const { result } = renderForm();
			act(() => result.current.setShowForm(true));

			act(() => result.current.resetForm());

			expect(result.current.showForm).toBe(true);
		});
	});
});
