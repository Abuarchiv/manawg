import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

type Invite = { id: string; url: string; expiresAt: string };
type Reply = { ok: true; invite: Invite | null } | { ok: false; message: { key: string } };
type Effect = () => undefined | (() => void);

let slots: unknown[] = [];
let cursor = 0;
let effects: Effect[] = [];
let cleanups: (() => void)[] = [];
let answers: Reply[] = [];
let calls = 0;
let refreshes = 0;
let shared: Array<{ event: string; properties?: unknown }> = [];
let outcome: 'shared' | 'copied' | 'failed' | 'cancelled' = 'shared';
let copiedText: string | null | undefined;
let activation = true;
let liveAnswers: Array<{ ok: boolean; data?: { members: string; data: string } }> = [];
let timers: Array<() => void> = [];

const invite = (id = 'first', expiresAt = new Date(Date.now() + 60_000).toISOString()): Invite => ({
	id,
	url: `https://example.com/invite/${id}`,
	expiresAt,
});
const ready = (value: Invite | null = invite()): Reply => ({ ok: true, invite: value });
const failed: Reply = { ok: false, message: { key: 'failed' } };
const refreshMembers = () => {
	refreshes++;
};

mock.module('react', {
	namedExports: {
		useState(initial: unknown) {
			const index = cursor++;
			if (!(index in slots)) slots[index] = initial;
			return [
				slots[index],
				(value: unknown) => {
					slots[index] = typeof value === 'function' ? value(slots[index]) : value;
				},
			];
		},
		useRef(initial: unknown) {
			const index = cursor++;
			if (!(index in slots)) slots[index] = { current: initial };
			return slots[index];
		},
		useEffect(effect: Effect, dependencies: unknown[]) {
			const index = cursor++;
			const previous = slots[index] as unknown[] | undefined;
			if (previous && dependencies.every((value, i) => Object.is(value, previous[i]))) return;
			slots[index] = dependencies;
			effects.push(effect);
		},
	},
});
mock.module('@/components/wg/WgContextProvider', {
	namedExports: {
		useWg: () => ({
			wg: { shareCode: 'CODE', name: 'House' },
			identity: { memberId: 'member' },
			refreshMembers,
		}),
	},
});
mock.module('@/shared/i18n/message', {
	namedExports: { useMessage: () => (message: { text: string }) => message.text },
});
mock.module('@/shared/lib/analytics', {
	defaultExport: {
		capture: (event: string, properties?: unknown) => shared.push({ event, properties }),
	},
});
mock.module('@/components/wg/invite-share', {
	namedExports: {
		currentInvite: async () => {
			calls++;
			return answers.shift() ?? ready();
		},
		inviteShareMessage: (_name: string, url: string) => ({ text: url }),
		shareInvite: async () => outcome,
		copyWhenReady: async (promise: Promise<string | null>) => {
			copiedText = await promise;
			return copiedText === null ? 'cancelled' : outcome;
		},
	},
});
mock.module('@/core/infra/api-client', {
	namedExports: { apiFetch: async () => liveAnswers.shift() ?? new Promise(() => {}) },
});

const documentEvents = new EventTarget();
const windowEvents = new EventTarget();
Object.assign(globalThis, {
	document: Object.assign(documentEvents, { hidden: false, visibilityState: 'visible' }),
	window: Object.assign(windowEvents, {
		setTimeout: (fn: () => void) => {
			timers.push(fn);
			return timers.length;
		},
		clearTimeout: () => {},
	}),
});
Object.defineProperty(globalThis, 'navigator', {
	configurable: true,
	value: {
		userActivation: {
			get isActive() {
				return activation;
			},
		},
	},
});

