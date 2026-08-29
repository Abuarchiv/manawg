import { describe, expect, it } from 'vitest';

import {
	accessErrorMessage,
	deleteWgErrorMessage,
	exportErrorMessage,
	notificationSaveErrorMessage,
	notificationTestErrorMessage,
} from './settings-errors';

/**
 * This module had no tests at all, which is how two silent divergences
 * survived in it: `exportErrorMessage` was missing `db_error` from its
 * retryable branch while its four siblings had it, and two functions had no
 * network branch at all. Both are fixed; these tests exist so the next
 * copy-edit cannot reintroduce that kind of gap unnoticed.
 *
 * The assertion is deliberately NOT about wording — each function phrases its
 * message for its own screen, and pinning the German copy here would just
 * duplicate it. What must hold is the CLASSIFICATION: every one of these
 * conditions has to produce something other than the catch-all fallback, in
 * every function. That is exactly what drifted before.
 */

const FUNCTIONS = [
	['accessErrorMessage', accessErrorMessage],
	['deleteWgErrorMessage', deleteWgErrorMessage],
	['notificationSaveErrorMessage', notificationSaveErrorMessage],
	['notificationTestErrorMessage', notificationTestErrorMessage],
	['exportErrorMessage', exportErrorMessage],
] as const;

const CLASSIFIED_CONDITIONS: ReadonlyArray<[string, number, string | null]> = [
	['dropped connection', 0, null],
	['unexpected_error', 500, 'unexpected_error'],
	['server_error', 500, 'server_error'],
	['db_error', 500, 'db_error'],
	['bare 5xx', 503, null],
	['not_a_member', 403, 'not_a_member'],
	['member_id_required', 403, 'member_id_required'],
	['member_id_invalid', 403, 'member_id_invalid'],
	['wg_not_found', 404, 'wg_not_found'],
	['invalid_share_code', 400, 'invalid_share_code'],
];

describe('settings error messages', () => {
	for (const [name, fn] of FUNCTIONS) {
		describe(name, () => {
			const fallback = fn(400, 'a_code_no_handler_knows');

			it.each(CLASSIFIED_CONDITIONS)(
				'classifies %s instead of falling through',
				(_label, status, code) => {
					expect(fn(status, code)).not.toBe(fallback);
				},
			);

			it('falls back without leaking the raw error code', () => {
				expect(fallback.length).toBeGreaterThan(0);
				expect(fallback).not.toContain('a_code_no_handler_knows');
			});
		});
	}

	// Destructive action: a plain "failed" asserts the WG still exists, which a
	// dropped connection cannot establish either way.
	it('does not claim the WG survived when a delete request never completed', () => {
		expect(deleteWgErrorMessage(0, null)).toMatch(/unklar/);
	});

	it('keeps the domain-specific share-code failure on the retryable path', () => {
		expect(accessErrorMessage(500, 'share_code_generation_failed')).toBe(
			accessErrorMessage(500, 'server_error'),
		);
	});
});
