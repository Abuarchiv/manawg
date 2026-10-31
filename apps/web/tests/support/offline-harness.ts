// Shared setup for the offline-queue tests: every "tab" is its own instance of the real
// offline-client module graph (`?instance=N`, see resolve-hooks.mjs) wired to its own mocks.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { PendingImageMissingError } from '../../src/core/offline/offline-images.ts';
import { deferred } from './deferred.ts';

export { deferred, PendingImageMissingError };

export const { OFFLINE_REPLAY_MAX_AGE_MS, RESPONSE_REPLAY_TTL_SECONDS } = await import(
	'../../src/core/offline/replay-retention.ts'
);

export const VALID_KEY = '00000000-0000-4000-8000-000000000001';

// biome-ignore lint/suspicious/noExplicitAny: queue entries are fake actions of any type
export type Action = Record<string, any>;

/** The offline-client API as the tests use it, with fake actions instead of the strict union. */
export interface QueueModule {
	enqueueOfflineAction(action: Action): Promise<number>;
	updateOfflineQueue(update: (actions: Action[]) => Action[]): Promise<boolean>;
	discardQueuedEntry(shareCode: string, id: string): Promise<string>;
	removeQueuedAction(id: string, expectedTypes?: readonly string[]): Promise<boolean>;
	syncOfflineActions(
		shareCode: string,
		options: { force?: boolean; memberId?: string; signal?: AbortSignal },
	): Promise<number>;
	/** Typed as non-empty because the tests read the first entry of queues they just filled. */
	readOfflineQueue(): [Action, ...Action[]];
	needsManualOfflineResolution(action: Action): boolean;
	isOfflineActionQueued(id: string): boolean;
	adoptLocalAccount(authUserId: string): Promise<void>;
	filterOfflineActionsForAuthUser(actions: Action[], authUserId: string | null): Action[];
}

export function createAction(overrides: Action = {}): Action {
	return {
		id: 'action-1',
		idempotencyKey: VALID_KEY,
		type: 'announcement.create',
		wgId: 'wg-1',
		shareCode: 'TEST1234',
		memberId: 'member-a',
		createdAt: new Date().toISOString(),
		payload: { content: 'original', kind: 'info', imageUrl: null },
		...overrides,
	};
}

class FakeCustomEvent {
	type: string;
	detail: unknown;
	constructor(type: string, init: { detail?: unknown } = {}) {
		this.type = type;
		this.detail = init.detail;
	}
}

export function makeStorage() {
	const values = new Map<string, string>();
	return {
		values,
		getItem(key: string): string | null {
			return values.get(key) ?? null;
		},
		setItem(key: string, value: unknown): void {
			values.set(key, String(value));
		},
		removeItem(key: string): void {
			values.delete(key);
		},
	};
}
export type FakeStorage = ReturnType<typeof makeStorage>;

export function makeLockManager() {
	const tails = new Map<string, Promise<unknown>>();
	return {
		request(name: string, _options: unknown, callback: () => unknown) {
			const previous = tails.get(name) ?? Promise.resolve();
			let release: () => void = () => {};
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			const tail = previous.then(() => gate);
			tails.set(name, tail);
			return previous.then(callback).finally(() => {
				release();
				if (tails.get(name) === tail) tails.delete(name);
			});
		},
	};
}
type FakeLockManager = ReturnType<typeof makeLockManager>;

/** The persisted offline queue of a fake storage. */
export function readStoredQueue(storage: FakeStorage): Action[] {
	return JSON.parse(storage.getItem('manawg:offline-actions') ?? 'null');
}

const savedGlobals = new Map<string, PropertyDescriptor | undefined>();

/** Overrides a global for the current test; `restoreGlobals` puts every override back. */
export function setGlobal(name: string, value: unknown): void {
	if (!savedGlobals.has(name)) {
		savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
	}
	Object.defineProperty(globalThis, name, {
		configurable: true,
		enumerable: true,
		writable: true,
		value,
	});
}

export function restoreGlobals(): void {
	for (const [name, descriptor] of savedGlobals) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	}
	savedGlobals.clear();
}

const defaultQueue = {
	isQueuedCreateId: (value: unknown) =>
		typeof value === 'string' && /^(?:shopping|chore-create|absence):/.test(value),
	explainOfflineActionFailure: (status: number, error?: string) => ({
		title: 'Fehler',
		detail: `${status}:${error ?? ''}`,
	}),
	getOfflineActionRequest: (action: Action) => ({
		path: `/api/wg/${action.shareCode}/actions`,
		method: action.type === 'shopping.update' ? 'PATCH' : 'POST',
		body: action.payload,
	}),
	serializeOfflineAction: (action: Action) => JSON.stringify(action),
	shouldRetryOfflineAction: () => true,
	withoutQueuedEntry: (actions: Action[], shareCode: string, id: string) => {
		if (!actions.some((action) => action.shareCode === shareCode && action.id === id)) return null;
		return actions.filter((action) => action.id !== id || action.shareCode !== shareCode);
	},
};

let instances = 0;

