import assert from 'node:assert/strict';
import test from 'node:test';

const { renderMessage, serverRootT } = await import('@/core/i18n/server-t');
const { INVALID_RESPONSE_CODE, NETWORK_ERROR_CODE, mutationError } = await import('./error-codes');

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

test('mutationError renders every bucket in German', () => {
	const t = serverRootT('de');
	const render = (code: string) =>
		renderMessage(
			t,
			mutationError(
				SUBJECT,
				code,
				{ [SPECIFIC_CODE]: { key: 'common.errors.queryTooLong' } },
				FALLBACK,
			),
		);
	assert.equal(
		render(NETWORK_ERROR_CODE),
		`${SUBJECT_TEXT}: Prüfe deine Verbindung und versuche es erneut.`,
	);
	assert.equal(
		render('migration_read_only'),
		`${SUBJECT_TEXT}: Die App ist gerade in Wartung und nur lesbar. Versuche es später erneut.`,
	);
	assert.equal(
		render('auth_required'),
		`${SUBJECT_TEXT}: Deine Sitzung ist abgelaufen. Melde dich neu an.`,
	);
	assert.equal(
		render('wg_not_found'),
		`${SUBJECT_TEXT}: Öffne die WG über den aktuellen Link erneut.`,
	);
	assert.equal(render('invalid_share_code'), `${SUBJECT_TEXT}: Der WG-Code ist ungültig.`);
	assert.equal(render('not_a_member'), `${SUBJECT_TEXT}: Tritt der WG erneut bei.`);
	assert.equal(render(SPECIFIC_CODE), 'Der Suchbegriff ist zu lang.');
	for (const code of CODES) assert.ok(render(code).length > 0, code);
	assert.equal(render('something_else'), FALLBACK_TEXT);
	assert.equal(render(INVALID_RESPONSE_CODE), FALLBACK_TEXT);
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
