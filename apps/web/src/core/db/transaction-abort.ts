/**
 * Aborts a transaction with an API error code the route can answer with.
 *
 * Rolling back means throwing, so a deliberate abort and a broken connection
 * arrive at the caller through the same channel. Without this marker a route
 * would have to guess which one it caught, and guessing wrong means reporting
 * "everything fine" after a failed write.
 *
 * Lives in its own module so callers that only need to recognise an abort do
 * not load the postgres drivers `transaction.ts` imports.
 */
export class TransactionAbort extends Error {
	readonly code: string;

	constructor(code: string) {
		super(code);
		this.name = 'TransactionAbort';
		this.code = code;
	}
}
