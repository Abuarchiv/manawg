import assert from 'node:assert/strict';
import test from 'node:test';
import {
	initWgSessionState,
	type WgSessionState,
	wgSessionReducer,
} from '@/components/wg/wg-session-state';

const member = { memberId: 'm-1', name: 'Alex', authUserId: 'u-1' };

function ready(overrides: Partial<WgSessionState> = {}): WgSessionState {
	return { ...initWgSessionState(member, true), ...overrides };
}

test('a server-verified identity starts ready with the server admin flag', () => {
	assert.deepEqual(initWgSessionState(member, true), {
		identity: member,
		isAdmin: true,
		accountReady: true,
		memberLoaded: true,
		memberLoadError: false,
		sessionEnded: false,
	});
	assert.equal(initWgSessionState(member, undefined).isAdmin, false);
});

test('an identity without authUserId waits for the lookup and ignores the admin flag', () => {
	assert.deepEqual(initWgSessionState({ memberId: 'm-1', name: 'Alex' }, true), {
		identity: { memberId: 'm-1', name: 'Alex' },
		isAdmin: false,
		accountReady: false,
		memberLoaded: false,
		memberLoadError: false,
		sessionEnded: false,
	});
	assert.equal(initWgSessionState(undefined, undefined).identity, null);
});

test('loading clears the error and only drops memberLoaded without keepCurrentContext', () => {
	const failed = ready({ memberLoadError: true });
	assert.deepEqual(wgSessionReducer(failed, { type: 'loading' }), {
		...failed,
		memberLoadError: false,
		memberLoaded: false,
	});
	assert.deepEqual(wgSessionReducer(failed, { type: 'loading', keepCurrentContext: true }), {
		...failed,
		memberLoadError: false,
	});
});

test('member-loaded keeps the identity object when nothing changed', () => {
	const state = ready({ sessionEnded: true });
	const next = wgSessionReducer(state, { type: 'member-loaded', identity: { ...member } });
	assert.equal(next.identity, state.identity);
	assert.equal(next.sessionEnded, false);
	assert.equal(next.accountReady, true);
	assert.equal(next.memberLoaded, true);
});

test('member-loaded replaces the identity when memberId, name or authUserId differ', () => {
	const state = ready();
	for (const changed of [
		{ ...member, memberId: 'm-2' },
		{ ...member, name: 'Sam' },
		{ ...member, authUserId: 'u-2' },
	]) {
		assert.equal(
			wgSessionReducer(state, { type: 'member-loaded', identity: changed }).identity,
			changed,
		);
	}
	const fresh = initWgSessionState(undefined, undefined);
	const loaded = wgSessionReducer(fresh, { type: 'member-loaded', identity: member });
	assert.equal(loaded.identity, member);
	assert.equal(loaded.isAdmin, false);
});

test('member-loaded returns the same state when nothing changes', () => {
	const state = ready();
	assert.equal(wgSessionReducer(state, { type: 'member-loaded', identity: { ...member } }), state);
});

test('kept-after-transient-failure keeps an existing identity and marks the account ready', () => {
	const other = { memberId: 'm-9', name: 'Other', authUserId: 'u-1' };
	const state = ready();
	assert.equal(
		wgSessionReducer(state, { type: 'kept-after-transient-failure', identity: other }).identity,
		state.identity,
	);
	const empty = ready({ identity: null, accountReady: false, memberLoaded: false });
	assert.deepEqual(
		wgSessionReducer(empty, { type: 'kept-after-transient-failure', identity: member }),
		{
			...empty,
			identity: member,
			accountReady: true,
			memberLoaded: true,
		},
	);
});

test('session-ended drops the member and flags the ended session without an error', () => {
	assert.deepEqual(wgSessionReducer(ready({ memberLoadError: true }), { type: 'session-ended' }), {
		identity: null,
		isAdmin: false,
		accountReady: false,
		memberLoaded: true,
		memberLoadError: false,
		sessionEnded: true,
	});
});

test('member-lost drops the member and leaves the error and session flags alone', () => {
	assert.deepEqual(wgSessionReducer(ready({ memberLoadError: true }), { type: 'member-lost' }), {
		identity: null,
		isAdmin: false,
		accountReady: false,
		memberLoaded: true,
		memberLoadError: true,
		sessionEnded: false,
	});
});

test('load-failed drops the member and records whether a retry makes sense', () => {
	const retryable = wgSessionReducer(ready(), { type: 'load-failed', retryable: true });
	assert.deepEqual(retryable, {
		identity: null,
		isAdmin: false,
		accountReady: false,
		memberLoaded: true,
		memberLoadError: true,
		sessionEnded: false,
	});
	assert.equal(
		wgSessionReducer(retryable, { type: 'load-failed', retryable: false }).memberLoadError,
		false,
	);
	assert.equal(
		wgSessionReducer(ready({ sessionEnded: true }), { type: 'load-failed', retryable: false })
			.sessionEnded,
		true,
	);
});

test('admin only toggles the flag and keeps the state object when unchanged', () => {
	const state = ready({ isAdmin: false });
	assert.equal(wgSessionReducer(state, { type: 'admin', isAdmin: false }), state);
	assert.deepEqual(wgSessionReducer(state, { type: 'admin', isAdmin: true }), {
		...state,
		isAdmin: true,
	});
});
