import { describe, expect, it } from 'vitest';
import {
	isAuthInvalidated,
	isInvalidShareCode,
	isNetworkError,
	isRetryableServerError,
	isWgUnavailable,
} from './generic-error-codes';

describe('isNetworkError', () => {
	it('matches network signals', () => {
		expect(isNetworkError('Netzwerkfehler')).toBe(true);
		expect(isNetworkError('Failed to fetch')).toBe(true);
		expect(isNetworkError(null, 0)).toBe(true);
	});

	it('does not match unrelated codes or statuses', () => {
		expect(isNetworkError('server_error')).toBe(false);
		expect(isNetworkError(null, 500)).toBe(false);
		expect(isNetworkError(null)).toBe(false);
	});
});

describe('isRetryableServerError', () => {
	it('matches known retryable codes and 5xx status', () => {
		expect(isRetryableServerError('unexpected_error')).toBe(true);
		expect(isRetryableServerError('server_error')).toBe(true);
		expect(isRetryableServerError('db_error')).toBe(true);
		expect(isRetryableServerError(null, 500)).toBe(true);
		expect(isRetryableServerError(null, 503)).toBe(true);
	});

	it('does not match unrelated codes or sub-500 status', () => {
		expect(isRetryableServerError('wg_not_found')).toBe(false);
		expect(isRetryableServerError(null, 404)).toBe(false);
		expect(isRetryableServerError(null)).toBe(false);
	});
});

describe('isWgUnavailable', () => {
	it('matches wg_not_found and 404', () => {
		expect(isWgUnavailable('wg_not_found')).toBe(true);
		expect(isWgUnavailable(null, 404)).toBe(true);
	});

	it('does not match unrelated codes or statuses', () => {
		expect(isWgUnavailable('server_error')).toBe(false);
		expect(isWgUnavailable(null, 500)).toBe(false);
		expect(isWgUnavailable(null)).toBe(false);
	});
});

describe('isInvalidShareCode', () => {
	it('matches only invalid_share_code', () => {
		expect(isInvalidShareCode('invalid_share_code')).toBe(true);
		expect(isInvalidShareCode('wg_not_found')).toBe(false);
		expect(isInvalidShareCode(null)).toBe(false);
	});
});

describe('isAuthInvalidated', () => {
	it('matches auth-invalidated codes and 401', () => {
		expect(isAuthInvalidated('not_a_member')).toBe(true);
		expect(isAuthInvalidated('member_id_required')).toBe(true);
		expect(isAuthInvalidated('member_id_invalid')).toBe(true);
		expect(isAuthInvalidated(null, 401)).toBe(true);
	});

	it('does not match unrelated codes or statuses', () => {
		expect(isAuthInvalidated('wg_not_found')).toBe(false);
		expect(isAuthInvalidated(null, 403)).toBe(false);
		expect(isAuthInvalidated(null)).toBe(false);
	});
});
