import assert from 'node:assert/strict';
import { mock } from 'node:test';
import type { OfflineAction } from '@/core/offline/offline-action';

// Loads independent copies of the offline queue, one per simulated browser tab. Each copy has its
// own module state (queue cache, sync lock) and its own API, identity and image stand-ins; tabs of
// one test share a storage and a lock manager the way tabs of one browser do.

type OfflineClient = typeof import('@/core/offline/offline-client');
export type ApiResult = { ok: true; data: unknown } | { ok: false; status: number; error: string };
export type ApiInit = {
	method?: string;
	headers?: Record<string, string>;
	memberId?: string;
	signal?: AbortSignal;
};

export const VALID_KEY = '00000000-0000-4000-8000-000000000001';

type ActionOverrides = { [K in keyof OfflineAction]?: OfflineAction[K] | undefined };

export function createAction(overrides: ActionOverrides = {}): OfflineAction {
	// Overrides may clear optional fields (`wgId: undefined`) to model legacy entries.
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
	} as OfflineAction;
}

export type FakeStorage = ReturnType<typeof makeStorage>;

export function makeStorage() {
	const values = new Map<string, string>();
	return {
		values,
		getItem(key: string): string | null {
			return values.get(key) ?? null;
		},
		setItem(key: string, value: string): void {
			values.set(key, String(value));
		},
		removeItem(key: string): void {
			values.delete(key);
		},
	};
}

export function makeLockManager() {
	const tails = new Map<string, Promise<unknown>>();
	return {
		request<T>(name: string, _options: unknown, callback: () => T | Promise<T>): Promise<T> {
			const previous = tails.get(name) ?? Promise.resolve();
			let release: () => void = () => undefined;
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

export function deferred<T = void>() {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

/** A stand-in for the queue serializer: request shape and failure copy stay inspectable. */
const fakeQueue = {
	isOfflineIdempotencyKey: (value: unknown) =>
		typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value),
	createOfflineIdempotencyKey: () => VALID_KEY,
	isQueuedCreateId: (value: unknown) =>
		typeof value === 'string' && /^(?:shopping|chore-create|absence):/.test(value),
	explainOfflineActionFailure: (status: number, error?: string) => ({
		title: 'Fehler',
		detail: `${status}:${error ?? ''}`,
	}),
	getOfflineActionRequest: (action: OfflineAction) => ({
		path: `/api/wg/${action.shareCode}/actions`,
		method: action.type === 'shopping.update' ? 'PATCH' : 'POST',
		body: action.payload,
	}),
	serializeOfflineAction: (action: OfflineAction) => JSON.stringify(action),
	shouldRetryOfflineAction: () => true,
	withoutQueuedEntry: (actions: OfflineAction[], shareCode: string, id: string) => {
		if (!actions.some((action) => action.shareCode === shareCode && action.id === id)) return null;
		return actions.filter((action) => action.id !== id || action.shareCode !== shareCode);
	},
};

type ImageStandIns = {
	isPendingImageToken?: (value: unknown) => boolean;
	uploadPendingImageToken?: (...args: unknown[]) => Promise<string>;
	removePendingImage?: (...args: unknown[]) => Promise<void>;
};

export interface QueueModuleOptions {
	apiFetch?: (path: string, init: ApiInit) => Promise<ApiResult> | ApiResult;
	identity?: (wgId: string) => unknown;
	/** Stand-ins for the pending-image module, or `'real'` to load it against browser globals. */
	images?: ImageStandIns | 'real';
	storage?: FakeStorage;
	/** Replaces the global `Date`, e.g. a subclass with a fixed `now()`. */
	clock?: { now(): number };
	locks?: ReturnType<typeof makeLockManager> | null;
	globals?: Record<string, unknown>;
}

const savedGlobals = new Map<string, PropertyDescriptor | undefined>();
let instanceCount = 0;

function setGlobal(name: string, value: unknown): void {
	if (!savedGlobals.has(name)) {
		savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
	}
	Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

/** Restores the browser globals the last loaded tab installed; call after every test. */
export function restoreGlobals(): void {
	for (const [name, descriptor] of savedGlobals) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	}
	savedGlobals.clear();
}

const at = (path: string, instance: number) =>
	new URL(`../../src/${path}?instance=${instance}`, import.meta.url).href;

export async function makeQueueModule({
	apiFetch = async () => ({ ok: false, status: 0, error: 'network' }),
	identity = () => ({ memberId: 'member-a' }),
	images = {},
	storage = makeStorage(),
	clock = Date,
	locks = makeLockManager(),
	globals = {},
}: QueueModuleOptions = {}): Promise<{ module: OfflineClient; storage: FakeStorage }> {
	instanceCount += 1;
	const instance = instanceCount;
	const window = { localStorage: storage, dispatchEvent() {} };
	// Tabs of one test share storage and locks, so the globals of the latest tab serve all of them.
	setGlobal('window', window);
	setGlobal('navigator', locks ? { locks } : {});
	setGlobal('Date', clock);
	for (const [name, value] of Object.entries(globals)) setGlobal(name, value);

	mock.module(at('core/infra/api-client.ts', instance), {
		namedExports: { apiFetch: (path: string, init: ApiInit) => apiFetch(path, init) },
	});
	mock.module(at('core/utils/browser.ts', instance), {
		namedExports: { safeLocalStorage: () => window.localStorage },
	});
	mock.module(at('shared/lib/identity.ts', instance), {
		namedExports: { getIdentity: (wgId: string) => identity(wgId) },
	});
	mock.module(at('core/offline/offline-queue.ts', instance), { namedExports: fakeQueue });
	if (images !== 'real') {
		mock.module(at('core/offline/offline-images.ts', instance), {
			namedExports: {
				isPendingImageToken: (value: unknown) =>
					typeof value === 'string' && value.startsWith('manawg-pending-image:'),
				uploadPendingImageToken: async () => 'https://app.invalid/image',
				removePendingImage: async () => {},
				...images,
			},
		});
	}
	const module: OfflineClient = await import(at('core/offline/offline-client.ts', instance));
	return { module, storage };
}

export async function setQueue(module: OfflineClient, actions: OfflineAction[]): Promise<void> {
	assert.equal(await module.updateOfflineQueue(() => actions), true);
}

/** The queued action at `index`, failing the test when the queue is shorter. */
export function queued(module: OfflineClient, index = 0): OfflineAction {
	const action = module.readOfflineQueue()[index];
	assert.ok(action, `queue has an action at ${index}`);
	return action;
}

/** The stored queue as raw JSON, as another tab would read it. */
export function storedQueue(storage: FakeStorage): OfflineAction[] {
	return JSON.parse(storage.getItem('manawg:offline-actions') ?? 'null');
}