const { useCurrentInviteShare: runHook } = await import('./use-current-invite-share');
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
async function render(source: 'card' | 'row' = 'card') {
	await settle();
	cursor = 0;
	const result = runHook(source);
	for (const effect of effects.splice(0)) {
		const cleanup = effect();
		if (cleanup) cleanups.push(cleanup);
	}
	await settle();
	return result;
}
async function loaded(source: 'card' | 'row' = 'card') {
	await render(source);
	return render(source);
}
beforeEach(() => {
	for (const cleanup of cleanups) cleanup();
	slots = [];
	cursor = 0;
	effects = [];
	cleanups = [];
	answers = [];
	calls = 0;
	refreshes = 0;
	shared = [];
	outcome = 'shared';
	copiedText = undefined;
	activation = true;
	liveAnswers = [];
	timers = [];
	Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

test('loads and shares the checked link with the card event', async () => {
	let hook = await loaded();
	assert.equal(hook.state.status, 'ready');
	await hook.share();
	hook = await render();
	assert.equal(hook.shared, 'shared');
	assert.equal(calls, 2);
	assert.deepEqual(shared, [
		{ event: 'invite_card_shown', properties: undefined },
		{ event: 'invite_card_shared', properties: { method: 'share' } },
	]);
});

test('a lost activation asks for another tap and copies only the checked link', async () => {
	let hook = await loaded('row');
	activation = false;
	await hook.share();
	hook = await render('row');
	assert.equal(hook.shared, 'checked');
	activation = true;
	outcome = 'copied';
	await hook.share();
	hook = await render('row');
	assert.equal(hook.shared, 'copied');
	assert.equal(copiedText, 'https://example.com/invite/first');
	assert.deepEqual(shared, [{ event: 'solo_invite_shared', properties: { method: 'copy' } }]);
});

test('a replaced link asks for another tap and never shares the old one', async () => {
	let hook = await loaded();
	answers.push(ready(invite('replacement')));
	await hook.share();
	hook = await render();
	assert.equal(hook.shared, 'fresh');
	assert.equal(hook.state.status === 'ready' && hook.state.invite.id, 'replacement');
	assert.equal(shared.length, 1);
});

test('errors and a joined member do not share', async () => {
	answers.push(failed);
	await render();
	let hook = await render();
	assert.equal(hook.state.status, 'failed');
	hook.retry();
	await render();
	hook = await render();
	answers.push(ready(null));
	await hook.share();
	assert.equal(refreshes, 1);
	assert.equal(shared.length, 1);
});

test('cancelled and failed shares do not count as a successful share', async () => {
	let hook = await loaded();
	outcome = 'cancelled';
	await hook.share();
	outcome = 'failed';
	await hook.share();
	hook = await render();
	assert.equal(hook.shared, 'failed');
	assert.equal(shared.length, 1);
});

test('a failed confirmation and an expired link are never shared', async () => {
	let hook = await loaded();
	answers.push(failed);
	await hook.share();
	hook = await render();
	assert.equal(hook.state.status, 'failed');
	hook.retry();
	answers.push(ready(invite('expired', new Date(Date.now() - 1000).toISOString())));
	await render();
	hook = await render();
	const before = calls;
	await hook.share();
	assert.equal(calls, before);
	assert.equal(shared.length, 1);
});

test('joining before the initial fetch refreshes the roster', async () => {
	answers.push(ready(null));
	await render();
	assert.equal(refreshes, 1);
});

test('returning to the page checks the link once', async () => {
	await loaded();
	const before = calls;
	window.dispatchEvent(new Event('focus'));
	document.dispatchEvent(new Event('visibilitychange'));
	await render();
	assert.equal(calls, before + 1);
});

test('live changes refresh the roster and the current link', async () => {
	liveAnswers.push(
		{ ok: true, data: { members: '0', data: '0' } },
		{ ok: true, data: { members: '1', data: '1' } },
	);
	await render();
	assert.ok(timers.length > 0);
	timers.shift()?.();
	await settle();
	await render();
	assert.equal(refreshes, 1);
	assert.equal(calls, 2);
});
