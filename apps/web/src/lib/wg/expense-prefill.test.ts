import { describe, expect, it } from 'vitest';
import { buildExpensePrefillDraft } from './expense-prefill';

describe('buildExpensePrefillDraft', () => {
	it('keeps amount-only expense deeplinks useful', () => {
		expect(
			buildExpensePrefillDraft({
				description: null,
				amount: '12,50',
				paidByMemberId: 'member-1',
			}),
		).toEqual({
			description: '',
			amountStr: '12,50',
			imageUrl: null,
			paidByMemberId: 'member-1',
			splitMode: 'equal',
			manualSplits: {},
		});
	});

	it('returns null when no expense prefill parameter is present', () => {
		expect(
			buildExpensePrefillDraft({
				description: null,
				amount: null,
				paidByMemberId: 'member-1',
			}),
		).toBeNull();
	});
});
