import assert from 'node:assert/strict';
import test from 'node:test';

const { renderMessage, serverRootT } = await import('@/core/i18n/server-t');
const { INVALID_RESPONSE_CODE, NETWORK_ERROR_CODE, mutationError, mutationErrorMessage } =
	await import('./error-codes');

const SUBJECT = { key: 'common.loadError.lead.expenses' } as const;
const SUBJECT_TEXT = 'Ausgaben konnten nicht geladen werden';
const FALLBACK = { key: 'common.errors.signInAgain' } as const;
const FALLBACK_TEXT = 'Melde dich neu an.';
const SPECIFIC_CODE = 'import_settled';

const CODES = [
	NETWORK_ERROR_CODE,
	'Failed to fetch',
	'too_many_requests',
	'x_rate_limited',
	'migration_read_only',
	'auth_required',
	'unexpected_error',
	'db_error',
	'wg_not_found',
	'invalid_share_code',
	'not_a_member',
	SPECIFIC_CODE,
	'something_else',
	INVALID_RESPONSE_CODE,
];

test('mutationError renders the German of mutationErrorMessage for every bucket', () => {
	const t = serverRootT('de');
	for (const code of CODES) {
		const expected = mutationErrorMessage(
			SUBJECT_TEXT,
			code,
			{ [SPECIFIC_CODE]: 'Der Suchbegriff ist zu lang.' },
			FALLBACK_TEXT,
		);
		const message = mutationError(
			SUBJECT,
			code,
			{ [SPECIFIC_CODE]: { key: 'common.errors.queryTooLong' } },
			FALLBACK,
		);
		assert.equal(renderMessage(t, message), expected, code);
	}
});

test('mutationError uses the retry subject only for the retryable bucket', () => {
	const message = mutationError(SUBJECT, 'db_error', {}, FALLBACK, { key: 'common.loading' });
	assert.equal(renderMessage(serverRootT('de'), message), 'Lädt…: Versuche es gleich erneut.');
	assert.equal(
		renderMessage(
			serverRootT('de'),
			mutationError(SUBJECT, 'too_many_requests', {}, FALLBACK, {
				key: 'common.loading',
			}),
		),
		`${SUBJECT_TEXT}: Zu viele Anfragen. Warte kurz und versuche es dann erneut.`,
	);
});

test('mutationError renders English buckets', () => {
	const t = serverRootT('en');
	assert.equal(
		renderMessage(t, mutationError(SUBJECT, NETWORK_ERROR_CODE, {}, FALLBACK)),
		'Expenses could not be loaded: Check your connection and try again.',
	);
	assert.equal(renderMessage(t, mutationError(SUBJECT, 'zzz', {}, FALLBACK)), 'Sign in again.');
});
