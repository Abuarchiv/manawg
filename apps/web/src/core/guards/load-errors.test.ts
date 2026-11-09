import assert from 'node:assert/strict';
import test from 'node:test';

const { wgLoadError } = await import('./load-errors');

const LEAD = { key: 'common.loadError.lead.expenses' } as const;

const CASES: [number, string | null, string | null][] = [
	[0, null, 'common.errors.network'],
	[0, 'Netzwerkfehler', 'common.errors.network'],
	[404, null, 'common.errors.wgUnavailable'],
	[404, 'wg_not_found', 'common.errors.wgUnavailable'],
	[400, 'invalid_share_code', 'common.errors.invalidShareCode'],
	[503, 'migration_read_only', 'common.errors.maintenance'],
	[401, 'auth_required', 'common.errors.signInAgain'],
	[401, 'not_a_member', 'common.errors.authInvalidated'],
	[500, 'db_error', 'common.errors.retry'],
	[429, 'too_many_requests', 'common.errors.retry'],
	[400, 'query_invalid', 'common.errors.queryTooLong'],
	[400, 'other', null],
	[200, null, null],
];

test('wgLoadError maps each status and code to its detail', () => {
	for (const [status, error, detail] of CASES) {
		assert.deepEqual(
			wgLoadError(LEAD, status, error),
			detail
				? { key: 'common.errors.withSubject', values: { subject: LEAD, detail: { key: detail } } }
				: { key: 'common.loadError.withoutDetail', values: { lead: LEAD } },
			`${status} ${error}`,
		);
	}
});
