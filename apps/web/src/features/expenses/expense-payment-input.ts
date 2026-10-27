/** A completed settlement payment between two members. */
export interface ExpensePaymentInput {
	/** Present when the payment comes from `GET /expenses`; the balance math ignores it. */
	id?: string;
	fromMemberId: string;
	toMemberId: string;
	amountCents: number;
	currency: string;
	/** ISO instant the payment completed; month statements only count payments of their month. */
	completedAt?: string | null;
}
