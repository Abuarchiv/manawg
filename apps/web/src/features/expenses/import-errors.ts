import {
	type ApiErrorKind,
	NETWORK_ERROR_CODE,
	classifyApiError,
	isRateLimited,
	isRetryableServerError,
} from '@/core/http/error-codes';
import type { Message } from '@/shared/i18n/message';

/**
 * Copy and the next step to offer for each error the import routes
 * (`imports/preview`, `imports/commit`) can return. Kept apart from the wizard
 * so the mapping stays reviewable and testable without rendering it.
 */

export type ImportOperation = 'preview' | 'commit';
export type RecoveryAction =
	| { kind: 'retry_preview'; label: Message }
	| { kind: 'retry_commit'; label: Message }
	| { kind: 'input'; label: Message }
	| { kind: 'mapping'; label: Message }
	| { kind: 'preview'; label: Message };

const RETRY_LATER: Message = { key: 'expenses-import.errors.retryLater' };

/** Copy for the shared error buckets, in the wording of the import. */
const BUCKET_MESSAGES: Readonly<Record<ApiErrorKind, Message>> = {
	network: { key: 'common.errors.network' },
	readOnly: { key: 'common.errors.readOnly' },
	sessionExpired: { key: 'expenses-import.errors.sessionExpired' },
	wgUnavailable: { key: 'expenses-import.errors.wgUnavailable' },
	invalidShareCode: { key: 'expenses-import.errors.invalidShareCode' },
	authInvalidated: { key: 'expenses-import.errors.authInvalidated' },
	retryable: RETRY_LATER,
};

const INVALID_BODY: Message = { key: 'expenses-import.errors.invalidBody' };

/** Codes only the import routes return. */
const IMPORT_ERROR_MESSAGES: Readonly<Record<string, Message>> = {
	member_deactivated: { key: 'expenses-import.errors.memberDeactivated' },
	member_not_in_wg: { key: 'expenses-import.errors.memberNotInWg' },
	mapping_incomplete: { key: 'expenses-import.errors.mappingIncomplete' },
	payload_changed: { key: 'expenses-import.errors.payloadChanged' },
	payload_too_large: { key: 'expenses-import.errors.payloadTooLarge' },
	too_many_rows: { key: 'expenses-import.errors.tooManyRows' },
	unsupported_currency: { key: 'expenses-import.errors.unsupportedCurrency' },
	empty_payload: { key: 'expenses-import.errors.emptyPayload' },
	rows_unreadable: { key: 'expenses-import.errors.rowsUnreadable' },
	invalid_skip_indexes: { key: 'expenses-import.errors.invalidSkipIndexes' },
	preview_hash_required: { key: 'expenses-import.errors.previewHashRequired' },
	invalid_body: INVALID_BODY,
	invalid_json: INVALID_BODY,
	payer_unmapped: { key: 'expenses-import.errors.payerUnmapped' },
	no_valid_splits: { key: 'expenses-import.errors.noValidSplits' },
	split_sum_mismatch: { key: 'expenses-import.errors.splitSumMismatch' },
	paid_by_must_include_caller: { key: 'expenses-import.errors.paidByMustIncludeCaller' },
	insert_failed: { key: 'expenses-import.errors.insertFailed' },
	import_insert_failed: { key: 'expenses-import.errors.importInsertFailed' },
};

export function importActionErrorMessage(error: string): Message {
	// The middleware answers 429 with `rate_limited`, the routes with `too_many_requests`.
	if (isRateLimited(error)) return { key: 'expenses-import.errors.rateLimited' };
	const kind = classifyApiError(error);
	if (kind) return BUCKET_MESSAGES[kind];
	return IMPORT_ERROR_MESSAGES[error] ?? { key: 'expenses-import.errors.fallback' };
}

export function recoveryActionFor(
	error: string,
	operation: ImportOperation,
): RecoveryAction | null {
	if (
		error === 'mapping_incomplete' ||
		error === 'member_not_in_wg' ||
		error === 'payer_unmapped'
	) {
		return { kind: 'mapping', label: { key: 'expenses-import.recovery.mapping' } };
	}
	if (error === 'invalid_skip_indexes' || error === 'preview_hash_required') {
		return { kind: 'preview', label: { key: 'expenses-import.recovery.preview' } };
	}
	if (
		error === 'payload_changed' ||
		error === 'payload_too_large' ||
		error === 'too_many_rows' ||
		error === 'unsupported_currency' ||
		error === 'empty_payload' ||
		error === 'rows_unreadable' ||
		error === 'invalid_body' ||
		error === 'invalid_json' ||
		error === 'no_valid_splits' ||
		error === 'split_sum_mismatch' ||
		error === 'paid_by_must_include_caller'
	) {
		return { kind: 'input', label: { key: 'expenses-import.recovery.input' } };
	}
	if (
		error === NETWORK_ERROR_CODE ||
		error === 'Failed to fetch' ||
		error === 'migration_read_only' ||
		isRetryableServerError(error)
	) {
		return {
			kind: operation === 'preview' ? 'retry_preview' : 'retry_commit',
			label: { key: 'expenses-import.recovery.retry' },
		};
	}
	return null;
}
