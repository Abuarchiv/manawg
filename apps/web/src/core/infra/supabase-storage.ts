import 'server-only';

import { createClient } from '@supabase/supabase-js';
import {
	PRIVATE_IMAGE_MAX_BYTES,
	hasExactPrivateImageBucketConfig,
	isAllowedPrivateImageMimeType,
	isValidPrivateImageSize,
} from './private-image-policy';

export type ImageStorageProvider = 'aws' | 'supabase';

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

export function getImageStorageProvider(): ImageStorageProvider {
	const provider = process.env.IMAGE_STORAGE_PROVIDER?.trim().toLowerCase();
	if (!provider || provider === 'aws') return 'aws';
	if (provider === 'supabase') return 'supabase';
	throw new ImageStorageConfigurationError();
}

function getSupabaseServiceClient() {
	const publicSupabaseURL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
	if (!publicSupabaseURL || !serviceRoleKey) throw new ImageStorageConfigurationError();

	return createClient(publicSupabaseURL, serviceRoleKey, {
		auth: {
			persistSession: false,
			autoRefreshToken: false,
			detectSessionInUrl: false,
		},
	});
}

async function getPrivateBucket() {
	const bucketName = process.env.SUPABASE_STORAGE_BUCKET?.trim();
	if (!bucketName) throw new ImageStorageConfigurationError();

	const client = getSupabaseServiceClient();
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

export function limitPrivateImageStream(
	stream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
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
