import assert from 'node:assert/strict';
import test from 'node:test';

const { isAccountStorageChange } = await import('./use-session-member');

let storedUserId: string | null = null;
const localStorage: Storage = {
	length: 0,
	clear() {
		storedUserId = null;
	},
	getItem(key) {
		return key === 'manawg_account' ? storedUserId : null;
	},
	key() {
		return null;
	},
	removeItem(key) {
		if (key === 'manawg_account') storedUserId = null;
	},
	setItem(key, value) {
		if (key === 'manawg_account') storedUserId = value;
	},
};

function storageChange(
	key: string | null,
	oldValue: string | null,
	newValue: string | null,
	storageArea: Storage = localStorage,
): Pick<StorageEvent, 'key' | 'oldValue' | 'newValue' | 'storageArea'> {
	return { key, oldValue, newValue, storageArea };
}

test('detects only real changes to the local account in local storage', () => {
	storedUserId = 'konto-b';
	assert.equal(
		isAccountStorageChange(
			storageChange('manawg_account', 'konto-a', 'konto-b'),
			'konto-a',
			localStorage,
		),
		true,
	);
	storedUserId = null;
	assert.equal(
		isAccountStorageChange(storageChange(null, null, null), 'konto-a', localStorage),
		true,
	);
	storedUserId = 'konto-a';
	assert.equal(
		isAccountStorageChange(
			storageChange('manawg_account', 'konto-a', 'konto-a'),
			'konto-a',
			localStorage,
		),
		false,
	);
	storedUserId = 'konto-b';
	assert.equal(
		isAccountStorageChange(
			storageChange('manawg_account', 'konto-a', null),
			'konto-b',
			localStorage,
		),
		false,
	);
	assert.equal(
		isAccountStorageChange(
			storageChange('manawg:offline-actions', 'alt', 'neu'),
			'konto-a',
			localStorage,
		),
		false,
	);
	assert.equal(
		isAccountStorageChange(
			storageChange('manawg_account', 'konto-a', 'konto-b', { ...localStorage }),
			'konto-a',
			localStorage,
		),
		false,
	);
	assert.equal(isAccountStorageChange(storageChange(null, null, null), null, localStorage), false);
});
