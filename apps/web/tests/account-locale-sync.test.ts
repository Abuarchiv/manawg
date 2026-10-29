import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { syncAccountLocale } from '@/components/app/account-locale';

const store = new Map<string, string>();
let patches: string[] = [];

beforeEach(() => {
	store.clear();
	patches = [];
	Object.assign(globalThis, {
		window: {
			localStorage: {
				getItem: (k: string) => store.get(k) ?? null,
				setItem: (k: string, v: string) => store.set(k, v),
			},
		},
		fetch: async (_url: string, init: { body: string }) => {
			patches.push(init.body);
			return { ok: true, text: async () => '' };
		},
	});
});

test('a language shown but never stored on the account is saved', async () => {
	await syncAccountLocale('en');
	assert.deepEqual(patches, ['{"locale":"en"}']);
	assert.equal(store.get('manawg:locale-synced'), 'en');
});

test('a language already stored from this device is not sent again', async () => {
	store.set('manawg:locale-synced', 'en');
	await syncAccountLocale('en');
	assert.deepEqual(patches, []);
});

test('a failed save is retried on the next sync', async () => {
	Object.assign(globalThis, { fetch: async () => ({ ok: false, text: async () => '' }) });
	await syncAccountLocale('en');
	assert.equal(store.get('manawg:locale-synced'), undefined);
});
