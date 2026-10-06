/**
 * Failure reporting for the migrator. Callers such as preview-db-check.mjs parse the
 * `[stage=...] [reason=...] [code=...]` tokens, so reasons are fixed slugs that never echo input.
 */

/** Maps an error to a fixed, non-secret reason slug. */
export function safeFailureReason(error) {
	const text = [error?.message, error?.cause?.message].filter(Boolean).join('\n');
	if (/advisory lock is held by another session/i.test(text)) return 'migration-lock-busy';
	if (/unexpected migration row/i.test(text)) return 'unexpected-migration-row';
	if (/migration ledger is not a canonical prefix/i.test(text)) return 'non-canonical-ledger';
	if (/timestamp mismatch/i.test(text)) return 'migration-timestamp';
	if (/invalid migration (?:hash|timestamp)/i.test(text)) return 'invalid-ledger-value';
	if (/duplicate migration/i.test(text)) return 'duplicate-migration';
	if (/migration ledger is missing/i.test(text)) return 'missing-ledger';
	if (/syntax error/i.test(text)) return 'sql-syntax';
	if (/relation .* does not exist/i.test(text)) return 'missing-relation';
	if (/column .* does not exist/i.test(text)) return 'missing-column';
	if (/already exists|duplicate key/i.test(text)) return 'duplicate-object';
	const permission = text.match(/permission denied for (schema|table|sequence|function)/i);
	if (permission) return `permission-${permission[1].toLowerCase()}`;
	const owner = text.match(/must be owner of (schema|table|sequence|function|relation)/i);
	if (owner) return `owner-${owner[1].toLowerCase()}`;
	if (/permission denied|insufficient privilege/i.test(text)) return 'permission';
	return 'unclassified';
}

/** ` [code=XXXXX]` for a PostgreSQL SQLSTATE-like code on the error or its cause, else ''. */
export function errorCodeSuffix(err) {
	const rawErrorCode =
		err && typeof err === 'object'
			? (err.code ?? (err.cause && typeof err.cause === 'object' ? err.cause.code : undefined))
			: undefined;
	return typeof rawErrorCode === 'string' && /^[A-Z0-9_]{5,}$/.test(rawErrorCode)
		? ` [code=${rawErrorCode}]`
		: '';
}
