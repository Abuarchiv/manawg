'use client';

import { getLocalAccount } from '@/core/auth/local-account';
import { createIdempotencyKey } from '@/core/http/idempotency-key';
import {
	anySignal,
	noteSessionExpiry,
	REQUEST_TIMEOUT_MS,
	readApiErrorCode,
} from '@/core/infra/api-client';
import { EXPECTED_MEMBER_ID_HEADER } from '@/shared/lib/member-header';

const DB_NAME = 'manawg-offline-images';
const STORE_NAME = 'images';
const DB_VERSION = 1;
const TOKEN_PREFIX = 'manawg-pending-image:';
// A stalled PUT on a bad mobile connection would otherwise block the uploader indefinitely.
const UPLOAD_TIMEOUT_MS = 60_000;

export type ImageUploadPurpose = 'expense' | 'announcement' | 'chat';

/** The IndexedDB blob behind a pending-image token is gone (cleared storage, other member). */
export class PendingImageMissingError extends Error {
	constructor() {
		super('pending-image-missing');
		this.name = 'PendingImageMissingError';
	}
}

interface PendingImageRecord {
	id: string;
	file: Blob;
	name: string;
	type: string;
	size: number;
	shareCode: string;
	memberId: string;
	purpose: ImageUploadPurpose;
	createdAt: string;
	publicUrl?: string;
}

interface SignResponse {
	presignedUrl: string;
	publicUrl: string;
	maxFileSize: number;
	uploadHeaders?: Record<string, string>;
}

function createPendingImageToken(id: string): string {
	return `${TOKEN_PREFIX}${id}`;
}

export function isPendingImageToken(value: string | null | undefined): value is string {
	return Boolean(value?.startsWith(TOKEN_PREFIX));
}

function pendingImageIdFromToken(token: string): string {
	return token.slice(TOKEN_PREFIX.length);
}

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

