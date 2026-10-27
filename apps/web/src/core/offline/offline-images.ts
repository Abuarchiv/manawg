'use client';

import { createIdempotencyKey } from '@/core/http/idempotency-key';
import {
	REQUEST_TIMEOUT_MS,
	anySignal,
	noteSessionExpiry,
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
): Promise<T> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, mode);
		const request = run(tx.objectStore(STORE_NAME));
		let result: T;
		let requestError: DOMException | null = null;
		request.onsuccess = () => {
			result = request.result;
		};
		request.onerror = () => {
			requestError = request.error;
		};
		tx.oncomplete = () => {
			db.close();
			if (requestError) reject(requestError);
			else resolve(result);
		};
		tx.onerror = () => {
			db.close();
			reject(tx.error);
		};
		tx.onabort = () => {
			db.close();
			reject(tx.error ?? new Error('offline-image-transaction-aborted'));
		};
	});
}

export async function storePendingImage(input: {
	file: File;
	shareCode: string;
	memberId: string;
	purpose: ImageUploadPurpose;
}): Promise<string> {
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
	await withStore('readwrite', (store) => store.put(record, id));
	return createPendingImageToken(id);
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
	// A stalled request must not block the uploader forever.
	const withTimeout = (ms: number) =>
		input.signal ? anySignal([input.signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
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
	noteSessionExpiry(sigRes);
	if (!sigRes.ok) {
		return { ok: false, kind: 'sign', status: sigRes.status, code: await readApiErrorCode(sigRes) };
	}
	let sig: SignResponse;
	try {
		sig = (await sigRes.json()) as SignResponse;
	} catch {
		return { ok: false, kind: 'sign', status: 0, code: '' };
	}
	try {
		const uploadRes = await fetch(sig.presignedUrl, {
			method: 'PUT',
			body: input.file,
			headers: { ...sig.uploadHeaders, 'Content-Type': input.contentType },
			signal: withTimeout(UPLOAD_TIMEOUT_MS),
		});
		if (!uploadRes.ok) return { ok: false, kind: 'put', status: uploadRes.status };
	} catch {
		return { ok: false, kind: 'put', status: 0 };
	}
	return { ok: true, publicUrl: sig.publicUrl };
}

export async function uploadPendingImageToken(
	token: string,
	memberId: string,
	signal?: AbortSignal,
): Promise<string> {
	const record = await readPendingImage(token, memberId);
	if (!record) throw new PendingImageMissingError();
	if (record.publicUrl) return record.publicUrl;
	const result = await signAndPut({
		shareCode: record.shareCode,
		purpose: record.purpose,
		file: record.file,
		contentType: record.type,
		memberId,
		signal,
	});
	if (!result.ok) {
		// The sync classifies these messages (offline-replay-rules, image-upload-errors).
		if (result.status === 0) throw new Error(`${result.kind}-network-failed`);
		if (result.kind === 'put') throw new Error(`upload-failed:${result.status}`);
		throw new Error(
			result.code ? `sign-failed:${result.status}:${result.code}` : `sign-failed:${result.status}`,
		);
	}
	await withStore('readwrite', (store) =>
		store.put({ ...record, publicUrl: result.publicUrl }, record.id),
	);
	return result.publicUrl;
}