export interface QueueOptions {
	apiFetch?: (path: string, init: Action) => Promise<unknown>;
	/** Replacement for the offline-images module; `null` keeps the real one. */
	images?: Record<string, unknown> | null;
	storage?: FakeStorage;
	clock?: unknown;
	locks?: FakeLockManager | null;
}

/**
 * Loads a fresh offline-client module graph. Browser globals are shared by all instances of a
 * test (they are the same in every tab); the storage and API belong to the instance.
 */
export async function makeQueueModule({
	apiFetch = async () => ({ ok: false, status: 0, error: 'network' }),
	images = {},
	storage = makeStorage(),
	clock = Date,
	locks = makeLockManager(),
}: QueueOptions = {}) {
	const listeners = new Map<string, Array<(event: Action) => void>>();
	const window = {
		localStorage: storage,
		/** Every event dispatched on this window, in order. */
		dispatched: [] as Action[],
		addEventListener(type: string, listener: (event: Action) => void) {
			listeners.set(type, [...(listeners.get(type) ?? []), listener]);
		},
		removeEventListener(type: string, listener: (event: Action) => void) {
			listeners.set(
				type,
				(listeners.get(type) ?? []).filter((entry) => entry !== listener),
			);
		},
		dispatchEvent(event: Action) {
			window.dispatched.push(event);
			for (const listener of listeners.get(event.type) ?? []) listener(event);
			return true;
		},
	};
	setGlobal('window', window);
	setGlobal('CustomEvent', FakeCustomEvent);
	setGlobal('Date', clock);
	setGlobal('navigator', locks ? { locks } : {});

	instances += 1;
	const instance = `?instance=${instances}`;
	const mockInstance = (specifier: string, namedExports: Record<string, unknown>) =>
		mock.module(`${specifier}${instance}`, { namedExports });
	mockInstance('@/core/infra/api-client', {
		apiFetch,
		REQUEST_TIMEOUT_MS: 15_000,
		anySignal: (signals: AbortSignal[]) => AbortSignal.any(signals),
		noteSessionExpiry() {},
		readApiErrorCode: async () => '',
	});
	mockInstance('@/core/utils/browser', { safeLocalStorage: () => storage });
	mockInstance('@/core/http/idempotency-key', {
		isIdempotencyKey: (value: unknown) =>
			typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value),
		createIdempotencyKey: () => VALID_KEY,
	});
	mockInstance('@/core/offline/offline-queue', defaultQueue);
	if (images !== null) {
		mockInstance('@/core/offline/offline-images', {
			isPendingImageToken: (value: unknown) =>
				typeof value === 'string' && value.startsWith('manawg-pending-image:'),
			PendingImageMissingError,
			uploadPendingImageToken: async () => 'https://app.invalid/image',
			removePendingImage: async () => {},
			...images,
		});
	}
	const module = (await import(
		`../../src/core/offline/offline-client.ts${instance}`
	)) as unknown as QueueModule;
	return { module, storage, window };
}

export async function setQueue(module: QueueModule, actions: Action[]): Promise<void> {
	assert.equal(await module.updateOfflineQueue(() => actions), true);
}

// biome-ignore lint/suspicious/noExplicitAny: hand-rolled IndexedDB fake
type Loose = any;

export function fakeIndexedDb(
	records: Map<string, Loose>,
	beforeGetAllKeys?: () => void,
	afterPut?: () => void,
) {
	return {
		open() {
			const request: Loose = {
				result: null,
				onupgradeneeded: null,
				onsuccess: null,
				onerror: null,
			};
			request.result = {
				objectStoreNames: { contains: () => true },
				createObjectStore() {},
				close() {},
				transaction() {
					const before = new Map(records);
					let aborted = false;
					const tx: Loose = {
						oncomplete: null,
						onerror: null,
						onabort: null,
						error: null,
						abort() {
							if (aborted) return;
							aborted = true;
							records.clear();
							for (const [key, value] of before) records.set(key, value);
							this.error = new DOMException('transaction aborted', 'AbortError');
							queueMicrotask(() => this.onabort?.());
						},
					};
					const makeRequest = (run: () => unknown) => {
						const req: Loose = { result: undefined, error: null, onsuccess: null, onerror: null };
						queueMicrotask(() => {
							if (aborted) return;
							try {
								req.result = run();
								req.onsuccess?.();
								if (!aborted) queueMicrotask(() => !aborted && tx.oncomplete?.());
							} catch (error) {
								req.error = error;
								tx.error = error;
								req.onerror?.();
								tx.onerror?.();
							}
						});
						return req;
					};
					tx.objectStore = () => ({
						get: (key: string) => makeRequest(() => records.get(key)),
						getAllKeys: () =>
							makeRequest(() => {
								beforeGetAllKeys?.();
								return [...records.keys()];
							}),
						put: (value: Loose, key: string) =>
							makeRequest(() => {
								records.set(key, value);
								afterPut?.();
								return key;
							}),
						delete: (key: string) => makeRequest(() => records.delete(key)),
						count: () => makeRequest(() => records.size),
					});
					return tx;
				},
			};
			queueMicrotask(() => request.onsuccess?.());
			return request;
		},
	};
}
