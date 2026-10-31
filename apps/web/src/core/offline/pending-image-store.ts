'use client';

const DB_NAME = 'manawg-offline-images';
const STORE_NAME = 'images';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

export async function withPendingImageStore<T>(
	mode: IDBTransactionMode,
	run: (store: IDBObjectStore) => IDBRequest<T>,
	onSuccess?: (store: IDBObjectStore, result: T, tx: IDBTransaction) => void,
	signal?: AbortSignal,
): Promise<T> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, mode);
		const store = tx.objectStore(STORE_NAME);
		let result: T;
		let requestError: DOMException | null = null;
		let callbackError: unknown;
		let callbackFailed = false;
		const onAbort = () => {
			try {
				tx.abort();
			} catch {
				// The transaction may already be complete.
			}
		};
		const close = () => {
			signal?.removeEventListener('abort', onAbort);
			db.close();
		};
		tx.oncomplete = () => {
			close();
			if (callbackFailed) reject(callbackError);
			else if (requestError) reject(requestError);
			else resolve(result);
		};
		tx.onerror = () => {
			close();
			reject(callbackFailed ? callbackError : (tx.error ?? requestError));
		};
		tx.onabort = () => {
			close();
			reject(
				callbackFailed
					? callbackError
					: (tx.error ?? new Error('offline-image-transaction-aborted')),
			);
		};
		if (signal) {
			signal.addEventListener('abort', onAbort, { once: true });
			if (signal.aborted) {
				onAbort();
				return;
			}
		}
		let request: IDBRequest<T>;
		try {
			request = run(store);
		} catch (error) {
			callbackFailed = true;
			callbackError = error;
			onAbort();
			return;
		}
		request.onsuccess = () => {
			result = request.result;
			try {
				onSuccess?.(store, result, tx);
			} catch (error) {
				callbackFailed = true;
				callbackError = error;
				onAbort();
			}
		};
		request.onerror = () => {
			requestError = request.error;
		};
	});
}
