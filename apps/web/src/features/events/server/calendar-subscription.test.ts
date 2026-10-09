import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createCalendarFeedSeed,
	deriveCalendarFeedToken,
	verifyCalendarFeedToken,
} from './calendar-subscription';

const ID = '11111111-1111-4111-8111-111111111111';

function withEnv(current: string | undefined, previous: string | undefined, run: () => void) {
	const before = [process.env.MEMBER_SESSION_SECRET, process.env.MEMBER_SESSION_SECRET_PREVIOUS];
	const set = (name: string, value: string | undefined) => {
		if (value === undefined) Reflect.deleteProperty(process.env, name);
		else process.env[name] = value;
	};
	set('MEMBER_SESSION_SECRET', current);
	set('MEMBER_SESSION_SECRET_PREVIOUS', previous);
	try {
		run();
	} finally {
		set('MEMBER_SESSION_SECRET', before[0]);
		set('MEMBER_SESSION_SECRET_PREVIOUS', before[1]);
	}
}

test('feed tokens survive a secret rotation while the old secret is listed', () => {
	const seed = createCalendarFeedSeed();
	let token = '';
	withEnv('old-secret', undefined, () => {
		token = deriveCalendarFeedToken(ID, seed) ?? '';
		assert.equal(verifyCalendarFeedToken(ID, seed, token), true);
	});
	withEnv('new-secret', 'old-secret', () => {
		assert.equal(verifyCalendarFeedToken(ID, seed, token), true);
		assert.notEqual(deriveCalendarFeedToken(ID, seed), token);
	});
	withEnv('new-secret', undefined, () => {
		assert.equal(verifyCalendarFeedToken(ID, seed, token), false);
	});
});
