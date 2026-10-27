import assert from 'node:assert/strict';
import test from 'node:test';

const { renderMessage, serverRootT } = await import('@/core/i18n/server-t');
const { getWgLoadErrorMessage, wgLoadError } = await import('./load-errors');

const LEAD = { key: 'common.loadError.lead.expenses' } as const;

const CASES: [number, string | null][] = [
	[0, null],
	[0, 'Netzwerkfehler'],
	[404, null],
	[404, 'wg_not_found'],
	[400, 'invalid_share_code'],
	[503, 'migration_read_only'],
	[401, 'auth_required'],
	[401, 'not_a_member'],
	[500, 'db_error'],
	[429, 'too_many_requests'],
	[400, 'query_invalid'],
	[400, 'other'],
	[200, null],
];

test('wgLoadError renders the German of getWgLoadErrorMessage', () => {
	const t = serverRootT('de');
	for (const [status, error] of CASES) {
		assert.equal(
			renderMessage(t, wgLoadError(LEAD, status, error)),
			getWgLoadErrorMessage('Ausgaben', status, error, { verb: 'konnten' }),
			`${status} ${error}`,
		);
	}
});

test('wgLoadError renders English', () => {
	const t = serverRootT('en');
	assert.equal(
		renderMessage(t, wgLoadError(LEAD, 0, null)),
		'Expenses could not be loaded: Check your connection and try again.',
	);
	assert.equal(renderMessage(t, wgLoadError(LEAD, 400, 'other')), 'Expenses could not be loaded.');
});
