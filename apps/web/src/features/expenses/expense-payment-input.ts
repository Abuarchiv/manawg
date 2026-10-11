/** A completed settlement payment between two members. */
export interface ExpensePaymentInput {
	fromMemberId: string;
	toMemberId: string;
	amountCents: number;
	currency: string;
	/** ISO instant the payment completed; month statements only count payments of their month. */
	completedAt?: string | null;
}
