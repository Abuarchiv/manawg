/** A completed settlement payment between two members. */
export interface ExpensePaymentInput {
	fromMemberId: string;
	toMemberId: string;
	amountCents: number;
	currency: string;
}