async function withStore<T>(
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

function createUploadScope(inputSignal?: AbortSignal) {
	const account = getLocalAccount();
	const accountController = new AbortController();
	const signal = inputSignal
		? anySignal([accountController.signal, inputSignal])
		: accountController.signal;
	const storageWindow = typeof window === 'undefined' ? null : window;
	const onStorage = () => {
		if (getLocalAccount() !== account) accountController.abort();
	};
	storageWindow?.addEventListener('storage', onStorage);
	return {
		account,
		signal,
		isCurrent: () => !signal.aborted && getLocalAccount() === account,
		dispose: () => storageWindow?.removeEventListener('storage', onStorage),
	};
}

export async function clearPendingImages(
	expectedAccount: string | null,
	signal?: AbortSignal,
): Promise<boolean> {
	const isCurrent = () => !signal?.aborted && getLocalAccount() === expectedAccount;
	if (!isCurrent()) return false;
	try {
		const keys = await withStore('readonly', (store) => store.getAllKeys(), undefined, signal);
		if (!isCurrent()) return false;
		let stillCurrent = false;
		await withStore(
			'readwrite',
			(store) => {
				stillCurrent = isCurrent();
				if (stillCurrent) {
					for (const key of keys) {
						if (!isCurrent()) {
							stillCurrent = false;
							break;
						}
						store.delete(key);
					}
				}
				return store.count();
			},
			undefined,
			signal,
		);
		return stillCurrent && isCurrent();
	} catch {
		return isCurrent();
	}
}

export async function storePendingImage(input: {
	file: File;
	shareCode: string;
	memberId: string;
	purpose: ImageUploadPurpose;
	signal?: AbortSignal;
}): Promise<string> {
	const scope = createUploadScope(input.signal);
	try {
		if (!scope.isCurrent()) throw new DOMException('Upload cancelled.', 'AbortError');
		const now = Date.now();
		// Local IndexedDB key only: prefer UUID, but keep browsers without Web Crypto usable.
		const suffix =
			createIdempotencyKey() ?? `${now.toString(36)}-${Math.random().toString(36).slice(2)}`;
		const id = `${input.shareCode}:${input.purpose}:${now}:${suffix}`;
		const record: PendingImageRecord = {
			id,
			file: input.file,
			name: input.file.name,
			type: input.file.type,
			size: input.file.size,
			shareCode: input.shareCode,
			memberId: input.memberId,
			purpose: input.purpose,
			createdAt: new Date(now).toISOString(),
		};
		let committed = false;
		try {
			await withStore(
				'readwrite',
				(store) => store.put(record, id),
				(_store, _result, tx) => {
					if (!scope.isCurrent()) tx.abort();
				},
				scope.signal,
			);
			committed = true;
		} catch (error) {
			if (!scope.isCurrent()) throw new DOMException('Upload cancelled.', 'AbortError');
			throw error;
		}
		if (!scope.isCurrent()) {
			if (committed) await withStore('readwrite', (store) => store.delete(id)).catch(() => {});
			throw new DOMException('Upload cancelled.', 'AbortError');
		}
		return createPendingImageToken(id);
	} finally {
		scope.dispose();
	}
}

export async function readPendingImage(
	token: string,
	memberId: string,
): Promise<PendingImageRecord | null> {
	if (!isPendingImageToken(token)) return null;
	const record = await withStore('readonly', (store) => store.get(pendingImageIdFromToken(token)));
	return record?.memberId === memberId ? record : null;
}

export async function removePendingImage(token: string, memberId: string): Promise<void> {
	if (!isPendingImageToken(token)) return;
	if (!(await readPendingImage(token, memberId))) return;
	await withStore('readwrite', (store) => store.delete(pendingImageIdFromToken(token)));
}

export type SignAndPutResult =
	| { ok: true; publicUrl: string }
	| { ok: false; kind: 'sign'; status: number; code: string }
	| { ok: false; kind: 'put'; status: number };

/**
 * Asks /api/upload/sign for a presigned URL and PUTs the file to it. The one copy of this
 * flow for the online upload hook and the offline sync; each maps the failure to its own
 * behavior. Status 0 means the request never got an answer (network error, timeout, abort).
 */
export async function signAndPut(input: {
	shareCode: string;
	purpose: ImageUploadPurpose;
	file: Blob;
	contentType: string;
	memberId?: string;
	signal?: AbortSignal | undefined;
}): Promise<SignAndPutResult> {
	const scope = createUploadScope(input.signal);
	const withTimeout = (ms: number) => anySignal([scope.signal, AbortSignal.timeout(ms)]);
	try {
		if (!scope.isCurrent()) return { ok: false, kind: 'sign', status: 0, code: '' };
		let sigRes: Response;
		try {
			sigRes = await fetch('/api/upload/sign', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					// The server checks it against the session so a switched member cannot sign for another.
					...(input.memberId ? { [EXPECTED_MEMBER_ID_HEADER]: input.memberId } : {}),
				},
				signal: withTimeout(REQUEST_TIMEOUT_MS),
				body: JSON.stringify({
					shareCode: input.shareCode,
					purpose: input.purpose,
					mimeType: input.contentType,
					fileSize: input.file.size,
				}),
			});
		} catch {
			return { ok: false, kind: 'sign', status: 0, code: '' };
		}
		if (!scope.isCurrent()) return { ok: false, kind: 'sign', status: 0, code: '' };
		noteSessionExpiry(sigRes, scope.account);
		if (!sigRes.ok) {
			const code = await readApiErrorCode(sigRes);
			if (!scope.isCurrent()) return { ok: false, kind: 'sign', status: 0, code: '' };
			return { ok: false, kind: 'sign', status: sigRes.status, code };
		}
		let sig: SignResponse;
		try {
			sig = (await sigRes.json()) as SignResponse;
		} catch {
			return { ok: false, kind: 'sign', status: 0, code: '' };
		}
		if (!scope.isCurrent()) return { ok: false, kind: 'sign', status: 0, code: '' };
		let uploadRes: Response;
		try {
			uploadRes = await fetch(sig.presignedUrl, {
				method: 'PUT',
				body: input.file,
				headers: { ...sig.uploadHeaders, 'Content-Type': input.contentType },
				signal: withTimeout(UPLOAD_TIMEOUT_MS),
			});
		} catch {
			return { ok: false, kind: 'put', status: 0 };
		}
		if (!scope.isCurrent()) return { ok: false, kind: 'put', status: 0 };
		if (!uploadRes.ok) return { ok: false, kind: 'put', status: uploadRes.status };
		return { ok: true, publicUrl: sig.publicUrl };
	} finally {
		scope.dispose();
	}
}
export async function uploadPendingImageToken(
	token: string,
	memberId: string,
	signal?: AbortSignal,
): Promise<string> {
	const scope = createUploadScope(signal);
	try {
		if (!scope.isCurrent()) throw new Error('sign-network-failed');
		const record = await readPendingImage(token, memberId);
		if (!scope.isCurrent()) throw new Error('sign-network-failed');
		if (!record) throw new PendingImageMissingError();
		if (record.publicUrl !== undefined) return record.publicUrl;
		const result = await signAndPut({
			shareCode: record.shareCode,
			purpose: record.purpose,
			file: record.file,
			contentType: record.type,
			memberId,
			signal: scope.signal,
		});
		if (!scope.isCurrent()) {
			throw new Error(
				result.ok || result.kind === 'put' ? 'put-network-failed' : 'sign-network-failed',
			);
		}
		if (!result.ok) {
			// sync classifies messages (offline-replay-rules, image-upload-errors).
			if (result.status === 0) throw new Error(`${result.kind}-network-failed`);
			if (result.kind === 'put') throw new Error(`upload-failed:${result.status}`);
			throw new Error(
				result.code
					? `sign-failed:${result.status}:${result.code}`
					: `sign-failed:${result.status}`,
			);
		}

		let missing = false;
		let stale = false;
		let existingUrl: string | undefined;
		try {
			await withStore(
				'readwrite',
				(store) => store.get(record.id) as IDBRequest<PendingImageRecord | undefined>,
				(store, current, tx) => {
					if (!scope.isCurrent()) {
						stale = true;
						tx.abort();
						return;
					}
					if (!current || current.memberId !== memberId) {
						missing = true;
						return;
					}
					if (current.publicUrl !== undefined) {
						existingUrl = current.publicUrl;
						return;
					}
					if (!scope.isCurrent()) {
						stale = true;
						tx.abort();
						return;
					}
					store.put({ ...current, publicUrl: result.publicUrl }, current.id);
				},
				scope.signal,
			);
		} catch (error) {
			if (!scope.isCurrent() || stale) throw new Error('put-network-failed');
			throw error;
		}
		if (!scope.isCurrent() || stale) throw new Error('put-network-failed');
		if (missing) throw new PendingImageMissingError();
		return existingUrl ?? result.publicUrl;
	} finally {
		scope.dispose();
	}
}
