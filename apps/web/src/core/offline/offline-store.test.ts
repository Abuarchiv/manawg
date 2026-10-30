import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const localStorage = {};
mock.module('@/core/utils/browser', {
	namedExports: { safeLocalStorage: () => localStorage },
});
const { OFFLINE_QUEUE_EVENT, subscribeOfflineQueueChanges } = await import('./offline-store');

test('queue subscribers react only to matching changes from other tabs', () => {
	const target = new EventTarget();
	let updates = 0;
	const unsubscribe = subscribeOfflineQueueChanges(() => updates++, target);

	target.dispatchEvent(new Event(OFFLINE_QUEUE_EVENT));
	const unrelatedChange = new Event('storage');
	Object.defineProperties(unrelatedChange, {
		key: { value: 'unrelated' },
		storageArea: { value: localStorage },
	});
	target.dispatchEvent(unrelatedChange);
	const sessionStorageChange = new Event('storage');
	Object.defineProperties(sessionStorageChange, {
		key: { value: 'manawg:offline-actions' },
		storageArea: { value: {} },
	});
	target.dispatchEvent(sessionStorageChange);
	const queueChange = new Event('storage');
	Object.defineProperties(queueChange, {
		key: { value: 'manawg:offline-actions' },
		storageArea: { value: localStorage },
	});
	target.dispatchEvent(queueChange);
	const clearedStorage = new Event('storage');
	Object.defineProperties(clearedStorage, {
		key: { value: null },
		storageArea: { value: localStorage },
	});
	target.dispatchEvent(clearedStorage);

	assert.equal(updates, 3);
	unsubscribe();
	target.dispatchEvent(new Event(OFFLINE_QUEUE_EVENT));
	assert.equal(updates, 3);
});
