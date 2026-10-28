import 'server-only';

import { createClient } from '@supabase/supabase-js';
import {
	PRIVATE_IMAGE_MAX_BYTES,
	hasExactPrivateImageBucketConfig,
	isAllowedPrivateImageMimeType,
	isValidPrivateImageSize,
} from './private-image-policy';

export class ImageStorageConfigurationError extends Error {
	constructor() {
		super('private image storage is not configured');
		this.name = 'ImageStorageConfigurationError';
	}
}

export class ImageStorageObjectNotFoundError extends Error {
	constructor() {
		super('private image is unavailable');
		this.name = 'ImageStorageObjectNotFoundError';
	}
}

export interface PrivateImageDownload {
	stream: ReadableStream<Uint8Array>;
	contentType: string;
	contentLength: number;
}

function getSupabaseServiceClient(timeoutMs?: number) {
	const publicSupabaseURL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
	if (!publicSupabaseURL || !serviceRoleKey) throw new ImageStorageConfigurationError();

	return createClient(publicSupabaseURL, serviceRoleKey, {
		auth: {
			persistSession: false,
			autoRefreshToken: false,
			detectSessionInUrl: false,
		},
		...(timeoutMs
			? {
					global: {
						// Every request gets its own deadline, so a long paginated listing is not cut off.
						fetch: (input, init) => {
							const timeoutSignal = AbortSignal.timeout(timeoutMs);
							const signal = init?.signal
								? AbortSignal.any([init.signal, timeoutSignal])
								: timeoutSignal;
							return fetch(input, { ...init, signal });
						},
					},
				}
			: {}),
	});
}

async function getPrivateBucket(timeoutMs?: number) {
	const bucketName = process.env.SUPABASE_STORAGE_BUCKET?.trim();
	if (!bucketName) throw new ImageStorageConfigurationError();

	const client = getSupabaseServiceClient(timeoutMs);
	const { data, error } = await client.storage.getBucket(bucketName);
	if (error || !data || !hasExactPrivateImageBucketConfig(data)) {
		throw new ImageStorageConfigurationError();
	}
	return { client, bucketName };
}

export async function createSupabaseSignedUpload(
	key: string,
	contentType: string,
): Promise<{
	presignedUrl: string;
	maxFileSize: number;
	uploadHeaders: Record<string, string>;
}> {
	if (!isAllowedPrivateImageMimeType(contentType)) throw new ImageStorageConfigurationError();
	const { client, bucketName } = await getPrivateBucket();
	const { data, error } = await client.storage
		.from(bucketName)
		.createSignedUploadUrl(key, { upsert: false });
	if (error || !data) throw new ImageStorageConfigurationError();

	return {
		presignedUrl: data.signedUrl,
		maxFileSize: PRIVATE_IMAGE_MAX_BYTES,
		uploadHeaders: {
			'Cache-Control': 'max-age=0',
		},
	};
}

export async function removeSupabaseImages(objectKeys: readonly string[]): Promise<void> {
	if (objectKeys.length === 0) return;
	const { client, bucketName } = await getPrivateBucket(10_000);
	const { error } = await client.storage.from(bucketName).remove([...objectKeys]);
	if (error) throw error;
}

export interface StoredImageObject {
	key: string;
	createdAt: Date;
}

const LIST_PAGE_SIZE = 1000;
/** Safety bound only: 200 pages are 200,000 objects in one folder. */
const LIST_MAX_PAGES = 200;

async function listStorageEntries(folder: string) {
	const { client, bucketName } = await getPrivateBucket(10_000);
	const entries: Array<{ name: string; id: string | null; created_at: string | null }> = [];
	for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
		const { data, error } = await client.storage.from(bucketName).list(folder, {
			limit: LIST_PAGE_SIZE,
			offset: page * LIST_PAGE_SIZE,
		});
		if (error) throw error;
		entries.push(...(data ?? []));
		if ((data?.length ?? 0) < LIST_PAGE_SIZE) break;
	}
	return entries;
}

/** The files directly under `folder` (no recursion); sub-folders carry no id and are skipped. */
export async function listSupabaseImageObjects(folder: string): Promise<StoredImageObject[]> {
	const objects: StoredImageObject[] = [];
	for (const entry of await listStorageEntries(folder)) {
		const createdAt = entry.created_at ? new Date(entry.created_at) : null;
		if (entry.id && createdAt && !Number.isNaN(createdAt.getTime())) {
			objects.push({ key: `${folder}/${entry.name}`, createdAt });
		}
	}
	return objects;
}

/** The names of the sub-folders directly under `folder`; files carry an id and are skipped. */
export async function listSupabaseImageFolders(folder: string): Promise<string[]> {
	return (await listStorageEntries(folder)).filter((entry) => !entry.id).map((entry) => entry.name);
}

function limitPrivateImageStream(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
	const reader = stream.getReader();
	let bytesRead = 0;

	return new ReadableStream({
		async pull(controller) {
			try {
				const chunk = await reader.read();
				if (chunk.done) {
					controller.close();
					return;
				}
				bytesRead += chunk.value.byteLength;
				if (bytesRead > PRIVATE_IMAGE_MAX_BYTES) {
					await reader.cancel();
					controller.error(new ImageStorageObjectNotFoundError());
					return;
				}
				controller.enqueue(chunk.value);
			} catch (error) {
				controller.error(error);
			}
		},
		cancel(reason) {
			return reader.cancel(reason);
		},
	});
}

export async function downloadSupabaseImage(key: string): Promise<PrivateImageDownload> {
	const { client, bucketName } = await getPrivateBucket();
	const bucket = client.storage.from(bucketName);
	const { data: info, error: infoError } = await bucket.info(key);
	if (infoError || !info) throw new ImageStorageObjectNotFoundError();

	const contentLength = info.size ?? info.metadata?.contentLength ?? 0;
	const contentType = info.contentType ?? info.metadata?.mimetype ?? '';
	if (!isValidPrivateImageSize(contentLength) || !isAllowedPrivateImageMimeType(contentType)) {
		throw new ImageStorageObjectNotFoundError();
	}

	const { data: stream, error: downloadError } = await bucket
		.download(key, {}, { cache: 'no-store' })
		.asStream();
	if (downloadError || !stream) throw new ImageStorageObjectNotFoundError();

	return {
		stream: limitPrivateImageStream(stream),
		contentType,
		contentLength,
	};
}
