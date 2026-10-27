import assert from 'node:assert/strict';
import test from 'node:test';
import { withEnv } from '../../../../tests/support/env';
import {
	createCalendarFeedSeed,
	deriveCalendarFeedToken,
	verifyCalendarFeedToken,
} from './calendar-subscription';

const ID = '11111111-1111-4111-8111-111111111111';

function withSecrets(current: string | undefined, previous: string | undefined, run: () => void) {
	withEnv({ MEMBER_SESSION_SECRET: current, MEMBER_SESSION_SECRET_PREVIOUS: previous }, run);
}

test('feed tokens survive a secret rotation while the old secret is listed', () => {
	const seed = createCalendarFeedSeed();
	let token = '';
	withSecrets('old-secret', undefined, () => {
		token = deriveCalendarFeedToken(ID, seed) ?? '';
		assert.equal(verifyCalendarFeedToken(ID, seed, token), true);
	});
	withSecrets('new-secret', 'old-secret', () => {
		assert.equal(verifyCalendarFeedToken(ID, seed, token), true);
		assert.notEqual(deriveCalendarFeedToken(ID, seed), token);
	});
	withSecrets('new-secret', undefined, () => {
		assert.equal(verifyCalendarFeedToken(ID, seed, token), false);
	});
});
