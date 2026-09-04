const DESCRIPTION_MAX = 200;
const AMOUNT_MAX = 20;

export interface ExpensePrefillDraft {
	description: string;
	amountStr: string;
	imageUrl: null;
	paidByMemberId: string;
	splitMode: 'equal';
	manualSplits: Record<string, string>;
}

export function buildExpensePrefillDraft(input: {
	description: string | null;
	amount: string | null;
	paidByMemberId: string;
}): ExpensePrefillDraft | null {
	if (!input.description && !input.amount) return null;

	return {
		description: (input.description ?? '').slice(0, DESCRIPTION_MAX),
		amountStr: (input.amount ?? '').slice(0, AMOUNT_MAX),
		imageUrl: null,
		paidByMemberId: input.paidByMemberId,
		splitMode: 'equal',
		manualSplits: {},
	};
}
