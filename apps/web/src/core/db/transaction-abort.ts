/**
 * Aborts a transaction with an API error code the route can answer with.
 *
 * Rolling back means throwing, so a deliberate abort and a broken connection
 * arrive at the caller through the same channel. Without this marker a route
 * would have to guess which one it caught, and guessing wrong means reporting
 * "everything fine" after a failed write.
 *
 * Deliberately kept in its own module, free of driver imports: `transaction.ts`
 * pulls in both postgres drivers, and anything that only needs to recognise an
 * abort — a route test, an error mapper — should not have to load them. The
 * same split already exists for `member-header.ts` versus `api-auth.ts`, and a
 * test enforces it there for exactly this reason.
 */
export class TransactionAbort extends Error {
	readonly code: string;

	constructor(code: string) {
		super(code);
		this.name = 'TransactionAbort';
		this.code = code;
	}
}
